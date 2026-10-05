// Tests de la méta-progression (étape 6) : arbre, profil, Ombres, et effet réel
// de chaque amélioration permanente dans la simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE } from '../src/dungeon/tiles.js';
import { rerollCost } from '../src/systems/descent.js';
import { sanitizeIntent } from '../src/systems/intent.js';
import { hurtPlayer } from '../src/systems/player.js';
import { TREE, NODE_IDS, BRANCHES, cleanRanks } from '../src/meta/tree.js';
import {
  newProfile,
  buy,
  buyBlocker,
  nextCost,
  refundAll,
  spentShadows,
  recordRun,
  sanitizeProfile,
} from '../src/meta/profile.js';
import { scriptedIntents, stateHash } from './helpers.js';

function arena(meta = {}) {
  const s = createGameState('meta', { enemies: false, meta });
  const W = 22;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r < W - 1; r++) for (let c = 1; c < W - 1; c++) tiles[r * W + c] = TILE.FLOOR;
  s.dungeon = { width: W, height: W, tiles, rooms: [], decor: [], start: { c: 11, r: 11 }, stairs: { c: 1, r: 1 } };
  s.chests = [];
  s.pickups = [];
  Object.assign(s.player, { x: 11.5, z: 11.5, vx: 0, vz: 0, facing: 0 });
  return s;
}
function addEnemy(s, type, x, z, extra = {}) {
  const e = createEnemy(s, { type, x, z });
  Object.assign(e, extra);
  s.enemies.push(e);
  return e;
}
const run = (s, n, intent = {}) => {
  for (let i = 0; i < n; i++) stepGame(s, intent);
};
const SOUTH = { aimX: 0, aimY: -1 };
function onStairs(meta = {}) {
  const s = createGameState('charon-meta', { enemies: false, meta });
  s.player.x = s.dungeon.stairs.c + 0.5;
  s.player.z = s.dungeon.stairs.r + 0.5;
  stepGame(s, {});
  return s;
}

// ---------- L'arbre ----------

test("arbre : chaque nœud a une branche connue, des prix croissants et un prérequis de la même branche", () => {
  const branches = new Set(BRANCHES.map((b) => b.id));
  for (const id of NODE_IDS) {
    const n = TREE[id];
    assert.ok(branches.has(n.branch), `${id} : branche inconnue`);
    assert.ok(n.costs.length >= 1);
    for (let k = 1; k < n.costs.length; k++) assert.ok(n.costs[k] > n.costs[k - 1], `${id} : prix non croissants`);
    if (n.requires) {
      assert.ok(TREE[n.requires], `${id} : prérequis inconnu`);
      assert.equal(TREE[n.requires].branch, n.branch, `${id} : prérequis d'une autre branche`);
    }
    assert.equal(typeof n.text(n.per), 'string');
  }
  // Chaque branche a exactement une racine (nœud sans prérequis)
  for (const b of branches) assert.equal(NODE_IDS.filter((id) => TREE[id].branch === b && !TREE[id].requires).length, 1, b);
});

test('rangs nettoyés : nœuds inconnus retirés, rangs plafonnés, valeurs bizarres ignorées', () => {
  assert.deepEqual(cleanRanks({ blade: 9, inconnu: 2, vigor: -1, fleet: 1.5, purse: '2', crit: 1 }), { blade: 2, crit: 1 });
  assert.deepEqual(cleanRanks(null), {});
});

// ---------- Le profil ----------

test('achat : verrouillé sans prérequis, refusé si trop cher, plafonné au rang maximum', () => {
  const p = newProfile();
  p.shadows = 1000;
  assert.equal(buyBlocker(p, 'swift'), 'verrouillé');
  assert.equal(buy(p, 'swift'), false);
  assert.ok(buy(p, 'blade'));
  assert.equal(p.shadows, 1000 - TREE.blade.costs[0]);
  assert.ok(buy(p, 'swift'), 'débloqué par Lame trempée');
  assert.ok(buy(p, 'blade'));
  assert.equal(nextCost(p, 'blade'), null);
  assert.equal(buyBlocker(p, 'blade'), 'maximum');
  assert.equal(buy(p, 'blade'), false);
  p.shadows = 0;
  assert.equal(buyBlocker(p, 'vigor'), 'trop cher');
  assert.equal(p.ranks.blade, 2);
});

test('remise à zéro : toutes les Ombres investies sont rendues', () => {
  const p = newProfile();
  p.shadows = 500;
  for (const id of ['vigor', 'vigor', 'roots', 'purse', 'tithe']) assert.ok(buy(p, id), id);
  const spent = spentShadows(p);
  assert.equal(p.shadows + spent, 500);
  refundAll(p);
  assert.equal(p.shadows, 500);
  assert.deepEqual(p.ranks, {});
});

