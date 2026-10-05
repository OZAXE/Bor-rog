// Tests de la courbe de difficulté, des élites et de la Furie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy, enterFloor } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE } from '../src/dungeon/tiles.js';
import { floorScaling, enemyStats, DIFFICULTY } from '../src/systems/difficulty.js';
import { populateFloor } from '../src/dungeon/populate.js';
import { generateFloor } from '../src/dungeon/generate.js';
import { overlapsSolid } from '../src/systems/collision.js';

test("au premier étage, les ennemis gardent leurs valeurs de base", () => {
  for (const type of ['shade', 'archer', 'fury']) {
    const st = enemyStats(type, 0, false);
    const base = SIM.enemies[type];
    assert.equal(st.hp, base.hp);
    assert.equal(st.speed, base.speed);
    assert.equal(st.windup, base.windup);
  }
});

test('la difficulté ne fait que monter (et reste bornée)', () => {
  let prev = floorScaling(0);
  for (let f = 1; f <= 12; f++) {
    const k = floorScaling(f);
    assert.ok(k.hp > prev.hp, `PV étage ${f}`);
    assert.ok(k.damage >= prev.damage);
    assert.ok(k.speed >= prev.speed);
    assert.ok(k.windup <= prev.windup, `préparation étage ${f}`);
    assert.ok(k.eliteChance >= prev.eliteChance);
    prev = k;
  }
  // Bornes : on peut toujours réagir, et les élites restent minoritaires
  const deep = floorScaling(50);
  assert.equal(deep.windup, DIFFICULTY.minWindup);
  assert.ok(deep.speed <= 1 + DIFFICULTY.maxSpeedBonus + 1e-9);
  assert.ok(deep.eliteChance <= DIFFICULTY.elite.maxChance);
});

test("une Ombre de l'étage 7 prévient moins longtemps, encaisse et frappe plus", () => {
  const a = enemyStats('shade', 0);
  const b = enemyStats('shade', 6);
  assert.ok(ticks(b.windup) < ticks(a.windup));
  assert.ok(b.hp > a.hp);
  assert.ok(b.damage > a.damage);
});

test('élite : nettement plus résistante et plus forte', () => {
  const n = enemyStats('shade', 3, false);
  const e = enemyStats('shade', 3, true);
  assert.ok(e.hp >= n.hp * 2);
  assert.equal(e.damage, n.damage + DIFFICULTY.elite.damageBonus);
});

test('les ennemis créés en profondeur sont plus robustes (état réel)', () => {
  const s = createGameState('profondeur');
  const hp0 = Math.max(...s.enemies.filter((e) => e.type === 'shade' && !e.elite).map((e) => e.maxHp));
  enterFloor(s, 6);
  const hp6 = Math.max(...s.enemies.filter((e) => e.type === 'shade' && !e.elite).map((e) => e.maxHp));
  assert.ok(hp6 > hp0, `${hp0} -> ${hp6}`);
});

test('élites et Furies : absentes au début, de plus en plus présentes en descendant', () => {
  const count = (floor) => {
    let elites = 0;
    let furies = 0;
    let total = 0;
    for (let i = 0; i < 40; i++) {
      const list = populateFloor(generateFloor(`peuple-${i}`, floor), `peuple-${i}`, floor);
      total += list.length;
      elites += list.filter((e) => e.elite).length;
      furies += list.filter((e) => e.type === 'fury').length;
    }
    return { elites: elites / total, furies: furies / total };
  };
  const f0 = count(0);
  const f1 = count(1);
  const f6 = count(6);
  assert.equal(f0.furies, 0);
  assert.equal(f1.furies, 0);
  assert.ok(f6.furies > 0.1, `furies étage 7 : ${f6.furies}`);
  assert.ok(f6.elites > f0.elites * 2, `élites ${f0.elites} -> ${f6.elites}`);
  // Les Ombres (corps à corps) ne disparaissent pas en profondeur
  const shades = (floor) => {
    let n = 0;
    let t = 0;
    for (let i = 0; i < 40; i++) {
      const list = populateFloor(generateFloor(`peuple-${i}`, floor), `peuple-${i}`, floor);
      t += list.length;
      n += list.filter((e) => e.type === 'shade').length;
    }
    return n / t;
  };
  for (const f of [6, 8, 12]) assert.ok(shades(f) >= 0.3, `étage ${f + 1} : seulement ${Math.round(shades(f) * 100)} % d'Ombres`);
});

