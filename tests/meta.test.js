// Tests de la méta-progression (étape 6) : attributs et arbres de talents, profil,
// Ombres, code d'export, et effet réel de chaque talent dans la simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE } from '../src/dungeon/tiles.js';
import { rerollCost, healCost } from '../src/systems/descent.js';
import { sanitizeIntent } from '../src/systems/intent.js';
import { hurtPlayer } from '../src/systems/player.js';
import { playerStats } from '../src/systems/boons.js';
import {
  ATTRS,
  ATTR_IDS,
  ATTR_MAX,
  ATTR_COSTS,
  TALENTS,
  TALENT_IDS,
  TIER_LEVELS,
  cleanMeta,
  talentPoints,
  talentBlocker,
  talentCost,
} from '../src/meta/tree.js';
import {
  newProfile,
  buyLevel,
  levelCost,
  levelBlocker,
  learn,
  freePoints,
  resetTalents,
  investedShadows,
  recordRun,
  sanitizeProfile,
  metaOf,
} from '../src/meta/profile.js';
import { encodeProfile, decodeProfile } from '../src/meta/transfer.js';
import { hashString } from '../src/core/rng.js';
import { scriptedIntents, stateHash } from './helpers.js';

// Jeu d'améliorations pour les tests : attributs au maximum (sauf indication),
// talents demandés + leurs parents ajoutés automatiquement (1 rang chacun)
function build(talents = {}, attrs = {}) {
  const all = { ...talents };
  for (const id of Object.keys(talents)) {
    let cur = TALENTS[id];
    while (cur.requires.length && !cur.requires.some((r) => all[r])) {
      all[cur.requires[0]] = 1;
      cur = TALENTS[cur.requires[0]];
    }
  }
  const lv = Object.fromEntries(ATTR_IDS.map((a) => [a, attrs[a] ?? ATTR_MAX]));
  const meta = { attrs: lv, talents: all };
  assert.deepEqual(cleanMeta(meta).talents, all, `build invalide : ${JSON.stringify(all)}`);
  return meta;
}
// Mêmes attributs, sans aucun talent : référence pour mesurer l'effet d'un talent seul
const bare = () => build({});

function arena(meta = {}) {
  const s = createGameState('meta', { enemies: false, meta });
  const W = 22;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r < W - 1; r++) for (let c = 1; c < W - 1; c++) tiles[r * W + c] = TILE.FLOOR;
  s.dungeon = { width: W, height: W, tiles, rooms: [], decor: [], start: { c: 11, r: 11 }, stairs: { c: 1, r: 1 } };
  s.chests = [];
  s.pickups = [];
  s.status = 'playing';
  s.offer = null;
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
  s.status = 'playing';
  s.offer = null;
  s.player.x = s.dungeon.stairs.c + 0.5;
  s.player.z = s.dungeon.stairs.r + 0.5;
  stepGame(s, {});
  return s;
}
// Dégâts d'un coup unique sur une Ombre robuste placée juste devant
function hitDamage(s, extra = {}) {
  const e = addEnemy(s, 'shade', 11.5, 12.6, { hp: 100, maxHp: 100, mode: 'recover', timer: 99, ...extra });
  const before = e.hp;
  stepGame(s, { ...SOUTH, attack: true });
  return before - e.hp;
}

// ---------- Les règles de l'arbre ----------

test('arbres : talents bien formés, parents du même attribut et d\'un palier inférieur, un ultime par arbre', () => {
  assert.equal(ATTR_COSTS.length, ATTR_MAX - 1);
  for (let k = 1; k < ATTR_COSTS.length; k++) assert.ok(ATTR_COSTS[k] > ATTR_COSTS[k - 1]);
  for (const id of TALENT_IDS) {
    const t = TALENTS[id];
    assert.ok(t.cls ? !t.attr : ATTRS[t.attr], `${id} : attribut ou classe`);
    assert.ok(t.tier >= 0 && t.tier < TIER_LEVELS.length, `${id} : palier`);
    assert.ok(Number.isInteger(t.ranks) && t.ranks >= 1);
    assert.equal(typeof t.text(t.per * t.ranks), 'string');
    assert.equal(t.requires.length === 0, t.tier === 0, `${id} : seul le premier palier est sans parent`);
    for (const r of t.requires) {
      assert.ok(TALENTS[r], `${id} : parent inconnu ${r}`);
      assert.equal(TALENTS[r].attr, t.attr, `${id} : parent d'un autre attribut`);
      assert.equal(TALENTS[r].cls, t.cls, `${id} : parent d'une autre classe`);
      assert.ok(TALENTS[r].tier < t.tier, `${id} : parent pas plus bas`);
    }
  }
  for (const a of ATTR_IDS) {
    const ult = TALENT_IDS.filter((id) => TALENTS[id].attr === a && TALENTS[id].tier === 3);
    assert.equal(ult.length, 1, `${a} : un seul talent ultime`);
    assert.equal(TALENTS[ult[0]].requires.length, 2, `${a} : l'ultime réunit les deux chemins`);
  }
});

