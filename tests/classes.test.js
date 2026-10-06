// Tests des classes (étape 7) : règles de chaque classe, armes (épée, arc, orbe),
// déblocage, build par classe et déterminisme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE } from '../src/dungeon/tiles.js';
import { playerStats } from '../src/systems/boons.js';
import { CLASSES, CLASS_IDS, classOf } from '../src/systems/classes.js';
import { newProfile, recordRun, selectClass, classUnlocked, sanitizeProfile, learn, buyLevel } from '../src/meta/profile.js';
import { encodeProfile, decodeProfile } from '../src/meta/transfer.js';
import { scriptedIntents, stateHash } from './helpers.js';

function arena(cls, meta = {}) {
  const s = createGameState('classes', { enemies: false, cls, meta });
  const W = 30;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r < W - 1; r++) for (let c = 1; c < W - 1; c++) tiles[r * W + c] = TILE.FLOOR;
  s.dungeon = { width: W, height: W, tiles, rooms: [], decor: [], start: { c: 15, r: 5 }, stairs: { c: 1, r: 1 } };
  s.chests = [];
  s.pickups = [];
  Object.assign(s.players[0], { x: 15.5, z: 5.5, vx: 0, vz: 0, facing: 0 });
  return s;
}
// Ennemi immobile et inoffensif (en récupération), pour mesurer les dégâts
function dummy(s, x, z, hp = 50, type = 'shade') {
  const e = createEnemy(s, { type, x, z });
  Object.assign(e, { hp, maxHp: hp, mode: 'recover', timer: 99999 });
  s.enemies.push(e);
  return e;
}
const run = (s, n, intent = {}) => {
  for (let i = 0; i < n; i++) stepGame(s, intent);
};
const SOUTH = { aimX: 0, aimY: -1 };
// Un seul tir vers le sud, puis on laisse le projectile voler
function fireSouth(s, frames = 90) {
  stepGame(s, { ...SOUTH, attack: true });
  run(s, frames);
}

test('trois classes ; le Guerrier est le héros de base ; une classe inconnue donne le Guerrier', () => {
  assert.deepEqual(CLASS_IDS, ['warrior', 'huntress', 'mystic']);
  assert.equal(classOf('triche'), 'warrior');
  for (const id of CLASS_IDS) {
    const s = createGameState('pv', { cls: id });
    assert.equal(s.players[0].cls, id);
    assert.equal(s.players[0].maxHp, SIM.classes[id].maxHp);
  }
  assert.equal(createGameState('pv').players[0].cls, 'warrior');
  assert.equal(createGameState('pv', { cls: 'triche' }).players[0].cls, 'warrior');
  const w = playerStats(createGameState('pv').players[0]);
  assert.equal(w.weapon, 'sword');
  assert.equal(w.attackRange, SIM.player.attack.range);
  assert.equal(w.attackCooldown, SIM.player.attack.cooldown);
});

test('Chasseresse : la flèche part dans la direction visée, touche un ennemi loin, sans blesser le héros', () => {
  const s = arena('huntress');
  const e = dummy(s, 15.5, 12.5); // 7 m au sud : hors de portée de l'épée
  stepGame(s, { ...SOUTH, attack: true });
  assert.equal(s.projectiles.length, 1);
  assert.ok(s.projectiles[0].friendly);
  assert.ok(s.events.some((ev) => ev.type === 'heroShot' && ev.kind === 'heroArrow'));
  run(s, 60);
  assert.equal(e.hp, 50 - SIM.classes.huntress.attack.damage);
  assert.equal(s.players[0].hp, s.players[0].maxHp);
  assert.equal(s.projectiles.length, 0);
});

test('Chasseresse : la flèche traverse un ennemi (deux avec Fendoir) puis s\'arrête', () => {
  const line = (meta) => {
    const s = arena('huntress', meta);
    const es = [8.5, 10.0, 11.5].map((z) => dummy(s, 15.5, z));
    fireSouth(s);
    return es.map((e) => e.hp < 50);
  };
  assert.equal(SIM.classes.huntress.shot.pierce, 1);
  assert.deepEqual(line({}), [true, true, false]);
  const build = { attrs: { ares: 10 }, talents: { swift: 1, blade: 1, cleave: 1 } };
  assert.deepEqual(line(build), [true, true, true]);
});

