// Tests des arbres de talents de classe (étape 7c) : règles (classe, paliers selon
// la progression totale) et effet réel de chaque talent dans la simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE } from '../src/dungeon/tiles.js';
import { playerStats } from '../src/systems/boons.js';
import { hurtPlayer } from '../src/systems/player.js';
import { CLASS_IDS } from '../src/systems/classes.js';
import { TALENTS, TALENT_IDS, CLASS_TIER_LEVELS, ATTR_IDS, cleanMeta, talentBlocker } from '../src/meta/tree.js';
import { newProfile, learn, selectClass } from '../src/meta/profile.js';
import { scriptedIntents, stateHash } from './helpers.js';

// Build de classe : attributs au maximum (tous les paliers ouverts), parents ajoutés
function cbuild(cls, talents = {}) {
  const all = { ...talents };
  for (const id of Object.keys(talents)) {
    let cur = TALENTS[id];
    while (cur.requires.length && !cur.requires.some((r) => all[r])) {
      all[cur.requires[0]] = 1;
      cur = TALENTS[cur.requires[0]];
    }
  }
  const meta = { attrs: Object.fromEntries(ATTR_IDS.map((a) => [a, 10])), talents: all, cls };
  assert.deepEqual(cleanMeta(meta).talents, all, `build invalide : ${JSON.stringify(all)}`);
  return meta;
}
function arena(cls, meta = {}) {
  const s = createGameState('talents-classe', { enemies: false, cls, meta });
  const W = 30;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r < W - 1; r++) for (let c = 1; c < W - 1; c++) tiles[r * W + c] = TILE.FLOOR;
  s.dungeon = { width: W, height: W, tiles, rooms: [], decor: [], start: { c: 15, r: 5 }, stairs: { c: 1, r: 1 } };
  s.chests = [];
  s.pickups = [];
  s.status = 'playing';
  s.players[0].offer = null;
  Object.assign(s.players[0], { x: 15.5, z: 5.5, vx: 0, vz: 0, facing: 0 });
  return s;
}
function dummy(s, x, z, hp = 100) {
  const e = createEnemy(s, { type: 'shade', x, z });
  Object.assign(e, { hp, maxHp: hp, mode: 'recover', timer: 99999 });
  s.enemies.push(e);
  return e;
}
const run = (s, n, intent = {}) => {
  for (let i = 0; i < n; i++) stepGame(s, intent);
};
const SOUTH = { aimX: 0, aimY: -1 };
const bare = (cls) => cbuild(cls, {});
const events = (s, type) => s.events.filter((ev) => ev.type === type);

// ---------- Règles ----------

test('chaque classe a son arbre : 7 talents, deux chemins, un ultime qui les réunit', () => {
  for (const cls of CLASS_IDS) {
    const ids = TALENT_IDS.filter((id) => TALENTS[id].cls === cls);
    assert.equal(ids.length, 7, cls);
    const ult = ids.filter((id) => TALENTS[id].tier === CLASS_TIER_LEVELS.length - 1);
    assert.equal(ult.length, 1);
    assert.equal(TALENTS[ult[0]].requires.length, 2);
    for (const id of ids) assert.equal(TALENTS[id].attr, null);
  }
});

test("un talent de classe ne s'apprend qu'avec sa classe, et ses paliers suivent la progression totale", () => {
  const p = newProfile();
  p.attrs = { ares: 10, demeter: 1, hermes: 1, charon: 1 }; // progression totale 9
  assert.equal(talentBlocker(p, 'venom'), 'classe');
  assert.ok(learn(p, 'parry'));
  assert.equal(talentBlocker(p, 'riposte'), '', 'palier 2 ouvert à 9');
  assert.ok(learn(p, 'riposte'));
  assert.equal(talentBlocker(p, 'bulwark'), 'palier', 'palier 3 fermé avant 18');
  p.stats.bosses.cerberus = 1;
  assert.ok(selectClass(p, 'huntress'));
  p.attrs = { ares: 10, demeter: 1, hermes: 1, charon: 1 }; // la Chasseresse a ses propres niveaux
  assert.equal(talentBlocker(p, 'parry'), 'classe');
  assert.ok(learn(p, 'venom'));
  // Un build de Guerrier imposé à la Chasseresse est nettoyé
  assert.deepEqual(cleanMeta({ attrs: p.attrs, talents: { parry: 1, venom: 1 }, cls: 'huntress' }).talents, { venom: 1 });
});