test("builds : un arbre complet et le bas d'un deuxième, il faut choisir", () => {
  const points = talentPoints(Object.fromEntries(ATTR_IDS.map((a) => [a, ATTR_MAX])));
  assert.equal(points, ATTR_IDS.length * (ATTR_MAX - 1));
  const treeCost = (a) => TALENT_IDS.filter((id) => TALENTS[id].attr === a).reduce((s, id) => s + TALENTS[id].ranks * talentCost(id), 0);
  const costs = ATTR_IDS.map(treeCost).sort((x, y) => x - y);
  assert.ok(costs[3] <= points, `l'arbre le plus cher (${costs[3]}) doit pouvoir être complété`);
  assert.ok(costs[0] + costs[1] > points, 'deux arbres complets ne doivent pas tenir');
  assert.ok(costs.reduce((x, y) => x + y, 0) > points * 2.5, 'pas assez de choix');
});

test("talents chers en haut de l'arbre : 1, 2, 3 puis 4 points par rang", () => {
  const p = newProfile();
  p.attrs = { ares: 10, demeter: 2, hermes: 1, charon: 1 }; // 10 points
  assert.ok(learn(p, 'swift'));
  assert.equal(freePoints(p), 9);
  assert.ok(learn(p, 'blade'));
  assert.equal(freePoints(p), 7);
  assert.ok(learn(p, 'cleave'));
  assert.equal(freePoints(p), 4);
  assert.ok(learn(p, 'rage'));
  assert.equal(freePoints(p), 0);
  assert.equal(talentBlocker(p, 'reach'), 'pas de point');
});

test('nettoyage : palier non atteint, parent manquant, points en trop ou valeurs absurdes sont ignorés', () => {
  // Arès niveau 3 : le palier 2 (niveau 4) est fermé
  const a = cleanMeta({ attrs: { ares: 3 }, talents: { swift: 1, blade: 1 } });
  assert.deepEqual(a.talents, { swift: 1 });
  // Parent manquant
  assert.deepEqual(cleanMeta({ attrs: { ares: 10 }, talents: { blade: 1 } }).talents, {});
  // 2 points seulement (Arès niveau 3) pour 3 rangs demandés
  assert.equal(Object.values(cleanMeta({ attrs: { ares: 3 }, talents: { swift: 3 } }).talents)[0], 2);
  // Valeurs absurdes
  const m = cleanMeta({ attrs: { ares: 99, demeter: -3, hermes: 'x' }, talents: { vigor: 9, triche: 2, fleet: 1.5 } });
  assert.equal(m.attrs.ares, ATTR_MAX);
  assert.equal(m.attrs.demeter, 1);
  assert.equal(m.attrs.hermes, 1);
  assert.deepEqual(m.talents, { vigor: TALENTS.vigor.ranks });
  assert.deepEqual(cleanMeta(null), { attrs: { ares: 1, demeter: 1, hermes: 1, charon: 1 }, talents: {}, cls: 'warrior' });
});

// ---------- Le profil ----------

