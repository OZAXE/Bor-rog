// Tests de l'Hydre de Lerne, de Thanatos et de la victoire finale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, enterFloor } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { SIM, ticks } from '../src/systems/simConfig.js';
import { bossOf } from '../src/dungeon/zones.js';
import { center } from '../src/dungeon/generate.js';
import { overlapsSolid } from '../src/systems/collision.js';
import { stateHash } from './helpers.js';

const H = SIM.bosses.hydra;
const T = SIM.bosses.thanatos;

function fight(floor, seed) {
  const s = createGameState(seed);
  enterFloor(s, floor);
  const arena = s.dungeon.rooms.find((r) => r.type === 'boss');
  const c = center(arena);
  s.players[0].x = c.c + 0.5;
  s.players[0].z = c.r + 5.5;
  stepGame(s, {});
  return { s, boss: s.enemies.find((e) => e.boss), arena };
}
const run = (s, n, intent = {}) => {
  for (let i = 0; i < n; i++) stepGame(s, typeof intent === 'function' ? intent(i) : intent);
};
const heads = (s) => s.enemies.filter((e) => e.type === 'hydraHead');
// Frappe une tête depuis l'EXTÉRIEUR du cercle (sinon le coup toucherait aussi le corps)
function hitHeadFromOutside(s, head, body) {
  const d = Math.hypot(head.x - body.x, head.z - body.z);
  const ux = (head.x - body.x) / d;
  const uz = (head.z - body.z) / d;
  s.players[0].x = head.x + ux * 0.9;
  s.players[0].z = head.z + uz * 0.9;
  s.players[0].attackCooldown = 0;
  stepGame(s, { attack: true, aimX: -ux, aimY: uz });
}
// Frappe un ennemi précis : on place le héros juste à côté et on vise
function hit(s, target, gap = 0.6) {
  s.players[0].x = target.x;
  s.players[0].z = target.z + SIM.enemies[target.type].radius + gap;
  s.players[0].attackCooldown = 0;
  stepGame(s, { attack: true, aimX: 0, aimY: 1 });
}

test('les étages 6 et 9 sont ceux de l\'Hydre et de Thanatos', () => {
  assert.equal(bossOf(5), 'hydra');
  assert.equal(bossOf(8), 'thanatos');
});

test("Hydre : un corps et 4 têtes autour, tous enfermés dans l'arène", () => {
  const { s, boss } = fight(5, 'hydre');
  assert.equal(boss.type, 'hydra');
  assert.equal(heads(s).length, H.heads);
  assert.ok(s.lock);
  for (const h of heads(s)) {
    assert.ok(s.lock.enemyIds.includes(h.id));
    assert.ok(Math.abs(Math.hypot(h.x - boss.x, h.z - boss.z) - H.headRing) < 0.01);
  }
});

test('Hydre : une tête crache 3 projectiles, seulement après son annonce', () => {
  const { s } = fight(5, 'crachat');
  s.players[0].invuln = 99999;
  let windupSeen = false;
  for (let i = 0; i < 60 * 6; i++) {
    s.players[0].invuln = 99999;
    const before = s.projectiles.length;
    stepGame(s, {});
    const spitting = heads(s).find((h) => h.mode === 'windup' && h.attack === 'spit');
    if (spitting) windupSeen = true;
    if (s.projectiles.length > before) {
      assert.ok(windupSeen, 'projectiles sans annonce');
      assert.equal(s.projectiles.length - before, H.spit.count);
      return;
    }
  }
  assert.fail('aucun crachat');
});

test('Hydre : une tête tranchée repousse au même emplacement', () => {
  const { s, boss } = fight(5, 'repousse');
  s.players[0].invuln = 99999;
  const h = heads(s)[0];
  const slot = h.slot;
  h.hp = 1;
  const bodyHp = boss.hp;
  hitHeadFromOutside(s, h, boss);
  assert.equal(boss.hp, bodyHp, 'le corps a été touché par erreur');
  assert.ok(!s.enemies.includes(h), 'la tête aurait dû tomber');
  // Le héros s'éloigne sans toucher le corps
  s.players[0].x = h.x;
  s.players[0].z = h.z + 3;
  run(s, ticks(H.regrow) + 5, () => {
    s.players[0].invuln = 99999;
    return {};
  });
  assert.ok(heads(s).some((x) => x.slot === slot), "la tête n'a pas repoussé");
});

