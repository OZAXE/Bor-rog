// Co-op à deux (étape 8c) : cibles des ennemis, héros à terre et relevés,
// Charon pour chacun, salles verrouillées, butin, difficulté, déterminisme.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy, enterFloor } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { hurtPlayer } from '../src/systems/player.js';
import { enemyStats } from '../src/systems/difficulty.js';
import { startDescent, healCost } from '../src/systems/descent.js';
import { spawnPickup } from '../src/systems/loot.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE, isWalkable, tileAt } from '../src/dungeon/tiles.js';
import { stateHash, scriptedIntents } from './helpers.js';

const DUO = { players: [{ cls: 'warrior' }, { cls: 'huntress' }] };

// Grande salle vide fermée de murs (sans salle de combat : rien ne se verrouille)
function arena(options = DUO) {
  const s = createGameState('coop', { ...options, enemies: false });
  const W = 30;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r < W - 1; r++) for (let c = 1; c < W - 1; c++) tiles[r * W + c] = TILE.FLOOR;
  s.dungeon = { width: W, height: W, tiles, rooms: [], decor: [], start: { c: 15, r: 15 }, stairs: { c: 1, r: 1 } };
  s.chests = [];
  s.pickups = [];
  Object.assign(s.players[0], { x: 10.5, z: 15.5 });
  Object.assign(s.players[1], { x: 20.5, z: 15.5 });
  return s;
}
function shade(s, x, z) {
  const e = createEnemy(s, { type: 'shade', x, z });
  e.alert = true;
  e.mode = 'chase';
  s.enemies.push(e);
  return e;
}
const idle = [{}, {}];
const run = (s, n, intents = idle) => {
  for (let i = 0; i < n; i++) stepGame(s, intents);
};
const down = (s, i) => hurtPlayer(s, s.players[i], 999, 0, 0);

test('deux héros, chacun sa classe, sa vie et sa bourse ; départs sur deux cases libres distinctes', () => {
  const s = createGameState('duo', { players: [{ cls: 'mystic', meta: { attrs: { demeter: 10 }, talents: {} } }, { cls: 'huntress' }] });
  const [a, b] = s.players;
  assert.equal(s.players.length, 2);
  assert.deepEqual([a.id, b.id], [0, 1]);
  assert.deepEqual([a.cls, b.cls], ['mystic', 'huntress']);
  assert.ok(a.maxHp > b.maxHp, 'Déméter 10 ne profite qu’au premier joueur');
  assert.notDeepEqual([a.x, a.z], [b.x, b.z]);
  assert.ok(isWalkable(tileAt(s.dungeon, Math.floor(b.x), Math.floor(b.z))));
  assert.equal(a.gold, 0);
  // Un troisième joueur est refusé (2 au maximum)
  assert.equal(createGameState('trio', { players: [{}, {}, {}] }).players.length, 2);
});

test('difficulté : ennemis +100 % de PV et +1 dégât, boss +130 % à deux ; rien ne change en solo', () => {
  assert.ok(Math.abs(enemyStats('shade', 3, false, 2).hp - enemyStats('shade', 3, false, 1).hp * 2) <= 1);
  const solo = enemyStats('archer', 5, true);
  const duo = enemyStats('archer', 5, true, 2);
  assert.ok(Math.abs(duo.hp - solo.hp * 2) <= 1);
  assert.equal(enemyStats('shade', 5, false, 2).damage, enemyStats('shade', 5).damage + 1);
  assert.equal(duo.arrowDamage, solo.arrowDamage + 1);
  assert.equal(enemyStats('cerberus', 2, false, 2).hp, Math.round(SIM.bosses.cerberus.hp * 2.3));
  assert.equal(enemyStats('cerberus', 2).hp, SIM.bosses.cerberus.hp);
  const s = createGameState('pv', DUO);
  for (const e of s.enemies) assert.equal(e.maxHp, enemyStats(e.type, 0, e.elite, 2).hp);
});

