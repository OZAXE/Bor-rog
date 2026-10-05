// Tests du butin, des coffres, de l'écran de Charon et de chaque bienfait.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE } from '../src/dungeon/tiles.js';
import { BOONS, BOON_IDS, playerStats } from '../src/systems/boons.js';
import { rerollCost } from '../src/systems/descent.js';
import { inRoom } from '../src/systems/rooms.js';
import { stateHash } from './helpers.js';

function arena() {
  const s = createGameState('butin', { enemies: false });
  const W = 22;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r < W - 1; r++) for (let c = 1; c < W - 1; c++) tiles[r * W + c] = TILE.FLOOR;
  s.dungeon = { width: W, height: W, tiles, rooms: [], decor: [], start: { c: 11, r: 11 }, stairs: { c: 1, r: 1 } };
  s.chests = [];
  s.pickups = [];
  Object.assign(s.player, { x: 11.5, z: 11.5, vx: 0, vz: 0, facing: 0 });
  return s;
}
const run = (s, n, intent = {}) => {
  for (let i = 0; i < n; i++) stepGame(s, intent);
};
const SOUTH = { aimX: 0, aimY: -1 };

test('oboles : ramassées au contact et attirées de loin', () => {
  const s = arena();
  s.pickups.push({ id: 900, kind: 'obol', x: 11.5, z: 13.2, amount: 3 }); // 1,7 m : dans le rayon d'attraction
  s.pickups.push({ id: 901, kind: 'obol', x: 11.5, z: 18.5, amount: 5 }); // trop loin
  run(s, 60);
  assert.equal(s.gold, 3);
  assert.equal(s.pickups.length, 1, "l'obole lointaine ne doit pas bouger toute seule");
  assert.equal(s.pickups[0].z, 18.5);
});

test('potion : soigne sans dépasser le maximum, et reste au sol si la vie est pleine', () => {
  const s = arena();
  s.pickups.push({ id: 900, kind: 'potion', x: 11.5, z: 11.6, amount: 1 });
  run(s, 2);
  assert.equal(s.pickups.length, 1, 'potion gaspillée alors que la vie est pleine');
  s.player.hp = s.player.maxHp - 1;
  run(s, 2);
  assert.equal(s.player.hp, s.player.maxHp, 'ne doit pas dépasser le maximum');
  assert.equal(s.pickups.length, 0);
});

test('un ennemi vaincu lâche parfois du butin, de façon reproductible', () => {
  const drops = [];
  for (let k = 0; k < 2; k++) {
    let total = 0;
    for (let i = 0; i < 80; i++) {
      const s = arena();
      s.rng = { s: 1000 + i }; // une graine de butin différente par essai, mais la même aux deux tours
      const e = createEnemy(s, { type: 'archer', x: 11.5, z: 12.5 });
      e.hp = 1;
      s.enemies.push(e);
      stepGame(s, { ...SOUTH, attack: true });
      total += s.pickups.reduce((a, p) => a + (p.kind === 'obol' ? p.amount : 100), 0);
    }
    drops.push(total);
  }
  assert.equal(drops[0], drops[1], 'butin non reproductible');
  assert.ok(drops[0] > 0, 'aucun butin sur 80 ennemis');
});

test('une salle purifiée laisse une récompense en son centre', () => {
  const s = createGameState('recompense');
  const room = s.dungeon.rooms.find((r) => r.type === 'combat' && s.enemies.some((e) => inRoom(r, e.x, e.z)));
  s.player.x = room.x + Math.floor(room.w / 2) + 0.5;
  s.player.z = room.y + Math.floor(room.h / 2) + 0.5;
  stepGame(s, {});
  assert.ok(s.lock);
  s.enemies = s.enemies.filter((e) => !s.lock.enemyIds.includes(e.id));
  stepGame(s, {});
  const reward = s.pickups.filter((p) => inRoom(room, p.x, p.z));
  assert.ok(reward.length > 0, 'pas de récompense');
});

