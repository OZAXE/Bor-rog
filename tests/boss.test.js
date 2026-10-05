// Tests des zones, de l'étage de boss et de Cerbère.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, enterFloor } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { TILE, isWalkable, tileAt } from '../src/dungeon/tiles.js';
import { zoneIndexOf, bossOf, ZONES } from '../src/dungeon/zones.js';
import { walkDistances, center, generateBossFloor } from '../src/dungeon/generate.js';
import { overlapsSolid } from '../src/systems/collision.js';
import { inRoom } from '../src/systems/rooms.js';
import { stateHash } from './helpers.js';

const B = SIM.bosses.cerberus;

test('zones : 3 étages chacune, boss au 3e étage de la zone', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 8].map(zoneIndexOf), [0, 0, 0, 1, 1, 2, 2]);
  assert.equal(bossOf(0), null);
  assert.equal(bossOf(1), null);
  assert.equal(bossOf(2), 'cerberus');
  assert.equal(ZONES.length, 3);
});

test("étage de boss : départ -> arène -> sanctuaire, l'escalier n'est accessible qu'en traversant l'arène", () => {
  for (let i = 0; i < 10; i++) {
    const d = generateBossFloor(`boss-${i}`, 2, 'cerberus');
    const arena = d.rooms.find((r) => r.type === 'boss');
    const dist = walkDistances(d, d.start);
    assert.ok(dist[d.stairs.r * d.width + d.stairs.c] > 0, 'escalier inaccessible');
    // Si on rend l'arène infranchissable, l'escalier devient inaccessible
    const blocked = { ...d, tiles: d.tiles.map((t, k) => (inRoom(arena, (k % d.width) + 0.5, Math.floor(k / d.width) + 0.5) && t !== TILE.WALL ? TILE.WALL : t)) };
    assert.equal(walkDistances(blocked, d.start)[d.stairs.r * d.width + d.stairs.c], -1, "on contourne l'arène");
    assert.equal(tileAt(d, Math.floor(d.boss.x), Math.floor(d.boss.z)), TILE.FLOOR);
  }
});

// Partie posée directement à l'étage de Cerbère, héros au centre de l'arène
function arenaFight(seed = 'cerbere') {
  const s = createGameState(seed);
  enterFloor(s, 2);
  const arena = s.dungeon.rooms.find((r) => r.type === 'boss');
  const c = center(arena);
  s.player.x = c.c + 0.5;
  s.player.z = c.r + 3.5;
  stepGame(s, {});
  const boss = s.enemies.find((e) => e.boss);
  return { s, boss, arena };
}
const run = (s, n, intent = {}) => {
  for (let i = 0; i < n; i++) stepGame(s, typeof intent === 'function' ? intent(i) : intent);
};

test("l'étage 3 contient Cerbère seul ; entrer dans l'arène la scelle (escalier compris)", () => {
  const { s, boss, arena } = arenaFight();
  assert.ok(boss);
  assert.equal(s.enemies.length, 1);
  assert.ok(s.lock && s.lock.roomId === arena.id, "l'arène aurait dû se sceller");
  assert.ok(s.lock.enemyIds.includes(boss.id));
  assert.equal(walkDistances(s.dungeon, { c: Math.floor(s.player.x), r: Math.floor(s.player.z) })[s.dungeon.stairs.r * s.dungeon.width + s.dungeon.stairs.c], -1, "l'escalier ne doit pas être accessible pendant le combat");
});

test('Cerbère se présente avant sa première attaque', () => {
  const { s, boss } = arenaFight();
  run(s, 60);
  assert.notEqual(boss.mode, 'windup', 'attaque trop tôt');
  assert.equal(s.player.hp, SIM.player.maxHp);
});

// Avance jusqu'à ce que Cerbère annonce l'attaque voulue (en gardant le héros invulnérable)
function waitFor(s, boss, attack, maxTicks = 60 * 30, intent = {}) {
  for (let i = 0; i < maxTicks; i++) {
    if (boss.mode === 'windup' && boss.attack === attack) return true;
    s.player.invuln = 5;
    stepGame(s, intent);
  }
  return false;
}