test('un ennemi poursuit le héros debout le plus proche, et change de cible si celui-ci tombe', () => {
  const s = arena();
  const e = shade(s, 18.5, 15.5); // plus près du joueur 2
  run(s, 20);
  assert.ok(e.x > 18.5, 'il va vers le joueur 2 (à l’est)');
  down(s, 1);
  const x = e.x;
  run(s, 120);
  assert.ok(e.x < x - 0.5, 'le joueur 2 à terre, il se tourne vers le joueur 1 (à l’ouest)');
});

test('une attaque de zone blesse chaque héros dans la zone', () => {
  const s = arena();
  Object.assign(s.players[1], { x: 11.5, z: 15.5 });
  const e = shade(s, 11, 16.6); // au sud, entre les deux
  e.mode = 'windup';
  e.timer = 1;
  e.facing = Math.PI * 1; // vers le nord (z décroissant)
  e.aimX = 0;
  e.aimZ = -1;
  stepGame(s, idle);
  const hurt = s.events.filter((ev) => ev.type === 'playerHurt').map((ev) => ev.player);
  assert.deepEqual(hurt.sort(), [0, 1]);
});

test('à terre : un allié à côté pendant 2 s le relève avec la moitié de ses PV', () => {
  const s = arena();
  down(s, 1);
  const p = s.players[1];
  assert.equal(s.status, 'playing', 'la partie continue');
  assert.ok(p.down > 0);
  assert.equal(p.hp, 0);
  // À terre, il ne bouge plus et ne subit plus rien
  run(s, 10, [{}, { moveX: 1, attack: true }]);
  assert.equal(p.x, 20.5);
  assert.equal(hurtPlayer(s, p, 1, 0, 0), false);
  // L'allié vient à côté
  Object.assign(s.players[0], { x: 19.6, z: 15.5 });
  run(s, ticks(SIM.coop.reviveTime) - 1);
  assert.ok(p.down > 0, 'pas encore');
  run(s, 1);
  assert.equal(p.down, 0);
  assert.equal(p.hp, Math.ceil(p.maxHp / 2));
  assert.ok(p.invuln > 0);
  assert.ok(s.events.some((ev) => ev.type === 'playerRevived' && ev.player === 1));
});

test('sans aide, le héros disparaît jusqu’à l’étage suivant, où il revient avec la moitié de ses PV', () => {
  const s = arena();
  down(s, 1);
  run(s, ticks(SIM.coop.downTime));
  const p = s.players[1];
  assert.equal(p.out, true);
  assert.equal(s.status, 'playing');
  // Hors jeu : ignoré par les ennemis, ne ramasse rien
  const e = shade(s, 20.5, 16.5);
  run(s, 30);
  assert.ok(e.x < 20.4, 'l’ennemi part vers le joueur 1');
  enterFloor(s, 1);
  assert.equal(p.out, false);
  assert.equal(p.hp, Math.ceil(p.maxHp / 2));
});

test('la partie est perdue quand les deux héros sont à terre ; en solo, la mort reste immédiate', () => {
  const s = arena();
  down(s, 0);
  assert.equal(s.status, 'playing');
  down(s, 1);
  assert.equal(s.status, 'dead');
  const solo = createGameState('solo');
  hurtPlayer(solo, solo.players[0], 999, 0, 0);
  assert.equal(solo.status, 'dead');
  assert.equal(solo.players[0].down, 0, 'pas d’état « à terre » en solo');
});

