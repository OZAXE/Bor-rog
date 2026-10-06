// Tests des salles verrouillées : fermeture, ouverture, et surtout l'absence de
// blocage (un ennemi à vaincre doit toujours être enfermé AVEC le héros).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { roomDoors, roomAround, inRoom } from '../src/systems/rooms.js';
import { generateFloor, center } from '../src/dungeon/generate.js';
import { TILE, isWalkable, tileAt } from '../src/dungeon/tiles.js';
import { overlapsSolid } from '../src/systems/collision.js';
import { SIM } from '../src/systems/simConfig.js';
import { stateHash, makePathBot } from './helpers.js';

// Fermer les passages d'une salle doit l'isoler complètement du reste de l'étage
test('les grilles isolent complètement la salle (sur 120 étages)', () => {
  for (let i = 0; i < 120; i++) {
    const d = generateFloor(`portes-${i}`, i % 4);
    for (const room of d.rooms) {
      const doors = roomDoors(d, room);
      const sealed = { ...d, tiles: d.tiles.slice() };
      for (const g of doors) sealed.tiles[g.r * d.width + g.c] = TILE.GATE;
      // Parcours depuis le centre de la salle : on ne doit jamais sortir du rectangle
      const start = center(room);
      const seen = new Set([`${start.c},${start.r}`]);
      const queue = [start];
      while (queue.length) {
        const { c, r } = queue.pop();
        assert.ok(
          c >= room.x && c < room.x + room.w && r >= room.y && r < room.y + room.h,
          `portes-${i}, salle ${room.id} : fuite en ${c},${r}`,
        );
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${c + dc},${r + dr}`;
          if (seen.has(k) || !isWalkable(tileAt(sealed, c + dc, r + dr))) continue;
          seen.add(k);
          queue.push({ c: c + dc, r: r + dr });
        }
      }
      // ... et chaque salle (sauf cas dégénéré) a au moins un passage
      assert.ok(doors.length > 0, `salle ${room.id} sans passage`);
    }
  }
});

// Place le héros au centre d'une salle de combat occupée et renvoie la salle
function enterFirstCombatRoom(s) {
  const room = s.dungeon.rooms.find((r) => r.type === 'combat' && s.enemies.some((e) => inRoom(r, e.x, e.z)));
  const cc = center(room);
  s.players[0].x = cc.c + 0.5;
  s.players[0].z = cc.r + 0.5;
  return room;
}

test('entrer dans une salle occupée la verrouille et alerte ses ennemis', () => {
  const s = createGameState('verrou');
  const room = enterFirstCombatRoom(s);
  stepGame(s, {});
  assert.ok(s.lock, 'la salle aurait dû se verrouiller');
  assert.equal(s.lock.roomId, room.id);
  assert.ok(s.events.some((e) => e.type === 'roomLocked'));
  for (const d of s.lock.doors) assert.equal(tileAt(s.dungeon, d.c, d.r), TILE.GATE);
  for (const id of s.lock.enemyIds) assert.ok(s.enemies.find((e) => e.id === id).alert);
});

test("rester sur le seuil ne verrouille pas (la grille ne se ferme jamais sur le héros)", () => {
  const s = createGameState('seuil');
  const room = s.dungeon.rooms.find((r) => r.type === 'combat' && roomDoors(s.dungeon, r).length);
  const door = roomDoors(s.dungeon, room)[0];
  s.players[0].x = door.c + 0.5;
  s.players[0].z = door.r + 0.5;
  assert.equal(roomAround(s.dungeon, s.players[0].x, s.players[0].z), null);
  stepGame(s, {});
  assert.equal(s.lock, null);
});

test('vaincre les ennemis enfermés rouvre les grilles, et la salle ne se referme plus', () => {
  const s = createGameState('purifier');
  const room = enterFirstCombatRoom(s);
  stepGame(s, {});
  const doors = s.lock.doors;
  // On "tue" les enfermés directement (le combat lui-même est testé ailleurs)
  s.enemies = s.enemies.filter((e) => !s.lock.enemyIds.includes(e.id));
  stepGame(s, {});
  assert.equal(s.lock, null);
  assert.ok(room.cleared);
  assert.ok(s.events.some((e) => e.type === 'roomCleared'));
  for (const d of doors) assert.equal(tileAt(s.dungeon, d.c, d.r), TILE.FLOOR);
  // On ressort puis on revient : plus de verrou
  stepGame(s, {});
  assert.equal(s.lock, null);
});

test('le héros ne peut pas sortir tant que la salle est verrouillée', () => {
  const s = createGameState('prison');
  enterFirstCombatRoom(s);
  stepGame(s, {});
  const door = s.lock.doors[0];
  const room = s.dungeon.rooms.find((r) => r.id === s.lock.roomId);
  // On fonce vers la porte pendant 3 secondes en restant invulnérable
  for (let i = 0; i < 180; i++) {
    s.players[0].invuln = 10;
    const dx = door.c + 0.5 - s.players[0].x;
    const dz = door.r + 0.5 - s.players[0].z;
    const l = Math.hypot(dx, dz) || 1;
    stepGame(s, { moveX: dx / l, moveY: -dz / l });
  }
  assert.ok(inRoom(room, s.players[0].x, s.players[0].z), 'le héros est sorti de la salle verrouillée');
});

test('une salle sans ennemi à l\'intérieur ne se verrouille pas', () => {
  const s = createGameState('vide', { enemies: false });
  const room = s.dungeon.rooms.find((r) => r.type === 'combat');
  const cc = center(room);
  s.players[0].x = cc.c + 0.5;
  s.players[0].z = cc.r + 0.5;
  stepGame(s, {});
  assert.equal(s.lock, null);
});

test('anti-blocage : sur 20 parties agitées, les enfermés sont toujours dans la salle', () => {
  for (let k = 0; k < 20; k++) {
    const s = createGameState(`agite-${k}`);
    let bot = makePathBot(s.dungeon, s.dungeon.stairs);
    let floor = 0;
    let locks = 0;
    for (let t = 0; t < 60 * 120 && s.status !== 'dead'; t++) {
      if (s.floorIndex !== floor) {
        floor = s.floorIndex;
        bot = makePathBot(s.dungeon, s.dungeon.stairs);
      }
      s.players[0].invuln = Math.max(s.players[0].invuln, 2); // on veut tester le verrou, pas mourir
      let intent = bot(s.players[0]);
      if (s.lock) {
        // Enfermé : on va frapper l'ennemi enfermé le plus proche
        const room = s.dungeon.rooms.find((r) => r.id === s.lock.roomId);
        const targets = s.enemies.filter((e) => s.lock.enemyIds.includes(e.id));
        for (const e of targets) {
          assert.ok(inRoom(room, e.x, e.z), `agite-${k} : ennemi ${e.id} enfermé DEHORS`);
          assert.ok(!overlapsSolid(s.dungeon, e, SIM.enemies[e.type].radius), `ennemi ${e.id} dans une grille`);
        }
        const e = targets[0];
        const dx = e.x - s.players[0].x;
        const dz = e.z - s.players[0].z;
        const l = Math.hypot(dx, dz) || 1;
        intent = { moveX: dx / l, moveY: -dz / l, aimX: dx / l, aimY: -dz / l, attack: l < 1.8 };
      } else intent = { ...intent, attack: true };
      if (s.status === 'choosing') intent = { choice: 0 };
      const before = !!s.lock;
      stepGame(s, intent);
      if (!before && s.lock) locks++;
    }
    assert.ok(locks > 0, `agite-${k} : aucune salle verrouillée en 2 minutes`);
    assert.ok(s.floorIndex >= 1, `agite-${k} : escalier jamais atteint (bloqué ?)`);
  }
});

test("l'état verrouillé se sauvegarde et se rejoue à l'identique", () => {
  const play = (save) => {
    let s = createGameState('verrou-json');
    enterFirstCombatRoom(s);
    for (let i = 0; i < 400; i++) {
      if (save && i === 200) s = JSON.parse(JSON.stringify(s));
      stepGame(s, { moveX: Math.cos(i / 30), moveY: Math.sin(i / 23), attack: i % 3 === 0 });
    }
    return s;
  };
  assert.equal(stateHash(play(false)), stateHash(play(true)));
});
