// Tests du combat : chaque règle est vérifiée dans une petite arène contrôlée
// (salle vide, ennemi placé à la main), puis sur de vrais étages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE } from '../src/dungeon/tiles.js';
import { overlapsSolid } from '../src/systems/collision.js';
import { populateFloor } from '../src/dungeon/populate.js';
import { generateFloor } from '../src/dungeon/generate.js';
import { stateHash } from './helpers.js';

// Arène : grande salle vide de 20 × 20, héros au centre, aucun ennemi au départ
function arena() {
  const state = createGameState('arene', { enemies: false });
  const W = 22;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r < W - 1; r++) for (let c = 1; c < W - 1; c++) tiles[r * W + c] = TILE.FLOOR;
  state.dungeon = { width: W, height: W, tiles, rooms: [], decor: [], start: { c: 11, r: 11 }, stairs: { c: 1, r: 1 } };
  Object.assign(state.player, { x: 11.5, z: 11.5, vx: 0, vz: 0, facing: 0 });
  return state;
}
function addEnemy(state, type, x, z, extra = {}) {
  const e = createEnemy(state, { type, x, z });
  Object.assign(e, extra);
  state.enemies.push(e);
  return e;
}
const run = (state, n, intent = {}) => {
  for (let i = 0; i < n; i++) stepGame(state, typeof intent === 'function' ? intent(i) : intent);
};
// facing 0 = vers le sud (+z) ; viser le sud = aimY négatif (le nord est aimY > 0)
const SOUTH = { aimX: 0, aimY: -1 };

test("le coup touche un ennemi devant, à portée, et pas un ennemi derrière", () => {
  const s = arena();
  const front = addEnemy(s, 'shade', 11.5, 12.7); // 1,2 m au sud
  const back = addEnemy(s, 'shade', 11.5, 10.3); // 1,2 m au nord
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(front.hp, SIM.enemies.shade.hp - 1);
  assert.equal(back.hp, SIM.enemies.shade.hp);
  assert.ok(s.events.some((e) => e.type === 'hit' && e.id === front.id));
});

test('hors de portée : pas de dégât', () => {
  const s = arena();
  const far = addEnemy(s, 'shade', 11.5, 11.5 + SIM.player.attack.range + 0.6);
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(far.hp, SIM.enemies.shade.hp);
});

test('pas de coup à travers un mur', () => {
  const s = arena();
  s.dungeon.tiles[12 * 22 + 11] = TILE.WALL; // mur juste au sud du héros
  const e = addEnemy(s, 'shade', 11.5, 13.3);
  s.player.z = 11.6;
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(e.hp, SIM.enemies.shade.hp);
});

test('délai entre deux coups respecté, coups enchaînés si on maintient', () => {
  const s = arena();
  const e = addEnemy(s, 'shade', 11.5, 12.6, { hp: 99, maxHp: 99 });
  let swings = 0;
  for (let i = 0; i < 60; i++) {
    stepGame(s, { ...SOUTH, attack: true });
    swings += s.events.filter((x) => x.type === 'swing').length;
    // on ramène l'ennemi devant (le recul l'éloigne)
    e.x = 11.5;
    e.z = 12.6;
  }
  const expected = Math.ceil(60 / ticks(SIM.player.attack.cooldown));
  assert.ok(Math.abs(swings - expected) <= 1, `${swings} coups en 1 s (attendu ~${expected})`);
});

test("un ennemi à 0 PV disparaît, est compté et émet un événement", () => {
  const s = arena();
  const e = addEnemy(s, 'archer', 11.5, 12.5);
  for (let k = 0; k < SIM.enemies.archer.hp; k++) {
    e.x = 11.5;
    e.z = 12.5;
    stepGame(s, { ...SOUTH, attack: true });
    run(s, ticks(SIM.player.attack.cooldown), SOUTH);
  }
  assert.equal(s.enemies.length, 0);
  assert.equal(s.kills, 1);
});

test('sans visée (mobile), le coup se tourne vers l\'ennemi le plus proche', () => {
  const s = arena();
  s.player.facing = 0; // regarde au sud
  const e = addEnemy(s, 'shade', 12.7, 11.5); // à l'est
  stepGame(s, { attack: true });
  assert.equal(e.hp, SIM.enemies.shade.hp - 1, 'la visée automatique aurait dû le toucher');
});

