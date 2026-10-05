// Comportement des ennemis (pur, déterministe). Chaque ennemi est une petite
// "machine à états" :
//   idle    : n'a pas encore vu le héros
//   chase   : le poursuit (l'Ombre) ou se place à bonne distance (l'archer)
//   windup  : prépare son coup / son tir. La direction est FIGÉE au début : c'est
//             ce qui laisse au joueur le temps de lire l'attaque et d'esquiver.
//   recover : temps mort après l'attaque, la fenêtre pour riposter

import { SIM, ticks } from './simConfig.js';
import { moveCircle } from './collision.js';
import { hasLineOfSight, hasClearPath, facingOf, inArc } from './geometry.js';
import { walkDistances } from '../dungeon/generate.js';
import { isWalkable, tileAt } from '../dungeon/tiles.js';
import { hurtPlayer } from './player.js';

export function updateEnemies(state, dt) {
  const p = state.player;
  // Carte des distances jusqu'au héros (plus court chemin sur la grille), calculée
  // au plus une fois par pas et seulement si un ennemi doit contourner un obstacle
  let flow = null;
  const getFlow = () => {
    if (!flow) flow = walkDistances(state.dungeon, { c: Math.floor(p.x), r: Math.floor(p.z) });
    return flow;
  };
  const ctx = { getFlow };
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
      if (e.type === 'shade') ({ mvx, mvz } = shadeBrain(state, e, cfg, dx, dz, dist, ctx));
      else ({ mvx, mvz } = archerBrain(state, e, cfg, dx, dz, dist, ctx));
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

function shadeBrain(state, e, cfg, dx, dz, dist, ctx) {
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
      const dir = approachDir(state, e, cfg, ctx);
      return { mvx: dir.x * cfg.speed, mvz: dir.z * cfg.speed };
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

function archerBrain(state, e, cfg, dx, dz, dist, ctx) {
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
      // Caché (pilier, angle) : il se replace d'abord pour retrouver une ligne de tir,
      // même s'il est proche ; sinon il resterait tapi derrière l'obstacle sans tirer.
      // Ensuite : trop près, il recule ; trop loin, il s'approche ; sinon il reste en place.
      if (!sees || dist > cfg.preferMax) {
        const dir = approachDir(state, e, cfg, ctx);
        return { mvx: dir.x * cfg.speed, mvz: dir.z * cfg.speed };
      }
      if (dist < cfg.preferMin) return { mvx: -ux * cfg.speed, mvz: -uz * cfg.speed };
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

// Direction pour s'approcher du héros : tout droit si le passage est libre pour le
// corps de l'ennemi, sinon vers la case voisine la plus proche du héros en distance
// de marche (il contourne ainsi piliers et angles au lieu de s'y cogner)
function approachDir(state, e, cfg, ctx) {
  const p = state.player;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const dist = Math.hypot(dx, dz) || 1;
  if (hasClearPath(state.dungeon, e.x, e.z, p.x, p.z, cfg.radius)) return { x: dx / dist, z: dz / dist };
  const flow = ctx.getFlow();
  const d = state.dungeon;
  const c = Math.floor(e.x);
  const r = Math.floor(e.z);
  const here = flow[r * d.width + c];
  let best = null;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!isWalkable(tileAt(d, c + dc, r + dr))) continue;
    const v = flow[(r + dr) * d.width + c + dc];
    if (v < 0 || (here >= 0 && v >= here)) continue;
    if (!best || v < best.v) best = { c: c + dc, r: r + dr, v };
  }
  if (!best) return { x: dx / dist, z: dz / dist }; // aucun chemin connu : tout droit
  const tx = best.c + 0.5 - e.x;
  const tz = best.r + 0.5 - e.z;
  const tl = Math.hypot(tx, tz) || 1;
  return { x: tx / tl, z: tz / tl };
}

// Les ennemis ne se superposent pas entre eux ni avec le héros (sauf pendant
// son esquive : on peut passer à travers un groupe, comme dans Hades).
// On calcule d'abord la poussée de chacun, puis on l'applique comme un vrai
// déplacement (découpé en petits pas, avec collisions) : une poussée ne peut
// donc jamais faire entrer un ennemi dans un mur, même coincé dans un angle.
function separate(state) {
  const list = state.enemies;
  const p = state.player;
  const push = list.map(() => ({ x: 0, z: 0 }));
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
      const k = (min - d) / 2 / d;
      push[i].x -= dx * k;
      push[i].z -= dz * k;
      push[j].x += dx * k;
      push[j].z += dz * k;
    }
    if (p.dashTimer > 0) continue;
    const min = ra + SIM.player.radius;
    const dx = a.x - p.x;
    const dz = a.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < min && d > 0) {
      push[i].x += (dx / d) * (min - d);
      push[i].z += (dz / d) * (min - d);
    }
  }
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const pos = { x: e.x, z: e.z };
    moveCircle(state.dungeon, pos, push[i].x, push[i].z, SIM.enemies[e.type].radius);
    e.x = pos.x;
    e.z = pos.z;
  }
}