test('Charon : chacun choisit son bienfait avec ses oboles ; on descend quand les deux ont choisi', () => {
  const s = arena();
  s.players[0].gold = 100;
  s.players[1].gold = 5;
  s.players[1].hp = 3;
  startDescent(s);
  assert.ok(s.players[0].offer && s.players[1].offer);
  const floor = s.floorIndex;
  const id0 = s.players[0].offer.boons[0];
  stepGame(s, [{ choice: 0 }, { shop: 'heal' }]);
  assert.equal(s.status, 'choosing', 'le joueur 2 n’a pas encore choisi');
  assert.equal(s.players[0].boons[id0], 1);
  assert.equal(s.players[0].offer, null);
  assert.equal(s.players[1].hp, 3, 'pas assez d’oboles pour le soin');
  s.players[1].gold = healCost(s.players[1]);
  stepGame(s, [{ choice: 2 }, { shop: 'heal' }]);
  assert.equal(s.players[0].boons[id0], 1, 'le joueur 1 ne choisit pas deux fois');
  assert.ok(s.players[1].hp > 3);
  assert.equal(s.players[1].gold, 0);
  const id1 = s.players[1].offer.boons[1];
  stepGame(s, [{}, { choice: 1 }]);
  assert.equal(s.players[1].boons[id1], 1);
  assert.equal(s.status, 'playing');
  assert.equal(s.floorIndex, floor + 1);
});

test('chaque héros ramasse les oboles les plus proches de lui ; une potion va au héros blessé', () => {
  const s = arena();
  spawnPickup(s, 'obol', 20.5, 15.5, 3);
  spawnPickup(s, 'obol', 10.5, 15.5, 2);
  s.players[0].hp = 5;
  spawnPickup(s, 'potion', 20.5, 15.5);
  run(s, 30);
  assert.equal(s.players[0].gold, 2);
  assert.equal(s.players[1].gold, 3);
  assert.equal(s.pickups.length, 1, 'la potion attend le héros blessé');
  assert.equal(s.players[0].hp, 5);
});

test('salle verrouillée : l’allié resté dehors est amené dans la salle', () => {
  let tried = 0;
  for (let k = 0; k < 20 && tried < 3; k++) {
    const s = createGameState(`verrou-${k}`, DUO);
    const room = s.dungeon.rooms.find((r) => r.type === 'combat' && s.enemies.some((e) => e.roomId === r.id));
    if (!room) continue;
    tried++;
    Object.assign(s.players[0], { x: room.x + Math.floor(room.w / 2) + 0.5, z: room.y + Math.floor(room.h / 2) + 0.5 });
    const ally = s.players[1];
    run(s, 1);
    assert.ok(s.lock, 'la salle se verrouille');
    assert.ok(ally.x >= room.x && ally.x <= room.x + room.w && ally.z >= room.y && ally.z <= room.y + room.h, 'l’allié est dans la salle');
    assert.ok(isWalkable(tileAt(s.dungeon, Math.floor(ally.x), Math.floor(ally.z))));
  }
  assert.ok(tried >= 3);
});

test('les tirs d’un héros sont à son nom : ses talents et ses victoires', () => {
  const s = arena();
  s.players[0].meta.talents.rage = 1; // Rage d'Arès (posée directement : seul le crédit compte ici)
  s.players[1].meta.talents.rage = 1;
  const e = shade(s, 20.5, 18.5);
  e.hp = 1;
  run(s, 40, [{}, { attack: true, aimX: 0, aimY: -1 }]);
  assert.equal(s.enemies.length, 0);
  assert.ok(s.players[1].rage > 0, 'la Rage du tireur se déclenche');
  assert.equal(s.players[0].rage, 0);
});

test('un héros sur l’escalier ouvre Charon pour les deux', () => {
  const s = arena();
  Object.assign(s.players[1], { x: 1.5, z: 1.5 });
  s.dungeon.tiles[1 * 30 + 1] = TILE.STAIRS;
  run(s, 1);
  assert.equal(s.status, 'choosing');
  assert.ok(s.players[0].offer && s.players[1].offer);
});

test('co-op déterministe : même graine + mêmes intentions = même partie', () => {
  const a1 = scriptedIntents(1500, 3);
  const a2 = scriptedIntents(1500, 9);
  const play = () => {
    const s = createGameState('rejeu-coop', DUO);
    for (let i = 0; i < 1500; i++) stepGame(s, [{ ...a1[i], attack: i % 3 === 0 }, { ...a2[i], attack: i % 4 === 0, dash: i % 50 === 0 }]);
    return s;
  };
  const x = play();
  assert.ok(x.tick > 0);
  assert.equal(stateHash(play()), stateHash(x));
});