test("l'Ombre prévient avant de frapper : aucun dégât pendant la préparation", () => {
  const s = arena();
  addEnemy(s, 'shade', 11.5, 12.4, { alert: true, mode: 'chase' });
  const windup = ticks(SIM.enemies.shade.windup);
  run(s, windup - 1);
  assert.equal(s.player.hp, SIM.player.maxHp, 'touché pendant la préparation');
  run(s, 3);
  assert.equal(s.player.hp, SIM.player.maxHp - SIM.enemies.shade.damage, 'le coup aurait dû partir');
});

test("esquiver pendant la préparation évite le coup", () => {
  const s = arena();
  addEnemy(s, 'shade', 11.5, 12.4, { alert: true, mode: 'chase' });
  run(s, 5); // l'Ombre commence sa préparation
  // esquive vers le nord, loin du coup
  stepGame(s, { moveX: 0, moveY: 1, dash: true });
  run(s, ticks(SIM.enemies.shade.windup) + 5, { moveX: 0, moveY: 1 });
  assert.equal(s.player.hp, SIM.player.maxHp);
});

test('invulnérable après un coup reçu : pas de double dégât immédiat', () => {
  const s = arena();
  addEnemy(s, 'shade', 11.5, 12.4, { alert: true, mode: 'windup', timer: 1, aimX: 0, aimZ: -1, facing: Math.PI });
  addEnemy(s, 'shade', 12.4, 11.5, { alert: true, mode: 'windup', timer: 2, aimX: -1, aimZ: 0, facing: -Math.PI / 2 });
  run(s, 3);
  assert.equal(s.player.hp, SIM.player.maxHp - SIM.enemies.shade.damage);
});

test("l'archer tire, la flèche blesse, mais traverse le héros pendant l'esquive", () => {
  const s = arena();
  addEnemy(s, 'archer', 11.5, 16.5, { alert: true, mode: 'chase', shotCooldown: 0 });
  run(s, ticks(SIM.enemies.archer.windup) + 2);
  assert.equal(s.projectiles.length, 1, 'la flèche aurait dû partir');
  run(s, 60);
  assert.equal(s.player.hp, SIM.player.maxHp - SIM.enemies.archer.arrowDamage);

  // Esquive À TRAVERS la flèche (vers l'archer) : seule l'invulnérabilité peut l'éviter
  const s2 = arena();
  addEnemy(s2, 'archer', 11.5, 17.5, { alert: true, mode: 'chase', shotCooldown: 0 });
  run(s2, ticks(SIM.enemies.archer.windup) + 2);
  assert.equal(s2.projectiles.length, 1);
  let guard = 0;
  while (s2.projectiles.length && s2.projectiles[0].z - s2.player.z > 1.2 && guard++ < 120) stepGame(s2, {});
  stepGame(s2, { moveX: 0, moveY: -1, dash: true }); // vers le sud, droit sur la flèche
  const zBefore = s2.player.z;
  run(s2, 12, { moveX: 0, moveY: -1 });
  assert.ok(s2.player.z - zBefore > 1.5, "l'esquive aurait dû traverser la trajectoire");
  assert.equal(s2.player.hp, SIM.player.maxHp, "la flèche n'aurait pas dû toucher pendant l'esquive");
  // ... et elle continue sa course derrière le héros (elle le traverse, elle n'est pas absorbée)
  assert.equal(s2.projectiles.length, 1, 'la flèche aurait dû passer à travers');
  assert.ok(s2.projectiles[0].z < s2.player.z - 1);
});

test('les flèches se brisent sur les murs', () => {
  const s = arena();
  s.projectiles.push({ id: 99, x: 11.5, z: 11.5, vx: 0, vz: -8.5, travelLeft: 30, damage: 1 });
  s.player.x = 5.5; // hors trajectoire
  run(s, 120);
  assert.equal(s.projectiles.length, 0);
});

test("l'esquive ne traverse pas les murs et a un temps de recharge", () => {
  const s = arena();
  s.player.x = 2.5;
  stepGame(s, { moveX: -1, moveY: 0, dash: true });
  run(s, 15, { moveX: -1, moveY: 0 });
  assert.ok(!overlapsSolid(s.dungeon, s.player, SIM.player.radius));
  // Maintenir le bouton (bien plus longtemps que la recharge) ne relance pas d'esquive
  const count = (pattern) => {
    const s2 = arena();
    s2.player.x = 3.5;
    let dashes = 0;
    for (let i = 0; i < 90; i++) {
      stepGame(s2, { moveX: i < 45 ? 1 : -1, dash: pattern(i) });
      dashes += s2.events.filter((e) => e.type === 'dash').length;
    }
    return dashes;
  };
  assert.equal(count(() => true), 1, 'bouton maintenu');
  // Rappuyer trop tôt (avant la recharge) ne fait rien ; rappuyer après, oui
  assert.equal(count((i) => i === 0 || i === 10), 1, 'rappui pendant la recharge');
  assert.equal(count((i) => i === 0 || i === 50), 2, 'rappui après la recharge');
});