test("Hydre : frapper le corps pendant qu'une tête est tranchée l'empêche de repousser", () => {
  const { s, boss } = fight(5, 'cauterise');
  s.players[0].invuln = 99999;
  const h = heads(s)[0];
  const slot = h.slot;
  h.hp = 1;
  hitHeadFromOutside(s, h, boss);
  run(s, 20, () => {
    s.players[0].invuln = 99999;
    return {};
  });
  const hp = boss.hp;
  hit(s, boss, 0.5);
  assert.ok(boss.hp < hp, 'le corps aurait dû être touché');
  stepGame(s, {});
  run(s, ticks(H.regrow) + 30, () => {
    s.players[0].invuln = 99999;
    s.players[0].x = boss.x;
    s.players[0].z = boss.z + 6;
    return {};
  });
  assert.ok(!heads(s).some((x) => x.slot === slot), 'la tête cautérisée a repoussé');
});

test('Hydre phase 2 : une tête de plus et des flaques de lave annoncées puis brûlantes', () => {
  const { s, boss } = fight(5, 'lave');
  s.players[0].invuln = 99999;
  boss.hp = Math.floor(boss.maxHp * H.phase2.at);
  run(s, 3, () => {
    s.players[0].invuln = 99999;
    return {};
  });
  assert.equal(boss.slots.length, H.heads + H.phase2.extraHeads);
  // On attend une flaque, on se met dedans pendant l'annonce : aucun dégât avant la fin
  let pool = null;
  for (let i = 0; i < 60 * 6 && !pool; i++) {
    s.players[0].invuln = 99999;
    stepGame(s, {});
    pool = s.hazards.find((h) => h.kind === 'lava' && h.warn > 5);
  }
  assert.ok(pool, 'aucune flaque');
  // Les têtes ne doivent pas interférer : on les fait taire et on retire leurs crachats en vol
  for (const h of heads(s)) {
    h.timer = 99999;
    h.mode = 'chase';
  }
  s.projectiles = [];
  s.players[0].invuln = 0;
  const hp = s.players[0].hp;
  const warn = pool.warn;
  run(s, warn - 1, () => {
    s.players[0].x = pool.x;
    s.players[0].z = pool.z;
    return {};
  });
  assert.equal(s.players[0].hp, hp, "brûlé pendant l'annonce");
  run(s, 10, () => {
    s.players[0].x = pool.x;
    s.players[0].z = pool.z;
    return {};
  });
  assert.equal(s.players[0].hp, hp - H.phase2.poolDamage, 'la lave aurait dû brûler');
});

test("Hydre vaincue : les têtes meurent avec elle et l'arène s'ouvre", () => {
  const { s, boss } = fight(5, 'hydre-fin');
  s.players[0].invuln = 99999;
  boss.hp = 1;
  hit(s, boss, 0.5);
  assert.ok(s.events.some((e) => e.type === 'bossDefeated'));
  assert.equal(s.enemies.length, 0);
  stepGame(s, {});
  assert.equal(s.lock, null);
  assert.equal(s.status, 'playing');
});

test('Thanatos : la faux touche dans le cercle, pas en dehors', () => {
  const play = (dist) => {
    const { s, boss } = fight(8, 'faux');
    s.players[0].invuln = 99999;
    for (let i = 0; i < 60 * 15; i++) {
      s.players[0].invuln = 99999;
      s.players[0].x = boss.x;
      s.players[0].z = boss.z + 2; // assez près pour qu'il choisisse la faux
      stepGame(s, {});
      if (boss.mode === 'windup' && boss.attack === 'reap') break;
    }
    assert.equal(boss.attack, 'reap');
    s.players[0].invuln = 0;
    const hp = s.players[0].hp;
    run(s, boss.timer + 1, () => {
      s.players[0].x = boss.x;
      s.players[0].z = boss.z + dist;
      return {};
    });
    return hp - s.players[0].hp;
  };
  assert.equal(play(2.2), T.reap.damage, 'dans le cercle');
  assert.equal(play(T.reap.radius + 0.8), 0, 'hors du cercle');
});

test('Thanatos : disparaît (intouchable), réapparaît DERRIÈRE le héros puis frappe', () => {
  const { s, boss } = fight(8, 'teleport');
  for (let i = 0; i < 60 * 20 && boss.mode !== 'vanish'; i++) {
    s.players[0].invuln = 99999;
    stepGame(s, {});
  }
  assert.equal(boss.mode, 'vanish');
  assert.ok(boss.untargetable);
  // Le point de réapparition est derrière le héros (à l'opposé de son orientation)
  const fx = Math.sin(s.players[0].facing);
  const fz = Math.cos(s.players[0].facing);
  const dot = (boss.blinkX - s.players[0].x) * fx + (boss.blinkZ - s.players[0].z) * fz;
  assert.ok(dot < 0 || (boss.blinkX === boss.x && boss.blinkZ === boss.z), 'pas derrière le héros');
  // Intouchable pendant la disparition
  const hp = boss.hp;
  hit(s, boss, 0.3);
  assert.equal(boss.hp, hp);
  run(s, boss.timer + 1, () => {
    s.players[0].invuln = 99999;
    return {};
  });
  assert.equal(boss.mode, 'windup');
  assert.equal(boss.attack, 'slash');
  assert.ok(!boss.untargetable);
});