test('Chasseresse : la flèche se brise sur un mur et a une portée limitée', () => {
  const s = arena('huntress');
  const far = dummy(s, 15.5, 5.5 + SIM.classes.huntress.shot.range + 2);
  fireSouth(s);
  assert.equal(far.hp, 50, 'hors de portée');
  const w = arena('huntress');
  w.dungeon.tiles[8 * 30 + 15] = TILE.WALL;
  const behind = dummy(w, 15.5, 10.5);
  fireSouth(w);
  assert.equal(behind.hp, 50, 'la flèche ne traverse pas les murs');
  assert.equal(w.projectiles.length, 0);
});

test('Mystique : l\'orbe explose au contact et blesse tout le groupe autour', () => {
  const s = arena('mystic');
  const a = dummy(s, 15.5, 9.5);
  const b = dummy(s, 16.5, 10.2);
  const c = dummy(s, 14.6, 10.0);
  const far = dummy(s, 19.5, 9.5);
  stepGame(s, { ...SOUTH, attack: true });
  assert.ok(s.events.some((ev) => ev.type === 'heroShot' && ev.kind === 'orb'));
  let burst = false;
  for (let i = 0; i < 120; i++) {
    stepGame(s, {});
    burst ||= s.events.some((ev) => ev.type === 'orbBurst');
  }
  assert.ok(burst);
  const dmg = SIM.classes.mystic.attack.damage;
  for (const e of [a, b, c]) assert.equal(e.hp, 50 - dmg);
  assert.equal(far.hp, 50, 'hors du rayon');
});

test("Mystique : l'orbe explose aussi en bout de course et contre un mur", () => {
  const s = arena('mystic');
  const end = 5.5 + 0.45 + SIM.classes.mystic.shot.range;
  const e = dummy(s, 15.5, end + 0.8); // pas sur la trajectoire, mais dans le rayon de l'explosion finale
  fireSouth(s, 150);
  assert.ok(e.hp < 50);
  const w = arena('mystic');
  w.dungeon.tiles[9 * 30 + 15] = TILE.WALL;
  const hugging = dummy(w, 16.3, 8.6); // collé au mur, à côté de l'impact
  fireSouth(w, 120);
  assert.ok(hugging.hp < 50);
});

test('visée automatique (mobile) : la Chasseresse vise loin, le Guerrier seulement près', () => {
  const aimedAt = (cls) => {
    const s = arena(cls);
    s.players[0].facing = Math.PI; // regarde au nord
    dummy(s, 15.5, 12.5); // 7 m au sud
    stepGame(s, { attack: true });
    return Math.abs(s.players[0].facing) < 0.01;
  };
  assert.equal(aimedAt('huntress'), true);
  assert.equal(aimedAt('warrior'), false);
});

test('les tirs se font au rythme de la classe (la Mystique tire moins vite)', () => {
  const shots = (cls) => {
    const s = arena(cls);
    let n = 0;
    for (let i = 0; i < 300; i++) {
      stepGame(s, { ...SOUTH, attack: true });
      n += s.events.filter((ev) => ev.type === 'heroShot' || ev.type === 'swing').length;
    }
    return n;
  };
  assert.ok(shots('huntress') > shots('mystic'));
  assert.equal(shots('mystic'), Math.ceil(300 / ticks(SIM.classes.mystic.attack.cooldown)));
});

test('même graine + même classe = même partie (arc et orbe)', () => {
  for (const cls of ['huntress', 'mystic']) {
    const intents = scriptedIntents(2500, 11);
    const a = createGameState('rejeu-classe', { cls });
    const b = createGameState('rejeu-classe', { cls });
    for (const i of intents) {
      stepGame(a, i);
      stepGame(b, i);
    }
    assert.equal(stateHash(a), stateHash(b), cls);
  }
});

test('un boss vaincu est noté dans la partie, puis compté dans le profil', () => {
  const s = arena('warrior');
  const boss = createEnemy(s, { type: 'cerberus', x: 15.5, z: 6.9, boss: true });
  Object.assign(boss, { hp: 1, alert: true });
  s.enemies.push(boss);
  stepGame(s, { ...SOUTH, attack: true });
  assert.deepEqual(s.bossesDefeated, ['cerberus']);
  const p = newProfile();
  recordRun(p, s);
  assert.equal(p.stats.bosses.cerberus, 1);
});