test('mort : statut "dead", puis la partie ne bouge plus', () => {
  const s = arena();
  s.player.hp = 1;
  addEnemy(s, 'shade', 11.5, 12.4, { alert: true, mode: 'windup', timer: 1, aimX: 0, aimZ: -1, facing: Math.PI });
  run(s, 2);
  assert.equal(s.status, 'dead');
  const frozen = stateHash({ ...s, events: [] });
  run(s, 100, { moveX: 1, attack: true });
  assert.equal(stateHash({ ...s, events: [] }), frozen);
});

test('deux ennemis serrés contre un mur ne sont jamais poussés dedans', () => {
  const s = arena();
  for (let r = 1; r < 21; r++) s.dungeon.tiles[r * 22 + 15] = TILE.WALL; // mur vertical en c = 15
  s.player.x = 3.5; // loin : les ennemis restent immobiles
  const a = addEnemy(s, 'shade', 14.6, 11.5);
  const b = addEnemy(s, 'shade', 14.62, 11.52);
  stepGame(s, {});
  for (const e of [a, b]) assert.ok(!overlapsSolid(s.dungeon, e, SIM.enemies.shade.radius), `ennemi ${e.id} dans le mur`);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.3, 'les ennemis auraient dû être écartés');
});

test("un ennemi ne repère pas le héros à travers un mur", () => {
  const s = arena();
  for (let c = 1; c < 21; c++) s.dungeon.tiles[13 * 22 + c] = TILE.WALL; // mur horizontal
  const e = addEnemy(s, 'shade', 11.5, 15.5);
  run(s, 60);
  assert.equal(e.alert, false);
  s.dungeon.tiles[13 * 22 + 11] = TILE.FLOOR; // on ouvre une brèche en face
  run(s, 2);
  assert.equal(e.alert, true);
});

test('peuplement : déterministe, rien dans la salle de départ, ennemis sur du sol', () => {
  for (let i = 0; i < 40; i++) {
    const d = generateFloor(`peuple-${i}`, i % 5);
    const a = populateFloor(d, `peuple-${i}`, i % 5);
    assert.deepEqual(a, populateFloor(d, `peuple-${i}`, i % 5));
    const start = d.rooms.find((r) => r.type === 'start');
    for (const e of a) {
      assert.equal(d.tiles[Math.floor(e.z) * d.width + Math.floor(e.x)], TILE.FLOOR);
      assert.notEqual(e.roomId, start.id);
      assert.ok(!overlapsSolid(d, e, SIM.enemies[e.type].radius));
    }
  }
});

test('plus on descend, plus il y a d\'ennemis', () => {
  let low = 0;
  let high = 0;
  for (let i = 0; i < 30; i++) {
    low += populateFloor(generateFloor(`n-${i}`, 0), `n-${i}`, 0).length;
    high += populateFloor(generateFloor(`n-${i}`, 4), `n-${i}`, 4).length;
  }
  assert.ok(high > low * 1.5, `étage 1 : ${low}, étage 5 : ${high}`);
});

test('combat long sur un vrai étage : rien ne traverse les murs, rejeu identique', () => {
  // Un "joueur" qui tourne en rond en attaquant et en esquivant : beaucoup d'action
  const intents = Array.from({ length: 3600 }, (_, i) => ({
    moveX: Math.cos(i / 40),
    moveY: Math.sin(i / 55),
    attack: i % 7 < 4,
    dash: i % 90 === 0,
  }));
  const play = () => {
    const s = createGameState('melee');
    for (const it of intents) {
      stepGame(s, it);
      for (const e of s.enemies) {
        assert.ok(!overlapsSolid(s.dungeon, e, SIM.enemies[e.type].radius), `ennemi ${e.id} dans un mur`);
      }
    }
    return s;
  };
  const a = play();
  const b = play();
  assert.equal(stateHash(a), stateHash(b));
});