test('fin de partie : Ombres encaissées (Dîme comprise) et statistiques à jour', () => {
  const p = newProfile();
  const run1 = { shadows: 40, floorIndex: 3, status: 'dead' };
  assert.equal(recordRun(p, run1), 40);
  p.ranks = { purse: 1, tithe: 2 }; // +20 %
  const run2 = { shadows: 100, floorIndex: 8, status: 'victory' };
  assert.equal(recordRun(p, run2), 120);
  assert.equal(p.shadows, 160);
  assert.deepEqual(p.stats, { runs: 2, victories: 1, bestFloor: 9, totalShadows: 160 });
});

test('profil abîmé ou trafiqué : relu sans planter, valeurs invalides remises à zéro', () => {
  for (const raw of [null, 'texte', 42, [], { shadows: -5, ranks: 'x', stats: null }, { shadows: 1e3, ranks: { blade: 7 } }]) {
    const p = sanitizeProfile(raw);
    assert.ok(Number.isInteger(p.shadows) && p.shadows >= 0);
    assert.ok(p.ranks.blade === undefined || p.ranks.blade <= 2);
    assert.equal(p.stats.runs, 0);
  }
  assert.equal(sanitizeProfile({ shadows: 1000 }).shadows, 1000);
});

// ---------- Les Ombres pendant la partie ----------

test('Ombres : +1 par ennemi, +3 par élite, rien pour un serviteur dissipé', () => {
  const s = arena();
  addEnemy(s, 'shade', 11.5, 12.6, { hp: 1 });
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(s.shadows, SIM.shadows.enemy);
  run(s, ticks(1));
  addEnemy(s, 'shade', 11.5, 12.6, { hp: 1, elite: true });
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(s.shadows, SIM.shadows.enemy + SIM.shadows.elite);
});

test('Ombres : +5 par étage atteint, et le boss rapporte sa récompense', () => {
  const s = onStairs();
  stepGame(s, { choice: 0 });
  assert.equal(s.shadows, SIM.shadows.floor);
  const a = arena();
  addEnemy(a, 'cerberus', 11.5, 12.9, { hp: 1, alert: true, boss: true });
  stepGame(a, { ...SOUTH, attack: true });
  assert.equal(a.shadows, SIM.shadows.bosses.cerberus);
});

// ---------- Effet réel de chaque amélioration ----------

test('sans amélioration, une partie est identique à celle d\'avant (aucun tirage en plus)', () => {
  const intents = scriptedIntents(1500, 3);
  const a = createGameState('identique');
  const b = createGameState('identique', { meta: {} });
  for (const i of intents) {
    stepGame(a, i);
    stepGame(b, i);
  }
  assert.equal(stateHash(a), stateHash(b));
});

test('même graine + mêmes améliorations = même partie (avec coups critiques)', () => {
  const meta = { blade: 2, swift: 2, crit: 2, vigor: 3, fleet: 2, doubleDash: 1, reflect: 1 };
  const intents = scriptedIntents(2500, 7);
  const a = createGameState('rejeu-meta', { meta });
  const b = createGameState('rejeu-meta', { meta });
  for (const i of intents) {
    stepGame(a, i);
    stepGame(b, i);
  }
  assert.equal(stateHash(a), stateHash(b));
});

test('Sève d\'Asphodèle et Bourse du passeur : PV et oboles de départ', () => {
  const s = createGameState('depart', { meta: { vigor: 3, purse: 2 } });
  assert.equal(s.player.maxHp, SIM.player.maxHp + 6);
  assert.equal(s.player.hp, s.player.maxHp);
  assert.equal(s.gold, 30);
});

test('Lame trempée : +1 dégât par rang', () => {
  const s = arena({ blade: 2 });
  const e = addEnemy(s, 'shade', 11.5, 12.6, { hp: 10, maxHp: 10 });
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(e.hp, 10 - 3);
});

test('Bras infatigable : plus de coups dans le même temps', () => {
  const swings = (meta) => {
    const s = arena(meta);
    let n = 0;
    for (let i = 0; i < 240; i++) {
      stepGame(s, { ...SOUTH, attack: true });
      n += s.events.filter((x) => x.type === 'swing').length;
    }
    return n;
  };
  assert.ok(swings({ blade: 1, swift: 2 }) > swings({ blade: 1 }));
});

test('Coup du destin : environ 20 % de coups doublés au rang 2, jamais sans', () => {
  const crits = (meta) => {
    const s = arena(meta);
    const e = addEnemy(s, 'shade', 11.5, 12.6, { hp: 1e6, maxHp: 1e6 });
    let n = 0;
    let hits = 0;
    for (let i = 0; i < 6000; i++) {
      e.x = 11.5;
      e.z = 12.6;
      e.kvx = 0;
      e.kvz = 0;
      e.mode = 'recover';
      e.timer = 99;
      stepGame(s, { ...SOUTH, attack: true });
      for (const ev of s.events) {
        if (ev.type !== 'hit') continue;
        hits++;
        if (ev.crit) n++;
      }
    }
    return n / hits;
  };
  assert.equal(crits({}), 0);
  // Sans l'amélioration, un coup ne consomme aucun tirage (les parties restent celles d'avant)
  const s = arena();
  addEnemy(s, 'shade', 11.5, 12.6, { hp: 99, maxHp: 99, mode: 'recover', timer: 99 });
  const rng = JSON.stringify(s.rng);
  stepGame(s, { ...SOUTH, attack: true });
  assert.ok(s.events.some((e) => e.type === 'hit'));
  assert.equal(JSON.stringify(s.rng), rng);
  const r = crits({ blade: 1, swift: 1, crit: 2 });
  assert.ok(r > 0.15 && r < 0.25, `taux de critiques ${r}`);
});