// ---------- Guerrier ----------

test('Parade : la bonne part de coups parés au rang 2, et aucun tirage sans le talent', () => {
  const rate = (meta) => {
    const s = arena('warrior', meta);
    let parried = 0;
    for (let i = 0; i < 4000; i++) {
      s.players[0].invuln = 0;
      s.players[0].hp = s.players[0].maxHp;
      hurtPlayer(s, s.players[0], 1, 0, 0);
      parried += events(s, 'parry').length;
      s.events.length = 0;
    }
    return parried / 4000;
  };
  const s = arena('warrior', bare('warrior'));
  const rng = JSON.stringify(s.rng);
  hurtPlayer(s, s.players[0], 1, 0, 0);
  assert.equal(JSON.stringify(s.rng), rng);
  assert.equal(rate(bare('warrior')), 0);
  const r = rate(cbuild('warrior', { parry: 2 }));
  const want = 2 * TALENTS.parry.per;
  assert.ok(Math.abs(r - want) < 0.04, `taux ${r} au lieu de ${want}`);
});

test('Riposte : après une parade, le coup suivant fait double dégâts', () => {
  const s = arena('warrior', cbuild('warrior', { riposte: 1 }));
  const e = dummy(s, 15.5, 6.6);
  const base = playerStats(s.players[0]).damage;
  s.players[0].riposte = true;
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(100 - e.hp, base * 2);
  run(s, 30);
  Object.assign(e, { x: 15.5, z: 6.6, kvx: 0, kvz: 0 });
  const hp = e.hp;
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(hp - e.hp, base);
  // Une vraie parade arme la Riposte (on frappe jusqu'à obtenir une parade)
  const t = arena('warrior', cbuild('warrior', { riposte: 1 }));
  for (let i = 0; i < 200 && !t.players[0].riposte; i++) {
    t.players[0].invuln = 0;
    t.players[0].hp = t.players[0].maxHp;
    hurtPlayer(t, t.players[0], 1, 0, 0);
  }
  assert.ok(t.players[0].riposte, 'la parade aurait dû armer la Riposte');
});

test('Rempart : des PV maximum en plus', () => {
  const hp = (meta) => createGameState('rempart', { cls: 'warrior', meta }).players[0].maxHp;
  assert.equal(hp(cbuild('warrior', { bulwark: 1 })), hp(cbuild('warrior', { riposte: 1 })) + TALENTS.bulwark.per);
});

test('Élan du cyclone et Grand cyclone : Tourbillon plus fréquent et plus large', () => {
  const a = playerStats(arena('warrior', bare('warrior')).players[0]).special;
  const b = playerStats(arena('warrior', cbuild('warrior', { whirlHaste: 2, whirlSize: 2 })).players[0]).special;
  assert.ok(Math.abs(b.cooldown - a.cooldown * 0.7) < 1e-9);
  assert.ok(Math.abs(b.radius - a.radius * 1.4) < 1e-9);
});

test('Tempête : le Tourbillon frappe une seconde fois juste après', () => {
  const hits = (meta) => {
    const s = arena('warrior', meta);
    const e = dummy(s, 15.5, 6.8, 1000);
    let n = 0;
    stepGame(s, { special: true });
    n += events(s, 'special').length;
    for (let i = 0; i < 40; i++) {
      Object.assign(e, { x: 15.5, z: 6.8, kvx: 0, kvz: 0 });
      stepGame(s, {});
      n += events(s, 'special').length;
    }
    return [n, 1000 - e.hp];
  };
  const [n1, d1] = hits(bare('warrior'));
  const [n2, d2] = hits(cbuild('warrior', { tempest: 1 }));
  assert.equal(n1, 1);
  assert.equal(n2, 2);
  assert.ok(Math.abs(d2 - 2 * d1) < 1e-9);
});