// ---------- La Furie ----------

function arena() {
  const s = createGameState('furie', { enemies: false });
  const W = 24;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r < W - 1; r++) for (let c = 1; c < W - 1; c++) tiles[r * W + c] = TILE.FLOOR;
  s.dungeon = { width: W, height: W, tiles, rooms: [], decor: [], start: { c: 12, r: 12 }, stairs: { c: 1, r: 1 } };
  s.chests = [];
  Object.assign(s.player, { x: 12.5, z: 16.5, vx: 0, vz: 0, facing: 0 });
  return s;
}
function addFury(s, z = 11.5) {
  const e = createEnemy(s, { type: 'fury', x: 12.5, z });
  Object.assign(e, { alert: true, mode: 'chase' });
  s.enemies.push(e);
  return e;
}
const run = (s, n, intent = {}) => {
  for (let i = 0; i < n; i++) stepGame(s, typeof intent === 'function' ? intent(i) : intent);
};

test('Furie : annonce sa charge (sans dégât) puis touche le héros resté dans la ligne', () => {
  const s = arena();
  const e = addFury(s);
  stepGame(s, {});
  assert.equal(e.mode, 'windup');
  run(s, ticks(SIM.enemies.fury.windup) - 2);
  assert.equal(s.player.hp, SIM.player.maxHp, 'touché pendant l\'annonce');
  run(s, 40);
  assert.equal(s.player.hp, SIM.player.maxHp - SIM.enemies.fury.damage, 'la charge aurait dû toucher');
});

test("Furie : un pas de côté pendant l'annonce suffit à l'éviter", () => {
  const s = arena();
  addFury(s);
  stepGame(s, {});
  // On s'écarte vers l'est pendant l'annonce
  run(s, ticks(SIM.enemies.fury.windup), { moveX: 1, moveY: 0 });
  run(s, 40);
  assert.equal(s.player.hp, SIM.player.maxHp);
});

test("Furie : esquiver à travers la charge l'évite, et elle ne touche qu'une fois par charge", () => {
  const s = arena();
  const e = addFury(s);
  stepGame(s, {});
  run(s, ticks(SIM.enemies.fury.windup));
  // Elle charge vers le sud : on esquive vers le nord, à travers elle
  let g = 0;
  while (e.mode === 'charge' && Math.abs(e.z - s.player.z) > 1.4 && g++ < 60) stepGame(s, {});
  stepGame(s, { moveX: 0, moveY: 1, dash: true });
  run(s, 30);
  assert.equal(s.player.hp, SIM.player.maxHp);

  const s2 = arena();
  addFury(s2);
  stepGame(s2, {});
  s2.player.invuln = 0;
  run(s2, 80, () => {
    s2.player.invuln = 0; // aucune protection : on compte les coups bruts
    return {};
  });
  const hits = SIM.player.maxHp - s2.player.hp;
  assert.equal(hits, SIM.enemies.fury.damage, `touché ${hits / SIM.enemies.fury.damage} fois par une seule charge`);
});

test("Furie : si elle percute un mur, elle reste étourdie plus longtemps", () => {
  const s = arena();
  // Mur entre la Furie et le héros, assez loin pour qu'elle ait le temps de s'élancer
  const e = addFury(s, 6.5);
  s.player.z = 12.5;
  s.player.invuln = 99999;
  stepGame(s, {});
  for (let c = 1; c < 23; c++) s.dungeon.tiles[9 * 24 + c] = TILE.WALL;
  run(s, ticks(SIM.enemies.fury.windup) + 20);
  assert.equal(e.mode, 'recover');
  assert.ok(e.timer > ticks(SIM.enemies.fury.recover), 'étourdissement de mur trop court');
  assert.ok(!overlapsSolid(s.dungeon, e, SIM.enemies.fury.radius));
});

test("Furie : n'annonce pas de charge si un obstacle bouche la voie", () => {
  const s = arena();
  s.dungeon.tiles[14 * 24 + 12] = TILE.PILLAR;
  const e = addFury(s);
  s.player.invuln = 99999;
  stepGame(s, {});
  assert.equal(e.mode, 'chase');
});