test('attributs : un niveau coûte des Ombres, donne un point de talent, plafonné au niveau 10', () => {
  const p = newProfile();
  p.shadows = 10000;
  assert.equal(freePoints(p), 0);
  assert.equal(levelCost(p, 'ares'), ATTR_COSTS[0]);
  assert.ok(buyLevel(p, 'ares'));
  assert.equal(p.attrs.ares, 2);
  assert.equal(p.shadows, 10000 - ATTR_COSTS[0]);
  assert.equal(freePoints(p), 1);
  while (levelCost(p, 'ares') !== null) assert.ok(buyLevel(p, 'ares'));
  assert.equal(p.attrs.ares, ATTR_MAX);
  assert.equal(levelBlocker(p, 'ares'), 'maximum');
  assert.equal(investedShadows(p), ATTR_COSTS.reduce((a, b) => a + b, 0));
  p.shadows = 0;
  assert.equal(levelBlocker(p, 'hermes'), 'trop cher');
  assert.equal(buyLevel(p, 'hermes'), false);
});

test('talents : palier, parent et points requis ; remise à zéro gratuite qui garde les attributs', () => {
  const p = newProfile();
  p.shadows = 10000;
  assert.equal(talentBlocker(p, 'swift'), 'pas de point');
  buyLevel(p, 'ares');
  buyLevel(p, 'ares'); // niveau 3 : 2 points, palier 1 seulement
  assert.ok(learn(p, 'swift'));
  assert.equal(talentBlocker(p, 'blade'), 'palier');
  buyLevel(p, 'ares'); // niveau 4 : palier 2 ouvert (2 points libres)
  assert.equal(talentBlocker(p, 'crit'), 'verrouillé', 'Coup du destin exige Allonge');
  assert.ok(learn(p, 'reach'));
  assert.equal(talentBlocker(p, 'crit'), 'pas de point', 'un talent du palier 2 coûte 2 points');
  assert.equal(freePoints(p), 1);
  resetTalents(p);
  assert.deepEqual(p.talents, {});
  assert.equal(p.attrs.ares, 4);
  assert.equal(freePoints(p), 3);
  assert.ok(learn(p, 'swift'));
  assert.ok(learn(p, 'blade'));
  assert.equal(freePoints(p), 0);
});

test('fin de partie : Ombres encaissées (Dîme et attribut Charon compris), statistiques à jour', () => {
  const p = newProfile();
  assert.equal(recordRun(p, { shadows: 40, floorIndex: 3, status: 'dead' }), 40);
  p.attrs.charon = 6; // +10 %
  p.talents = { purse: 1, tithe: 2 }; // +20 %
  assert.equal(recordRun(p, { shadows: 100, floorIndex: 8, status: 'victory' }), 130);
  assert.equal(p.shadows, 170);
  assert.deepEqual(p.stats, { runs: 2, victories: 1, bestFloor: 9, totalShadows: 170, bosses: { cerberus: 0, hydra: 0, thanatos: 0 } });
});

test('profil abîmé ou trafiqué : relu sans planter', () => {
  for (const raw of [null, 'texte', 42, [], { shadows: -5, attrs: 'x', talents: null, stats: null }]) {
    const p = sanitizeProfile(raw);
    assert.deepEqual(p, newProfile());
  }
  const p = sanitizeProfile({ version: 2, shadows: 1000, attrs: { ares: 4 }, talents: { swift: 1, blade: 1, crit: 2 } });
  assert.equal(p.shadows, 1000);
  assert.deepEqual(p.talents, { swift: 1, blade: 1 }, 'Coup du destin sans Allonge : retiré');
});

test("ancienne sauvegarde (avant la refonte) : toutes les Ombres investies sont rendues", () => {
  const p = sanitizeProfile({ version: 1, shadows: 10, ranks: { blade: 1, vigor: 2, purse: 9 }, stats: { runs: 7 } });
  assert.equal(p.shadows, 10 + 60 + (20 + 45) + (15 + 30 + 50));
  assert.deepEqual(p.attrs, newProfile().attrs);
  assert.deepEqual(p.talents, {});
  assert.equal(p.stats.runs, 7);
});

// ---------- Les Ombres pendant la partie ----------