test('déblocage : Chasseresse après Cerbère, Mystique après l\'Hydre', () => {
  const p = newProfile();
  assert.ok(classUnlocked(p, 'warrior'));
  assert.equal(classUnlocked(p, 'huntress'), false);
  assert.equal(selectClass(p, 'huntress'), false);
  assert.equal(p.cls, 'warrior');
  recordRun(p, { shadows: 0, floorIndex: 3, status: 'dead', bossesDefeated: ['cerberus'] });
  assert.ok(classUnlocked(p, 'huntress'));
  assert.equal(classUnlocked(p, 'mystic'), false);
  assert.equal(classUnlocked(p, 'inconnue'), false);
  for (const id of CLASS_IDS) assert.equal(typeof CLASSES[id].text, 'string');
});

test('un build par classe : changer de classe range le build et le retrouve au retour', () => {
  const p = newProfile();
  p.shadows = 1000;
  p.stats.bosses.cerberus = 1;
  buyLevel(p, 'ares');
  buyLevel(p, 'demeter');
  assert.ok(learn(p, 'swift'));
  assert.ok(selectClass(p, 'huntress'));
  assert.deepEqual(p.talents, {});
  assert.ok(learn(p, 'vigor'));
  assert.ok(selectClass(p, 'warrior'));
  assert.deepEqual(p.talents, { swift: 1 });
  assert.ok(selectClass(p, 'huntress'));
  assert.deepEqual(p.talents, { vigor: 1 });
  assert.equal(p.attrs.ares, 2, 'les attributs sont communs');
});

test('profil d\'avant les classes : boss réputés vaincus selon le meilleur étage', () => {
  const p = sanitizeProfile({ version: 2, shadows: 5, stats: { runs: 3, bestFloor: 5 } });
  assert.equal(p.cls, 'warrior');
  assert.ok(classUnlocked(p, 'huntress'));
  assert.equal(classUnlocked(p, 'mystic'), false);
  // Classe verrouillée dans une sauvegarde trafiquée : retour au Guerrier, build rangé
  const q = sanitizeProfile({ version: 3, cls: 'mystic', attrs: { ares: 3 }, talents: { swift: 1 }, stats: { bosses: { cerberus: 1 } } });
  assert.equal(q.cls, 'warrior');
  assert.deepEqual(q.builds.mystic, { swift: 1 });
  assert.deepEqual(q.talents, {});
});

test("code d'export : classe, builds et boss vaincus voyagent avec la progression", () => {
  const p = newProfile();
  p.attrs.ares = 4;
  p.stats.bosses = { cerberus: 2, hydra: 1, thanatos: 0 };
  learn(p, 'swift');
  selectClass(p, 'mystic');
  learn(p, 'reach');
  const back = decodeProfile(encodeProfile(p)).profile;
  assert.deepEqual(back, p);
});

// ---------- Capacités spéciales (étape 7b) ----------

import { sanitizeIntent } from '../src/systems/intent.js';

const SP = (cls) => SIM.classes[cls].special;

test("l'intention transmet la capacité spéciale", () => {
  assert.equal(sanitizeIntent({ special: true }).special, true);
  assert.equal(sanitizeIntent({ special: 'oui' }).special, false);
});

test('Tourbillon : frappe tout autour (devant et derrière), double dégâts, repousse fort', () => {
  const s = arena('warrior');
  const front = dummy(s, 15.5, 7.0);
  const back = dummy(s, 15.5, 4.0);
  const side = dummy(s, 17.3, 5.5);
  const far = dummy(s, 15.5, 5.5 + SP('warrior').radius + 1);
  stepGame(s, { special: true });
  const dmg = SIM.player.attack.damage * SP('warrior').damageMult;
  for (const e of [front, back, side]) assert.equal(e.hp, 50 - dmg);
  assert.equal(far.hp, 50);
  assert.ok(Math.hypot(back.kvx, back.kvz) > SIM.player.attack.knockback, 'recul plus fort qu\'un coup normal');
  assert.ok(back.kvz < 0, 'repoussé vers l\'extérieur');
  // (le recul commence déjà à s'amortir pendant le même pas)
  const kb = Math.hypot(side.kvx, side.kvz);
  assert.ok(kb > SP('warrior').knockback - 1 && kb <= SP('warrior').knockback, `recul du Tourbillon sur le côté : ${kb}`);
  assert.ok(side.kvx > 0);
  assert.ok(s.players[0].invuln > 0, 'invulnérable pendant la rotation');
  assert.ok(s.events.some((ev) => ev.type === 'special' && ev.id === 'whirl'));
});