test('coffres : un par salle au trésor, ouvert une seule fois au contact', () => {
  let rooms = 0;
  for (let i = 0; i < 30; i++) {
    const s = createGameState(`coffre-${i}`, { enemies: false });
    const treasures = s.dungeon.rooms.filter((r) => r.type === 'treasure');
    assert.equal(s.chests.length, treasures.length);
    rooms += treasures.length;
    for (const c of s.chests) assert.equal(s.dungeon.tiles[Math.floor(c.z) * s.dungeon.width + Math.floor(c.x)], TILE.FLOOR);
    if (!s.chests.length) continue;
    const c = s.chests[0];
    s.player.x = c.x;
    s.player.z = c.z + 0.3;
    stepGame(s, {});
    assert.ok(c.opened);
    const n = s.pickups.length;
    assert.ok(n > 0, 'coffre vide');
    stepGame(s, {});
    assert.ok(s.pickups.length <= n, 'le coffre a donné deux fois');
  }
  assert.ok(rooms > 5, 'trop peu de salles au trésor pour tester');
});

// Place le héros sur l'escalier d'un étage sans ennemi
function onStairs(seed = 'charon') {
  const s = createGameState(seed, { enemies: false });
  s.player.x = s.dungeon.stairs.c + 0.5;
  s.player.z = s.dungeon.stairs.r + 0.5;
  stepGame(s, {});
  return s;
}

test("l'escalier ouvre l'écran de Charon : 3 bienfaits différents, le donjon est en pause", () => {
  const s = onStairs();
  assert.equal(s.status, 'choosing');
  assert.equal(s.offer.boons.length, 3);
  assert.equal(new Set(s.offer.boons).size, 3);
  const tick = s.tick;
  const x = s.player.x;
  run(s, 30, { moveX: 1 });
  assert.equal(s.tick, tick);
  assert.equal(s.player.x, x);
  assert.equal(s.floorIndex, 0);
});

test('choisir un bienfait l\'applique et fait descendre', () => {
  const s = onStairs();
  const id = s.offer.boons[1];
  stepGame(s, { choice: 1 });
  assert.equal(s.status, 'playing');
  assert.equal(s.floorIndex, 1);
  assert.equal(s.player.boons[id], 1);
  assert.equal(s.offer, null);
});

test('Charon : soin et relance payants, refusés sans assez d\'oboles', () => {
  const s = onStairs();
  s.player.hp = 3;
  s.gold = SIM.loot.healCost - 1;
  stepGame(s, { shop: 'heal' });
  assert.equal(s.player.hp, 3, 'soin accordé sans assez d\'oboles');
  s.gold = SIM.loot.healCost + 100;
  stepGame(s, { shop: 'heal' });
  assert.equal(s.player.hp, 3 + SIM.loot.healAmount);
  assert.equal(s.gold, 100);
  const cost = rerollCost(s);
  stepGame(s, { shop: 'reroll' });
  assert.equal(s.gold, 100 - cost);
  assert.ok(rerollCost(s) > cost, 'la relance doit coûter de plus en plus cher');
  assert.equal(s.offer.boons.length, 3);
});

test('les bienfaits au maximum ne sont plus proposés', () => {
  const s = onStairs();
  for (const id of BOON_IDS) s.player.boons[id] = BOONS[id].max;
  s.player.boons.ares = BOONS.ares.max - 1;
  s.status = 'playing';
  s.player.x += 0.01;
  stepGame(s, {});
  assert.deepEqual(s.offer.boons, ['ares']);
});

// ---------- Effet réel de chaque bienfait ----------

test("Force d'Arès : une Ombre (3 PV) tombe en 2 coups au lieu de 3", () => {
  const hits = (ares) => {
    const s = arena();
    s.player.boons.ares = ares;
    const e = createEnemy(s, { type: 'shade', x: 11.5, z: 12.5 });
    s.enemies.push(e);
    let n = 0;
    while (s.enemies.length && n < 10) {
      e.x = 11.5;
      e.z = 12.5;
      stepGame(s, { ...SOUTH, attack: true });
      n++;
      run(s, ticks(SIM.player.attack.cooldown), SOUTH);
    }
    return n;
  };
  assert.equal(hits(0), 3);
  assert.equal(hits(1), 2);
});

