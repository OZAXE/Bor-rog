// Comportement des ennemis (pur, déterministe). Chaque ennemi est une petite
// "machine à états" :
//   idle    : n'a pas encore vu le héros
//   chase   : le poursuit (l'Ombre) ou se place à bonne distance (l'archer)
//   windup  : prépare son coup / son tir. La direction est FIGÉE au début : c'est
//             ce qui laisse au joueur le temps de lire l'attaque et d'esquiver.
//   recover : temps mort après l'attaque, la fenêtre pour riposter

import { SIM, ticks } from './simConfig.js';
import { moveCircle } from './collision.js';
import { hasLineOfSight, facingOf, inArc } from './geometry.js';
import { hurtPlayer } from './player.js';

export function updateEnemies(state, dt) {
  const p = state.player;
  for (const e of state.enemies) {
    const cfg = SIM.enemies[e.type];
    if (e.hitFlash > 0) e.hitFlash--;
    if (e.shotCooldown > 0) e.shotCooldown--;

    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const dist = Math.hypot(dx, dz);

    // Repérage : à portée ET en ligne de vue (on ne voit pas à travers les murs)
    if (!e.alert && dist <= cfg.aggroRange && hasLineOfSight(state.dungeon, e.x, e.z, p.x, p.z)) {
      e.alert = true;
      e.mode = 'chase';
      state.events.push({ type: 'alert', id: e.id, x: e.x, z: e.z });
    }

    let mvx = 0; // déplacement voulu (m/s)
    let mvz = 0;
    if (e.alert && state.status === 'playing') {
      if (e.type === 'shade') ({ mvx, mvz } = shadeBrain(state, e, cfg, dx, dz, dist));
      else ({ mvx, mvz } = archerBrain(state, e, cfg, dx, dz, dist));
    }

    // Recul après un coup reçu, qui s'amortit
    const decay = SIM.enemies.knockbackDecay * dt;
    const kl = Math.hypot(e.kvx, e.kvz);
    if (kl > 0) {
      const k = Math.max(0, kl - decay) / kl;
      e.kvx *= k;
      e.kvz *= k;
    }

    const pos = { x: e.x, z: e.z };
    moveCircle(state.dungeon, pos, (mvx + e.kvx) * dt, (mvz + e.kvz) * dt, cfg.radius);
    e.x = pos.x;
    e.z = pos.z;
  }
  separate(state);
}

function shadeBrain(state, e, cfg, dx, dz, dist) {
  const p = state.player;
  switch (e.mode) {
    case 'chase': {
      e.facing = facingOf(dx, dz);
      if (dist <= cfg.attackRange) {
        e.mode = 'windup';
        e.timer = ticks(cfg.windup);
        e.aimX = dx / (dist || 1);
        e.aimZ = dz / (dist || 1);
        state.events.push({ type: 'windup', id: e.id });
        return { mvx: 0, mvz: 0 };
      }
      return { mvx: (dx / dist) * cfg.speed, mvz: (dz / dist) * cfg.speed };
    }
    case 'windup': {
      if (--e.timer > 0) return { mvx: 0, mvz: 0 };
      // Le coup part dans la direction figée au début de la préparation
      e.mode = 'recover';
      e.timer = ticks(cfg.recover);
      e.kvx += e.aimX * cfg.lunge;
      e.kvz += e.aimZ * cfg.lunge;
      state.events.push({ type: 'strike', id: e.id, x: e.x, z: e.z, facing: e.facing });
      if (inArc(e.x, e.z, e.facing, cfg.strikeRange, cfg.strikeArc, p.x, p.z, SIM.player.radius)) {
        hurtPlayer(state, cfg.damage, e.x, e.z);
      }
      return { mvx: 0, mvz: 0 };
    }
    case 'recover':
      if (--e.timer <= 0) e.mode = 'chase';
      return { mvx: 0, mvz: 0 };
    default:
      e.mode = 'chase';
      return { mvx: 0, mvz: 0 };
  }
}

function archerBrain(state, e, cfg, dx, dz, dist) {
  const p = state.player;
  switch (e.mode) {
    case 'chase': {
      e.facing = facingOf(dx, dz);
      const sees = hasLineOfSight(state.dungeon, e.x, e.z, p.x, p.z);
      if (sees && e.shotCooldown === 0 && dist <= cfg.preferMax + 1.5) {
        e.mode = 'windup';
        e.timer = ticks(cfg.windup);
        e.aimX = dx / (dist || 1);
        e.aimZ = dz / (dist || 1);
        state.events.push({ type: 'windup', id: e.id });
        return { mvx: 0, mvz: 0 };
      }
      const ux = dx / (dist || 1);
      const uz = dz / (dist || 1);
      // Trop près : recule. Trop loin ou caché : s'approche. Sinon : reste en place.
      if (dist < cfg.preferMin) return { mvx: -ux * cfg.speed, mvz: -uz * cfg.speed };
      if (dist > cfg.preferMax || !sees) return { mvx: ux * cfg.speed, mvz: uz * cfg.speed };
      return { mvx: 0, mvz: 0 };
    }
    case 'windup': {
      if (--e.timer > 0) return { mvx: 0, mvz: 0 };
      e.mode = 'recover';
      e.timer = ticks(cfg.recover);
      e.shotCooldown = ticks(cfg.cooldown);
      // La flèche part juste devant l'archer, dans la direction figée
      const start = cfg.radius + 0.15;
      state.projectiles.push({
        id: state.nextId++,
        x: e.x + e.aimX * start,
        z: e.z + e.aimZ * start,
        vx: e.aimX * cfg.arrowSpeed,
        vz: e.aimZ * cfg.arrowSpeed,
        travelLeft: cfg.arrowRange,
        damage: cfg.arrowDamage,
      });
      state.events.push({ type: 'shoot', id: e.id, x: e.x, z: e.z });
      return { mvx: 0, mvz: 0 };
    }
    case 'recover':
      if (--e.timer <= 0) e.mode = 'chase';
      return { mvx: 0, mvz: 0 };
    default:
      e.mode = 'chase';
      return { mvx: 0, mvz: 0 };
  }
}

// Les ennemis ne se superposent pas entre eux ni avec le héros (sauf pendant
// son esquive : on peut passer à travers un groupe, comme dans Hades)
function separate(state) {
  const list = state.enemies;
  const p = state.player;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const ra = SIM.enemies[a.type].radius;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const min = ra + SIM.enemies[b.type].radius;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz);
      if (d >= min || d === 0) continue;
      const push = (min - d) / 2;
      a.x -= (dx / d) * push;
      a.z -= (dz / d) * push;
      b.x += (dx / d) * push;
      b.z += (dz / d) * push;
    }
    if (p.dashTimer > 0) continue;
    const min = ra + SIM.player.radius;
    const dx = a.x - p.x;
    const dz = a.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < min && d > 0) {
      a.x += (dx / d) * (min - d);
      a.z += (dz / d) * (min - d);
    }
  }
  // La séparation a pu pousser un ennemi dans un mur : on l'en ressort
  for (const e of list) {
    const pos = { x: e.x, z: e.z };
    moveCircle(state.dungeon, pos, 0, 0, SIM.enemies[e.type].radius);
    e.x = pos.x;
    e.z = pos.z;
  }
}