test('capacité : une par appui, puis temps de recharge', () => {
  const s = arena('warrior');
  let used = 0;
  const step = (intent) => {
    stepGame(s, intent);
    used += s.events.filter((ev) => ev.type === 'special').length;
  };
  step({ special: true });
  assert.equal(used, 1);
  for (let i = 0; i < 30; i++) step({ special: true }); // maintenu : pas de deuxième
  assert.equal(used, 1);
  step({});
  step({ special: true }); // nouvel appui, mais pas encore rechargé
  assert.equal(used, 1);
  for (let i = 0; i < ticks(SP('warrior').cooldown); i++) step({});
  step({ special: true });
  assert.equal(used, 2, 'rechargé : nouveau Tourbillon');
  // Bouton gardé enfoncé pendant toute la recharge : pas de relance automatique à la fin
  for (let i = 0; i < ticks(SP('warrior').cooldown) + 20; i++) step({ special: true });
  assert.equal(used, 2, 'il faut relâcher puis appuyer à nouveau');
});

test('Tourbillon : pas à travers un mur', () => {
  const s = arena('warrior');
  s.dungeon.tiles[6 * 30 + 15] = TILE.WALL;
  s.dungeon.tiles[6 * 30 + 14] = TILE.WALL;
  s.dungeon.tiles[6 * 30 + 16] = TILE.WALL;
  const hidden = dummy(s, 15.5, 7.4);
  stepGame(s, { special: true });
  assert.equal(hidden.hp, 50);
});

test('Volée : 5 flèches en éventail autour de la direction visée', () => {
  const s = arena('huntress');
  stepGame(s, { ...SOUTH, special: true });
  const arrows = s.projectiles.filter((a) => a.friendly);
  assert.equal(arrows.length, SP('huntress').count);
  const angles = arrows.map((a) => Math.atan2(a.vx, a.vz)).sort((x, y) => x - y);
  assert.ok(Math.abs(angles[0] + angles[angles.length - 1]) < 1e-9, 'éventail centré sur le sud');
  assert.ok(Math.abs(angles[angles.length - 1] - angles[0] - SP('huntress').spread) < 1e-9);
  // Trois ennemis en éventail : tous touchés
  const t = arena('huntress');
  const es = [-0.35, 0, 0.35].map((a) => dummy(t, 15.5 + Math.sin(a) * 5, 5.5 + Math.cos(a) * 5));
  stepGame(t, { ...SOUTH, special: true });
  run(t, 60);
  for (const e of es) assert.ok(e.hp < 50);
});

test('Nova : blesse autour et ralentit les ennemis (pas les boss)', () => {
  const s = arena('mystic');
  const shade = dummy(s, 15.5, 7.5);
  const boss = createEnemy(s, { type: 'cerberus', x: 13.5, z: 5.5, boss: true });
  Object.assign(boss, { hp: 500, maxHp: 500, alert: true });
  s.enemies.push(boss);
  stepGame(s, { special: true });
  assert.equal(shade.hp, 50 - SIM.classes.mystic.attack.damage * SP('mystic').damageMult);
  assert.ok(boss.hp < 500, 'le boss prend les dégâts');
  assert.ok(shade.slow > 0);
  assert.ok(!(boss.slow > 0), 'un boss n\'est pas ralenti');
  assert.ok(s.events.some((ev) => ev.type === 'special' && ev.id === 'nova'));
});

test('Nova : un ennemi ralenti avance deux fois moins vite', () => {
  const travel = (slowed) => {
    const s = arena('mystic');
    const e = createEnemy(s, { type: 'shade', x: 15.5, z: 20.5 });
    Object.assign(e, { alert: true, mode: 'chase', slow: slowed ? 9999 : 0 });
    s.enemies.push(e);
    const z0 = e.z;
    run(s, 60);
    return z0 - e.z;
  };
  const normal = travel(false);
  const slow = travel(true);
  assert.ok(normal > 1);
  assert.ok(Math.abs(slow / normal - 0.5) < 0.1, `rapport ${slow / normal}`);
});

test('même graine + mêmes capacités = même partie', () => {
  for (const cls of CLASS_IDS) {
    const intents = scriptedIntents(2000, 5).map((it, i) => ({ ...it, special: i % 97 < 2 }));
    const a = createGameState('rejeu-capacite', { cls });
    const b = createGameState('rejeu-capacite', { cls });
    for (const i of intents) {
      stepGame(a, i);
      stepGame(b, i);
    }
    assert.equal(stateHash(a), stateHash(b), cls);
  }
});