test('Ombres : +1 par ennemi, +3 par élite', () => {
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

// ---------- Déterminisme ----------

test("sans amélioration, une partie est identique à celle d'avant (aucun tirage en plus)", () => {
  const intents = scriptedIntents(1500, 3);
  const a = createGameState('identique');
  const b = createGameState('identique', { meta: metaOf(newProfile()) });
  for (const i of intents) {
    stepGame(a, i);
    stepGame(b, i);
  }
  assert.equal(stateHash(a), stateHash(b));
});

test('même graine + mêmes améliorations = même partie (critiques, Danse des lames, renvoi…)', () => {
  const meta = build({ crit: 2, execute: 1, bladeDance: 1, defiance: 1, momentum: 1 });
  const intents = scriptedIntents(2500, 7);
  const a = createGameState('rejeu-meta', { meta });
  const b = createGameState('rejeu-meta', { meta });
  for (const i of intents) {
    stepGame(a, i);
    stepGame(b, i);
  }
  assert.equal(stateHash(a), stateHash(b));
});

// ---------- Attributs : bonus passifs ----------

test('attributs : cadence (Arès), PV (Déméter), vitesse (Hermès)', () => {
  const low = createGameState('attr', { meta: {} });
  const high = createGameState('attr', { meta: { attrs: { ares: 10, demeter: 10, hermes: 10 } } });
  const sl = playerStats(low.player);
  const sh = playerStats(high.player);
  assert.ok(Math.abs(sh.attackCooldown / sl.attackCooldown - 0.82) < 1e-9);
  assert.equal(high.player.maxHp, low.player.maxHp + 3);
  assert.ok(Math.abs(sh.speed / sl.speed - 1.135) < 1e-9);
});

// ---------- Arès ----------

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
  assert.ok(swings(build({ swift: 3 })) > swings(bare()));
});

test('Allonge et Fendoir : portée et arc de coup plus grands', () => {
  // Juste hors de portée normale (le coup tient compte du rayon de l'ennemi)
  const far = SIM.player.attack.range + SIM.enemies.shade.radius + 0.05;
  const reached = (meta) => {
    const s = arena(meta);
    return hitDamage(s, { z: 11.5 + far }) > 0;
  };
  assert.equal(reached(bare()), false);
  assert.equal(reached(build({ reach: 2 })), true);
  // Ennemi sur le côté, juste hors de l'arc normal
  const side = (meta) => {
    const s = arena(meta);
    const ang = SIM.player.attack.arc / 2 + 0.25;
    return hitDamage(s, { x: 11.5 + Math.sin(ang) * 1.1, z: 11.5 + Math.cos(ang) * 1.1 }) > 0;
  };
  assert.equal(side(build({ blade: 1 })), false);
  assert.equal(side(build({ cleave: 2 })), true);
});

test('Lame trempée : dégâts augmentés en pourcentage', () => {
  const base = hitDamage(arena(bare()));
  assert.equal(hitDamage(arena(build({ blade: 2 }))), base * (1 + 2 * TALENTS.blade.per));
});

test('Coup du destin : environ 20 % de coups doublés au rang 2, et aucun tirage sans', () => {
  const crits = (meta) => {
    const s = arena(meta);
    const e = addEnemy(s, 'shade', 11.5, 12.6, { hp: 1e6, maxHp: 1e6 });
    let n = 0;
    let hits = 0;
    for (let i = 0; i < 6000; i++) {
      Object.assign(e, { x: 11.5, z: 12.6, kvx: 0, kvz: 0, mode: 'recover', timer: 99 });
      stepGame(s, { ...SOUTH, attack: true });
      for (const ev of s.events) {
        if (ev.type !== 'hit') continue;
        hits++;
        if (ev.crit) n++;
      }
    }
    return n / hits;
  };
  assert.equal(crits(bare()), 0);
  const s = arena(bare());
  addEnemy(s, 'shade', 11.5, 12.6, { hp: 99, maxHp: 99, mode: 'recover', timer: 99 });
  const rng = JSON.stringify(s.rng);
  stepGame(s, { ...SOUTH, attack: true });
  assert.ok(s.events.some((e) => e.type === 'hit'));
  assert.equal(JSON.stringify(s.rng), rng);
  const r = crits(build({ crit: 2 }));
  assert.ok(r > 0.15 && r < 0.25, `taux de critiques ${r}`);
});

test('Exécution : dégâts doublés sur un ennemi presque vaincu', () => {
  const low = Math.floor(100 * TALENTS.execute.per) - 1;
  const base = hitDamage(arena(bare()), { hp: low });
  assert.equal(hitDamage(arena(build({ execute: 1 })), { hp: 50 }), base);
  assert.equal(hitDamage(arena(build({ execute: 1 })), { hp: low }), base * 2);
});