test('Second souffle : deux esquives enchaînées, une seule sans', () => {
  const dashes = (meta) => {
    const s = arena(meta);
    let n = 0;
    for (let i = 0; i < 24; i++) {
      // appui puis relâchement à chaque pas pair/impair
      stepGame(s, { moveX: i % 4 < 2 ? 1 : -1, dash: i % 2 === 0 });
      n += s.events.filter((x) => x.type === 'dash').length;
    }
    return n;
  };
  assert.equal(dashes({}), 1);
  assert.equal(dashes({ fleet: 1, doubleDash: 1 }), 2);
  // ... puis les deux charges reviennent
  const s = arena({ fleet: 1, doubleDash: 1 });
  run(s, 2, { dash: true });
  run(s, ticks(SIM.player.dash.duration) + 2, {}); // fin de la première esquive
  run(s, 2, { dash: true });
  assert.equal(s.player.dashCharges, 0);
  run(s, ticks(SIM.player.dash.cooldown) * 2 + 5, {});
  assert.equal(s.player.dashCharges, 2);
});

test('Défi de la Mort : on se relève une fois (30 % puis 60 % des PV), la seconde mort est définitive', () => {
  for (const [rank, part] of [[1, 0.3], [2, 0.6]]) {
    const s = arena({ vigor: 1, roots: 1, defiance: rank });
    hurtPlayer(s, 999, 0, 0);
    assert.equal(s.status, 'playing');
    assert.equal(s.player.hp, Math.round(s.player.maxHp * part));
    assert.ok(s.player.invuln > 0);
    assert.ok(s.events.some((e) => e.type === 'defiance'));
    s.player.invuln = 0;
    hurtPlayer(s, 999, 0, 0);
    assert.equal(s.status, 'dead');
  }
  const s = arena();
  hurtPlayer(s, 999, 0, 0);
  assert.equal(s.status, 'dead', 'sans amélioration, la mort reste définitive');
});

test('Racines nourricières : soin à chaque nouvel étage', () => {
  const s = onStairs({ vigor: 1, roots: 2 });
  s.player.hp = 3;
  stepGame(s, { choice: 0 });
  assert.equal(s.player.hp, 3 + 4);
});

test('Faveur des dieux : 4 bienfaits proposés, le 4e se choisit ; Ami du passeur : 1 relance gratuite', () => {
  assert.equal(sanitizeIntent({ choice: 3 }).choice, 3);
  assert.equal(sanitizeIntent({ choice: 4 }).choice, -1);
  const s = onStairs({ purse: 1, choice4: 1, freeReroll: 1 });
  assert.equal(s.offer.boons.length, 4);
  const gold = s.gold;
  assert.equal(rerollCost(s), 0);
  stepGame(s, { shop: 'reroll' });
  assert.equal(s.gold, gold, 'la première relance doit être gratuite');
  assert.ok(rerollCost(s) > 0);
  const id = s.offer.boons[3];
  stepGame(s, { choice: 3 });
  assert.equal(s.player.boons[id], 1);
  assert.equal(s.floorIndex, 1);
  const base = onStairs();
  assert.equal(base.offer.boons.length, 3);
});

test("Bouclier du vent : esquiver à travers une flèche la renvoie sur l'archer", () => {
  const s = arena({ fleet: 1, doubleDash: 1, reflect: 1 });
  const archer = addEnemy(s, 'archer', 11.5, 17.5, { alert: true, mode: 'chase', shotCooldown: 0, hp: 50, maxHp: 50 });
  run(s, ticks(SIM.enemies.archer.windup) + 2);
  assert.equal(s.projectiles.length, 1);
  let guard = 0;
  while (s.projectiles.length && s.projectiles[0].z - s.player.z > 1.2 && guard++ < 120) stepGame(s, {});
  stepGame(s, { moveX: 0, moveY: -1, dash: true });
  let reflected = false;
  for (let i = 0; i < 90 && archer.hp === 50; i++) {
    stepGame(s, {});
    reflected ||= s.events.some((e) => e.type === 'reflect');
  }
  assert.ok(reflected, 'la flèche aurait dû être renvoyée');
  assert.equal(s.player.hp, s.player.maxHp);
  assert.ok(archer.hp < 50, "la flèche renvoyée aurait dû blesser l'archer");
});