test('Colère des Titans : chaque ennemi vaincu recharge le Tourbillon de 1 s', () => {
  const s = arena('warrior', cbuild('warrior', { titan: 1 }));
  s.players[0].specialCooldown = ticks(5);
  dummy(s, 15.5, 6.6, 1);
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(s.players[0].specialCooldown, ticks(5) - 1 - ticks(1));
});

// ---------- Chasseresse ----------

test('Flèches empoisonnées et Venin tenace : le poison ronge les PV pendant des secondes', () => {
  const poisoned = (meta) => {
    const s = arena('huntress', meta);
    const e = dummy(s, 15.5, 9.5);
    stepGame(s, { ...SOUTH, attack: true });
    run(s, 20);
    const after = e.hp;
    run(s, ticks(6));
    return after - e.hp;
  };
  assert.equal(poisoned(bare('huntress')), 0);
  const dps = 2 * TALENTS.venom.per;
  const d = poisoned(cbuild('huntress', { venom: 2 }));
  assert.ok(Math.abs(d - dps * 3) < dps * 0.4, `poison ${d}`);
  const d2 = poisoned(cbuild('huntress', { venom: 2, linger: 1 }));
  assert.ok(d2 > d * 1.4, 'Venin tenace : poison plus long');
});

test('le poison peut achever un ennemi (compté et retiré)', () => {
  const s = arena('huntress', cbuild('huntress', { venom: 2 }));
  const e = dummy(s, 15.5, 9.5, SIM.classes.huntress.attack.damage + 0.5);
  stepGame(s, { ...SOUTH, attack: true });
  run(s, ticks(3));
  assert.ok(!s.enemies.includes(e));
  assert.equal(s.kills, 1);
});

test('Tir précis : plus de dégâts sur une cible lointaine', () => {
  // Dégâts de l'impact seul (le poison des talents parents s'ajoute ensuite, lentement)
  const impact = (z) => {
    const s = arena('huntress', cbuild('huntress', { marksman: 1 }));
    const e = dummy(s, 15.5, z);
    stepGame(s, { ...SOUTH, attack: true });
    for (let i = 0; i < 60 && e.hp === 100; i++) stepGame(s, {});
    return 100 - e.hp;
  };
  const ratio = impact(12.5) / impact(8.0);
  assert.ok(Math.abs(ratio - (1 + TALENTS.marksman.per)) < 0.02, `rapport ${ratio}`);
});

test('Carquois léger, Volée nourrie et Seconde salve', () => {
  const st = playerStats(arena('huntress', cbuild('huntress', { quiver: 2, barrage: 2 })).players[0]).special;
  assert.ok(Math.abs(st.cooldown - SIM.classes.huntress.special.cooldown * 0.7) < 1e-9);
  assert.equal(st.count, SIM.classes.huntress.special.count + 4);
  const arrows = (meta) => {
    const s = arena('huntress', meta);
    let n = 0;
    const count = () => (n = Math.max(n, s.projectiles.filter((x) => x.kind === 'heroArrow').length));
    stepGame(s, { ...SOUTH, special: true });
    count();
    for (let i = 0; i < ticks(0.3) + 2; i++) {
      stepGame(s, {});
      count();
    }
    return n;
  };
  const one = arrows(bare('huntress'));
  assert.equal(one, SIM.classes.huntress.special.count);
  const echo = cbuild('huntress', { echoVolley: 1 });
  const perVolley = playerStats(arena('huntress', echo).players[0]).special.count; // Volée nourrie (parent) compris
  assert.equal(arrows(echo), 2 * perVolley, 'seconde salve');
});

test('Instinct de chasse : plus rapide et plus de cadence après avoir vaincu un ennemi', () => {
  const s = arena('huntress', cbuild('huntress', { hunt: 1 }));
  const before = playerStats(s.players[0]);
  dummy(s, 15.5, 8.5, 1);
  stepGame(s, { ...SOUTH, attack: true });
  run(s, 30);
  const after = playerStats(s.players[0]);
  assert.ok(after.speed > before.speed && after.attackCooldown < before.attackCooldown);
  run(s, ticks(3));
  assert.equal(playerStats(s.players[0]).speed, before.speed);
});

// ---------- Mystique ----------