test('Cerbère varie ses attaques (pas seulement la morsure)', () => {
  const { s, boss } = arenaFight('varie');
  const kinds = new Set();
  for (let i = 0; i < 60 * 40; i++) {
    s.player.invuln = 5;
    stepGame(s, {});
    for (const e of s.events) if (e.type === 'windup') kinds.add(e.attack);
  }
  assert.ok(kinds.has('charge') && kinds.has('breath'), `attaques vues : ${[...kinds]}`);
});

test("charge : annoncée, elle touche le héros resté dans la ligne", () => {
  const { s, boss } = arenaFight();
  assert.ok(waitFor(s, boss, 'charge'), 'pas de charge');
  s.player.invuln = 0;
  // Le héros se replace dans l'axe de la charge, à 3 m devant le boss
  s.player.x = boss.x + boss.aimX * 3;
  s.player.z = boss.z + boss.aimZ * 3;
  const hp = s.player.hp;
  run(s, boss.timer - 1);
  assert.equal(s.player.hp, hp, 'touché pendant l\'annonce');
  run(s, 40);
  assert.equal(s.player.hp, hp - B.charge.damage);
});

test('charge contre un mur ou une colonne : Cerbère est sonné longtemps', () => {
  const { s, boss } = arenaFight();
  assert.ok(waitFor(s, boss, 'charge'));
  s.player.invuln = 99999;
  let crashed = false;
  for (let i = 0; i < 120 && !crashed; i++) {
    stepGame(s, {});
    crashed = s.events.some((e) => e.type === 'crash');
  }
  assert.ok(crashed, "la charge aurait dû finir dans un mur ou une colonne (arène fermée)");
  assert.equal(boss.mode, 'recover');
  assert.ok(boss.timer >= ticks(B.charge.wallStun) - 2);
  assert.ok(!overlapsSolid(s.dungeon, boss, B.radius));
});

test('triple souffle : touché dans un cône, épargné entre deux cônes', () => {
  const place = (offset) => {
    const { s, boss } = arenaFight('souffle');
    assert.ok(waitFor(s, boss, 'breath'), 'pas de souffle');
    // On place le héros à 3,5 m, avec un écart d'angle donné par rapport à l'axe du souffle
    const a = boss.facing + offset;
    s.player.x = boss.x + Math.sin(a) * 3.5;
    s.player.z = boss.z + Math.cos(a) * 3.5;
    s.player.invuln = 0;
    const hp = s.player.hp;
    run(s, boss.timer + 1, () => {
      s.player.x = boss.x + Math.sin(a) * 3.5; // le héros reste immobile à cet endroit
      s.player.z = boss.z + Math.cos(a) * 3.5;
      return {};
    });
    return hp - s.player.hp;
  };
  assert.equal(place(0), B.breath.damage, 'cône central');
  assert.equal(place(0.8), B.breath.damage, 'cône latéral');
  assert.equal(place(0.4), 0, 'entre deux cônes : aurait dû être épargné');
});

test('phase 2 à 50 % : hurlement (invulnérable), 3 Ombres une seule fois, charges doublées', () => {
  const { s, boss } = arenaFight('phase2');
  s.player.invuln = 99999;
  boss.hp = Math.floor(boss.maxHp * B.phase2.at);
  let summons = 0;
  let deflected = false;
  for (let i = 0; i < 60 * 25; i++) {
    s.player.invuln = 99999;
    const it = boss.mode === 'windup' && boss.attack === 'howl'
      ? { attack: true, aimX: (boss.x - s.player.x), aimY: -(boss.z - s.player.z) }
      : {};
    stepGame(s, it);
    summons += s.events.filter((e) => e.type === 'summon').length;
    if (s.events.some((e) => e.type === 'deflect')) deflected = true;
  }
  assert.equal(summons, B.phase2.adds);
  assert.ok(boss.phase2);
  // Une charge de phase 2 enchaîne une seconde charge
  let chains = 0;
  for (let i = 0; i < 60 * 30; i++) {
    s.player.invuln = 99999;
    const before = boss.chainLeft;
    stepGame(s, {});
    if (before === 1 && boss.chainLeft === 0 && boss.mode === 'windup') chains++;
  }
  assert.ok(chains > 0, 'pas de double charge en phase 2');
});