test("Rage d'Arès : coups plus rapides pendant 3 s après avoir vaincu un ennemi", () => {
  const s = arena(build({ rage: 1 }));
  const normal = playerStats(s.player).attackCooldown;
  addEnemy(s, 'shade', 11.5, 12.6, { hp: 1 });
  stepGame(s, { ...SOUTH, attack: true });
  assert.ok(Math.abs(playerStats(s.player).attackCooldown - normal * (1 - TALENTS.rage.per)) < 1e-9);
  run(s, ticks(3) + 1);
  assert.equal(playerStats(s.player).attackCooldown, normal);
});

// ---------- Déméter ----------

test("Sève d'Asphodèle et Bourse du passeur : PV et oboles de départ", () => {
  const s = createGameState('depart', { meta: build({ vigor: 2, purse: 2 }, { demeter: 4 }) });
  assert.equal(s.player.maxHp, SIM.player.maxHp + 2 * TALENTS.vigor.per + 1);
  assert.equal(s.player.hp, s.player.maxHp);
  assert.equal(s.gold, 30);
});

test('Écorce : invulnérabilité plus longue après un coup reçu', () => {
  const inv = (meta) => {
    const s = arena(meta);
    hurtPlayer(s, 1, 0, 0);
    return s.player.invuln;
  };
  assert.equal(inv(build({ bark: 2 })), inv(bare()) + ticks(2 * TALENTS.bark.per));
});

test('Élixir : potions plus efficaces', () => {
  const heal = (meta) => {
    const s = arena(meta);
    s.player.hp = 1;
    s.pickups.push({ id: 999, kind: 'potion', x: 11.5, z: 11.5, amount: 1 });
    stepGame(s, {});
    return s.player.hp - 1;
  };
  assert.equal(heal(bare()), SIM.loot.potionHeal);
  const r = TALENTS.elixir.ranks;
  assert.equal(heal(build({ elixir: r })), Math.round(SIM.loot.potionHeal * (1 + r * TALENTS.elixir.per)));
  assert.ok(heal(build({ elixir: r })) > heal(bare()));
});

test('Moisson : chaque boss vaincu donne des PV maximum', () => {
  const after = (meta) => {
    const s = arena(meta);
    s.player.hp = 5;
    addEnemy(s, 'cerberus', 11.5, 12.9, { hp: 1, alert: true, boss: true });
    stepGame(s, { ...SOUTH, attack: true });
    return [s.player.maxHp - arena(meta).player.maxHp, s.player.hp];
  };
  assert.deepEqual(after(bare()), [0, 5]);
  assert.deepEqual(after(build({ harvest: 1 })), [TALENTS.harvest.per, 5 + TALENTS.harvest.per]);
});

test('Sursaut : dégâts accrus quand la vie est basse', () => {
  const low = arena(build({ surge: 1 }));
  low.player.hp = 2;
  const high = arena(build({ surge: 1 }));
  assert.equal(hitDamage(low), hitDamage(high) * (1 + TALENTS.surge.per));
});

test('Défi de la Mort : on se relève une fois avec une part de ses PV, la seconde mort est définitive', () => {
  for (let rank = 1; rank <= TALENTS.defiance.ranks; rank++) {
    const s = arena(build({ defiance: rank }));
    hurtPlayer(s, 999, 0, 0);
    assert.equal(s.status, 'playing');
    assert.equal(s.player.hp, Math.round(s.player.maxHp * rank * TALENTS.defiance.per));
    assert.ok(s.player.invuln > 0);
    assert.ok(s.events.some((e) => e.type === 'defiance'));
    s.player.invuln = 0;
    hurtPlayer(s, 999, 0, 0);
    assert.equal(s.status, 'dead');
  }
  const s = arena(bare());
  hurtPlayer(s, 999, 0, 0);
  assert.equal(s.status, 'dead', 'sans le talent, la mort reste définitive');
});

test('Racines nourricières : soin à chaque nouvel étage', () => {
  const r = TALENTS.roots.ranks;
  const s = onStairs(build({ roots: r }));
  s.player.hp = 3;
  stepGame(s, { choice: 0 });
  assert.equal(s.player.hp, 3 + r * TALENTS.roots.per);
});

// ---------- Hermès ----------