test("Vigueur de Déméter : +3 PV max et soigne 3", () => {
  const s = onStairs();
  s.player.hp = 5;
  s.offer.boons = ['demeter', 'ares', 'zeus'];
  stepGame(s, { choice: 0 });
  assert.equal(s.player.maxHp, SIM.player.maxHp + 3);
  assert.equal(s.player.hp, 8);
});

test("Célérité d'Hermès : on va plus loin dans le même temps", () => {
  const dist = (hermes) => {
    const s = arena();
    s.player.x = 2.5;
    s.player.boons.hermes = hermes;
    run(s, 60, { moveX: 1 });
    return s.player.x - 2.5;
  };
  assert.ok(dist(1) > dist(0) * 1.1, `${dist(0)} -> ${dist(1)}`);
});

test("Allonge d'Artémis : touche un ennemi hors de la portée normale", () => {
  const touch = (artemis) => {
    const s = arena();
    s.player.boons.artemis = artemis;
    const e = createEnemy(s, { type: 'shade', x: 11.5, z: 11.5 + SIM.player.attack.range + 0.55 });
    s.enemies.push(e);
    stepGame(s, { ...SOUTH, attack: true });
    return e.hp < e.maxHp;
  };
  assert.equal(touch(0), false);
  assert.equal(touch(1), true);
});

test('Fureur de Zeus et Voile de Nyx : recharges plus courtes', () => {
  const swings = (zeus) => {
    const s = arena();
    s.player.boons.zeus = zeus;
    let n = 0;
    for (let i = 0; i < 120; i++) {
      stepGame(s, { ...SOUTH, attack: true });
      n += s.events.filter((e) => e.type === 'swing').length;
    }
    return n;
  };
  assert.ok(swings(2) > swings(0), 'Zeus sans effet');
  const s = arena();
  s.player.boons.nyx = 1;
  s.player.x = 3.5;
  stepGame(s, { moveX: 1, dash: true });
  assert.ok(s.player.dashCooldown < ticks(SIM.player.dash.cooldown), 'Nyx sans effet');
});

test("Égide d'Athéna : invulnérabilité plus longue après un coup", () => {
  const s = arena();
  s.player.boons.athena = 1;
  const e = createEnemy(s, { type: 'shade', x: 11.5, z: 12.4 });
  Object.assign(e, { alert: true, mode: 'windup', timer: 1, aimX: 0, aimZ: -1, facing: Math.PI });
  s.enemies.push(e);
  stepGame(s, {});
  assert.ok(s.player.invuln >= ticks(SIM.player.hurtInvuln + 0.5) - 1, `invuln ${s.player.invuln}`);
});

test("Tribut d'Hadès : la vie remonte en vainquant des ennemis", () => {
  const s = arena();
  s.player.boons.hades = 1;
  s.player.hp = 5;
  const per = playerStats(s.player).killsPerHeal;
  for (let k = 0; k < per; k++) {
    const e = createEnemy(s, { type: 'archer', x: 11.5, z: 12.5 });
    e.hp = 1;
    s.enemies.push(e);
    stepGame(s, { ...SOUTH, attack: true });
    run(s, ticks(SIM.player.attack.cooldown), SOUTH);
  }
  assert.equal(s.player.hp, 6);
});

test('partie complète avec butin et choix : rejeu identique', () => {
  const play = () => {
    const s = createGameState('rejeu-butin');
    for (let i = 0; i < 5000; i++) {
      const it = s.status === 'choosing'
        ? { choice: i % 3, shop: i % 2 ? 'heal' : '' }
        : { moveX: Math.cos(i / 37), moveY: Math.sin(i / 51), attack: i % 4 < 2, dash: i % 70 === 0 };
      stepGame(s, it);
    }
    return s;
  };
  assert.equal(stateHash(play()), stateHash(play()));
});