test("Thanatos : pluie d'âmes annoncée (le premier cercle sous le héros), on s'en écarte", () => {
  const { s, boss } = fight(8, 'pluie');
  let rain = null;
  for (let i = 0; i < 60 * 20 && !rain; i++) {
    s.players[0].invuln = 99999;
    stepGame(s, {});
    if (s.events.some((e) => e.type === 'rain')) rain = s.hazards.filter((h) => h.kind === 'soul');
  }
  assert.ok(rain && rain.length === T.rain.count, 'pas de pluie');
  assert.ok(rain.some((h) => Math.hypot(h.x - s.players[0].x, h.z - s.players[0].z) < 0.01), 'aucun cercle sous le héros');
  // Rester dessous : touché ; s'écarter : épargné
  const outcome = (move) => {
    const { s: s2 } = fight(8, 'pluie');
    let r = null;
    for (let i = 0; i < 60 * 20 && !r; i++) {
      s2.players[0].invuln = 99999;
      stepGame(s2, {});
      if (s2.events.some((e) => e.type === 'rain')) r = true;
    }
    s2.players[0].invuln = 0;
    const b2 = s2.enemies.find((e) => e.boss);
    const hp = s2.players[0].hp;
    for (let i = 0; i < ticks(T.rain.warn) + 2; i++) {
      stepGame(s2, {});
      if (move) {
        // On se place loin de tous les cercles
        s2.players[0].x = b2.x + 6;
        s2.players[0].z = b2.z;
      }
      b2.timer = Math.max(b2.timer, 5); // Thanatos ne fait rien d'autre pendant ce temps
    }
    return hp - s2.players[0].hp;
  };
  assert.ok(outcome(false) >= T.rain.damage, 'aurait dû être touché');
  assert.equal(outcome(true), 0, "aurait dû être épargné en s'écartant");
});

test('Thanatos phase 2 : deux doubles ; frapper un double le dissipe sans blesser Thanatos', () => {
  const { s, boss } = fight(8, 'doubles');
  boss.hp = Math.floor(boss.maxHp * T.phase2.at);
  run(s, 3, () => {
    s.players[0].invuln = 99999;
    return {};
  });
  const doubles = s.enemies.filter((e) => e.type === 'thanatosDouble');
  assert.equal(doubles.length, T.phase2.doubles);
  const hp = boss.hp;
  hit(s, doubles[0], 0.4);
  assert.ok(!s.enemies.includes(doubles[0]), 'le double aurait dû se dissiper');
  assert.equal(boss.hp, hp, 'frapper un double a blessé Thanatos');
});

test('Thanatos phase 3 : préparations plus courtes', () => {
  const reapWindup = (phase3) => {
    const { s, boss } = fight(8, 'phase3');
    if (phase3) boss.hp = Math.floor(boss.maxHp * T.phase3.at);
    for (let i = 0; i < 60 * 20; i++) {
      s.players[0].invuln = 99999;
      s.players[0].x = boss.x;
      s.players[0].z = boss.z + 2;
      for (const d of s.enemies) if (d.type === 'thanatosDouble') d.timer = 99999;
      stepGame(s, {});
      if (boss.mode === 'windup' && boss.attack === 'reap') return boss.windupTotal;
    }
    return Infinity;
  };
  assert.ok(reapWindup(true) < reapWindup(false));
});

test('vaincre Thanatos : victoire, et la partie se fige', () => {
  const { s, boss } = fight(8, 'victoire');
  s.players[0].invuln = 99999;
  boss.hp = 1;
  boss.mode = 'recover';
  boss.timer = 99;
  hit(s, boss, 0.4);
  assert.equal(s.status, 'victory');
  assert.ok(s.events.some((e) => e.type === 'victory'));
  const frozen = stateHash({ ...s, events: [] });
  run(s, 60, { moveX: 1, attack: true });
  assert.equal(stateHash({ ...s, events: [] }), frozen);
});

test('combats de l\'Hydre et de Thanatos : jamais dans un mur, rejeu identique', () => {
  for (const floor of [5, 8]) {
    const play = () => {
      const { s } = fight(floor, `rejeu-${floor}`);
      for (let i = 0; i < 60 * 40 && s.status === 'playing'; i++) {
        stepGame(s, { moveX: Math.cos(i / 29), moveY: Math.sin(i / 41), attack: i % 3 === 0, dash: i % 47 === 0 });
        for (const e of s.enemies) {
          if (e.untargetable) continue;
          assert.ok(!overlapsSolid(s.dungeon, e, SIM.enemies[e.type].radius), `${e.type} dans un mur`);
        }
      }
      return s;
    };
    assert.equal(stateHash(play()), stateHash(play()));
  }
});