test('Pas léger et Ombre fugace : esquive rechargée plus vite, plus longtemps invulnérable', () => {
  const a = playerStats(arena(bare()).player);
  const b = playerStats(arena(build({ lightstep: 2, phantom: 2 })).player);
  assert.ok(Math.abs(b.dashCooldown / a.dashCooldown - 0.8) < 1e-9);
  assert.ok(Math.abs(b.dashInvuln - a.dashInvuln - 0.16) < 1e-9);
});

test('Second souffle : deux esquives enchaînées, une seule sans', () => {
  const dashes = (meta) => {
    const s = arena(meta);
    let n = 0;
    for (let i = 0; i < 24; i++) {
      stepGame(s, { moveX: i % 4 < 2 ? 1 : -1, dash: i % 2 === 0 });
      n += s.events.filter((x) => x.type === 'dash').length;
    }
    return n;
  };
  assert.equal(dashes(bare()), 1);
  assert.equal(dashes(build({ doubleDash: 1 })), 2);
  const s = arena(build({ doubleDash: 1 }));
  run(s, 2, { dash: true });
  run(s, ticks(SIM.player.dash.duration) + 2, {});
  run(s, 2, { dash: true });
  assert.equal(s.player.dashCharges, 0);
  run(s, ticks(playerStats(s.player).dashCooldown) * 2 + 5, {});
  assert.equal(s.player.dashCharges, 2);
});

test("Élan : le premier coup après une esquive est renforcé, pas le suivant", () => {
  const s = arena(build({ momentum: 2 }));
  const e = addEnemy(s, 'shade', 11.5, 13.2, { hp: 100, maxHp: 100, mode: 'recover', timer: 999 });
  stepGame(s, { moveX: 1, dash: true });
  run(s, ticks(SIM.player.dash.duration) + 1);
  Object.assign(s.player, { x: 11.5, z: 11.5, vx: 0, vz: 0 });
  Object.assign(e, { x: 11.5, z: 12.6, kvx: 0, kvz: 0 });
  stepGame(s, { ...SOUTH, attack: true });
  const first = 100 - e.hp;
  run(s, ticks(1));
  Object.assign(e, { x: 11.5, z: 12.6, kvx: 0, kvz: 0 });
  const hp = e.hp;
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(first, hp - e.hp + 2);
});