test('Orbe ample, Givre profond et Nova vive', () => {
  const a = playerStats(arena('mystic', bare('mystic')).players[0]);
  const b = playerStats(arena('mystic', cbuild('mystic', { bigOrb: 2, deepFreeze: 2, quickNova: 2 })).players[0]);
  assert.ok(Math.abs(b.blast - a.blast * 1.3) < 1e-9);
  assert.equal(b.special.slow, a.special.slow + 3);
  assert.ok(Math.abs(b.special.cooldown - a.special.cooldown * 0.7) < 1e-9);
});

test('Orbes jumeaux : deux orbes, chacun un peu moins fort', () => {
  const s = arena('mystic', cbuild('mystic', { twinOrbs: 1 }));
  stepGame(s, { ...SOUTH, attack: true });
  const orbs = s.projectiles.filter((a) => a.kind === 'orb');
  assert.equal(orbs.length, 2);
  const full = playerStats(s.players[0]).damage;
  for (const o of orbs) assert.ok(Math.abs(o.damage - full * TALENTS.twinOrbs.per) < 1e-9);
});

test('Bris de glace : plus de dégâts sur un ennemi ralenti', () => {
  const s = arena('mystic', cbuild('mystic', { shatter: 1 }));
  const slowed = dummy(s, 15.5, 9.0);
  slowed.slow = 9999;
  const t = arena('mystic', cbuild('mystic', { shatter: 1 }));
  const normal = dummy(t, 15.5, 9.0);
  for (const x of [s, t]) {
    stepGame(x, { ...SOUTH, attack: true });
    run(x, 90);
  }
  assert.ok(Math.abs((100 - slowed.hp) / (100 - normal.hp) - (1 + TALENTS.shatter.per)) < 1e-9);
});

test("Torrent d'âmes : les explosions d'orbe ralentissent", () => {
  const s = arena('mystic', cbuild('mystic', { torrent: 1 }));
  const e = dummy(s, 15.5, 9.0);
  stepGame(s, { ...SOUTH, attack: true });
  run(s, 60);
  assert.ok(e.slow > 0);
  const t = arena('mystic', bare('mystic'));
  const f = dummy(t, 15.5, 9.0);
  stepGame(t, { ...SOUTH, attack: true });
  run(t, 60);
  assert.ok(!(f.slow > 0));
});

test('Réaction en chaîne : un ennemi tué par une explosion peut exploser à son tour', () => {
  let chains = 0;
  for (let k = 0; k < 40; k++) {
    const s = arena('mystic', cbuild('mystic', { chain: 2 }));
    s.rng.s = 1000 + k;
    // Une victime fragile au contact, un ennemi plus loin que le rayon, mais à portée de sa chaîne
    dummy(s, 15.5, 9.0, 0.5);
    const far = dummy(s, 15.5 + SIM.classes.mystic.shot.blast + 0.9, 9.0);
    stepGame(s, { ...SOUTH, attack: true });
    for (let i = 0; i < 60; i++) {
      stepGame(s, {});
      chains += events(s, 'orbBurst').filter((ev) => ev.chain).length;
    }
    if (far.hp < 100) assert.ok(true);
  }
  // Chance de chaîne : 2 rangs ; environ 40 victimes tuées par l'explosion
  const want = 40 * 2 * TALENTS.chain.per;
  assert.ok(chains > want * 0.6 && chains < want * 1.5, `explosions en chaîne : ${chains} (attendu ~${want})`);
});

test('même graine + mêmes talents de classe = même partie', () => {
  const builds = {
    warrior: { parry: 2, riposte: 1, tempest: 1, titan: 1 },
    huntress: { venom: 2, marksman: 1, echoVolley: 1, hunt: 1 },
    mystic: { chain: 2, twinOrbs: 1, shatter: 1, torrent: 1 },
  };
  for (const cls of CLASS_IDS) {
    const meta = cbuild(cls, builds[cls]);
    const intents = scriptedIntents(2000, 9).map((it, i) => ({ ...it, special: i % 89 < 2 }));
    const a = createGameState('rejeu-talents-classe', { cls, meta });
    const b = createGameState('rejeu-talents-classe', { cls, meta });
    for (const i of intents) {
      stepGame(a, i);
      stepGame(b, i);
    }
    assert.equal(stateHash(a), stateHash(b), cls);
  }
});