test('le hurlement rend Cerbère invulnérable', () => {
  const { s, boss } = arenaFight('hurlement');
  boss.hp = Math.floor(boss.maxHp * B.phase2.at);
  s.player.invuln = 99999;
  assert.ok(waitFor(s, boss, 'howl', 60 * 10));
  s.player.x = boss.x;
  s.player.z = boss.z + B.radius + 0.6;
  const hp = boss.hp;
  stepGame(s, { attack: true, aimX: 0, aimY: 1 });
  assert.equal(boss.hp, hp);
});

test('Cerbère ne recule pas sous les coups et ne se laisse pas interrompre', () => {
  const { s, boss } = arenaFight('lourd');
  assert.ok(waitFor(s, boss, 'breath'));
  s.player.x = boss.x;
  s.player.z = boss.z + B.radius + 0.5;
  const mode = boss.mode;
  // Héros au sud du boss : il vise le nord (aimY > 0) pour le frapper
  stepGame(s, { attack: true, aimX: 0, aimY: 1 });
  assert.equal(boss.kvx, 0);
  assert.equal(boss.kvz, 0);
  assert.equal(boss.mode, mode);
  assert.ok(boss.hp < boss.maxHp);
});

test('victoire : serviteurs dissipés, grilles ouvertes, trésor, escalier accessible', () => {
  const { s, boss } = arenaFight('victoire');
  boss.hp = Math.floor(boss.maxHp * B.phase2.at);
  s.player.invuln = 99999;
  run(s, 60 * 6, () => {
    s.player.invuln = 99999;
    return {};
  });
  assert.ok(s.enemies.filter((e) => !e.boss).length > 0, 'les Ombres auraient dû être appelées');
  boss.hp = 1;
  s.player.x = boss.x;
  s.player.z = boss.z + B.radius + 0.6;
  stepGame(s, { attack: true, aimX: 0, aimY: 1 });
  assert.ok(s.events.some((e) => e.type === 'bossDefeated'), 'boss non vaincu');
  assert.equal(s.enemies.length, 0, 'les serviteurs auraient dû disparaître');
  stepGame(s, {});
  assert.equal(s.lock, null);
  assert.ok(s.pickups.filter((p) => p.kind === 'obol').reduce((a, p) => a + p.amount, 0) >= B.reward.obols[0]);
  const dist = walkDistances(s.dungeon, { c: Math.floor(s.player.x), r: Math.floor(s.player.z) });
  assert.ok(dist[s.dungeon.stairs.r * s.dungeon.width + s.dungeon.stairs.c] > 0, 'escalier toujours inaccessible');
});

test('combat contre Cerbère : jamais dans un mur, rejeu identique', () => {
  const play = () => {
    const { s, boss } = arenaFight('rejeu-boss');
    for (let i = 0; i < 60 * 40 && s.status === 'playing'; i++) {
      stepGame(s, { moveX: Math.cos(i / 31), moveY: Math.sin(i / 43), attack: i % 3 === 0, dash: i % 50 === 0 });
      for (const e of s.enemies) assert.ok(!overlapsSolid(s.dungeon, e, SIM.enemies[e.type].radius), `${e.type} dans un mur`);
      assert.ok(!overlapsSolid(s.dungeon, s.player, SIM.player.radius), 'héros dans un mur');
    }
    return s;
  };
  assert.equal(stateHash(play()), stateHash(play()));
});