test("Bouclier du vent : esquiver à travers une flèche la renvoie sur l'archer", () => {
  const s = arena(build({ reflect: 1 }));
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

test('Danse des lames : esquiver à travers un ennemi le frappe une fois', () => {
  const pass = (meta) => {
    const s = arena(meta);
    const e = addEnemy(s, 'shade', 12.8, 11.5, { hp: 100, maxHp: 100, mode: 'recover', timer: 999 });
    stepGame(s, { moveX: 1, dash: true });
    run(s, ticks(SIM.player.dash.duration) + 2, { moveX: 1 });
    return 100 - e.hp;
  };
  assert.equal(pass(bare()), 0);
  assert.equal(pass(build({ bladeDance: 1 })), playerStats(arena(build({ bladeDance: 1 })).player).damage);
});

// ---------- Charon ----------

test("Œil du passeur : plus d'oboles dans un coffre", () => {
  const chestGold = (meta) => {
    const s = arena(meta);
    s.chests = [{ id: 1, x: 11.5, z: 11.5, opened: false }];
    stepGame(s, {});
    // Oboles déjà ramassées (le coffre est sous le héros) + celles encore au sol
    return s.gold + s.pickups.filter((it) => it.kind === 'obol').reduce((t, it) => t + it.amount, 0);
  };
  const a = chestGold(bare());
  assert.equal(chestGold(build({ eye: 2 })), Math.round(a * 1.6));
});

test('Marchandage : soin et relance moins chers chez Charon', () => {
  const a = onStairs(bare());
  const b = onStairs(build({ haggle: 2 }));
  assert.equal(healCost(b), Math.round(healCost(a) / 2));
  assert.equal(rerollCost(b), Math.round(rerollCost(a) / 2));
  b.gold = healCost(b);
  b.player.hp = 1;
  stepGame(b, { shop: 'heal' });
  assert.equal(b.gold, 0);
  assert.equal(b.player.hp, 1 + SIM.loot.healAmount);
});

test('Faveur des dieux : 4 bienfaits ; Ami du passeur : 1 relance gratuite', () => {
  assert.equal(sanitizeIntent({ choice: 3 }).choice, 3);
  assert.equal(sanitizeIntent({ choice: 4 }).choice, -1);
  const s = onStairs(build({ choice4: 1, freeReroll: 1 }));
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
  assert.equal(onStairs(bare()).offer.boons.length, 3);
});

test('Pacte de Charon : la partie commence par le choix d\'un bienfait, sans descendre', () => {
  const s = createGameState('pacte', { meta: build({ pact: 1 }) });
  assert.equal(s.status, 'choosing');
  assert.ok(s.offer.start);
  const id = s.offer.boons[0];
  stepGame(s, { choice: 0 });
  assert.equal(s.status, 'playing');
  assert.equal(s.floorIndex, 0);
  assert.equal(s.player.boons[id], 1);
  assert.equal(createGameState('pacte', { meta: bare() }).status, 'playing');
});

// ---------- Code d'export ----------

test("code d'export : aller-retour exact, espaces et retours à la ligne tolérés", () => {
  const p = newProfile();
  p.shadows = 1234;
  p.attrs = { ares: 4, demeter: 7, hermes: 1, charon: 10 };
  p.talents = cleanMeta({ attrs: p.attrs, talents: { swift: 1, blade: 1, vigor: 2, roots: 1, purse: 3, tithe: 2 } }).talents;
  p.stats = { runs: 17, victories: 2, bestFloor: 9, totalShadows: 4321, bosses: { cerberus: 3, hydra: 2, thanatos: 2 } };
  p.cls = 'huntress';
  p.builds = { warrior: { vigor: 1 } };
  const code = encodeProfile(p);
  assert.match(code, /^BORROG1-[A-Za-z0-9._]+-[a-z0-9]+$/);
  assert.deepEqual(decodeProfile(code).profile, p);
  const messy = `  ${code.slice(0, 10)}\n${code.slice(10, 30)} ${code.slice(30)}\n`;
  assert.deepEqual(decodeProfile(messy).profile, p);
});

test("code d'export : un code tronqué, modifié ou étranger est refusé proprement", () => {
  const p = newProfile();
  p.shadows = 50;
  const code = encodeProfile(p);
  const [pre, body, sum] = code.split('-');
  const flipped = body[5] === 'A' ? 'B' : 'A';
  const bad = ['', null, 'bonjour', code.slice(0, -3), `${pre}-${body.slice(0, 5)}${flipped}${body.slice(6)}-${sum}`, `${pre}-${body}`, `AUTRE1-${body}-${sum}`];
  for (const c of bad) {
    const r = decodeProfile(c);
    assert.equal(r.profile, undefined, `code accepté : ${c}`);
    assert.equal(typeof r.error, 'string');
  }
});

// Code fabriqué à la main avec une bonne somme de contrôle
function forge(data) {
  const body = btoa(JSON.stringify(data)).replace(/\+/g, '.').replace(/\//g, '_').replace(/=+$/, '');
  return `BORROG1-${body}-${hashString(`BORROG1:${body}`).toString(36)}`;
}

test("code d'export : un code valide mais aux valeurs absurdes est nettoyé", () => {
  const { profile } = decodeProfile(forge({ v: 2, o: -40, a: [99, 0, 'x'], t: { blade: 9, triche: 3 }, s: ['x', 2] }));
  assert.equal(profile.shadows, 0);
  assert.deepEqual(profile.attrs, { ares: ATTR_MAX, demeter: 1, hermes: 1, charon: 1 });
  assert.deepEqual(profile.talents, {}, 'Lame trempée sans parent : retirée');
  assert.equal(profile.stats.runs, 0);
  assert.equal(profile.stats.victories, 2);
});

test("code d'export d'avant la refonte : accepté, Ombres de l'ancien arbre rendues", () => {
  const { profile } = decodeProfile(forge({ v: 1, o: 100, r: { blade: 1, tithe: 1 }, s: [3, 0, 4, 200] }));
  assert.equal(profile.shadows, 100 + 60 + 40);
  assert.deepEqual(profile.talents, {});
  assert.equal(profile.stats.runs, 3);
});
