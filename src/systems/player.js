// Le héros : déplacement, esquive, attaque, dégâts reçus. Fonctions pures sur l'état.

import { SIM, ticks } from './simConfig.js';
import { moveCircle } from './collision.js';
import { hasLineOfSight, facingOf, dirOf, inArc, angleBetween } from './geometry.js';
import { playerStats } from './boons.js';
import { dropFromEnemy, dropBossReward } from './loot.js';

export function updatePlayer(state, intent, dt) {
  const p = state.player;
  const cfg = SIM.player;
  const st = playerStats(p);
  tickDown(p);

  const moving = intent.moveX !== 0 || intent.moveY !== 0;
  // Direction de marche dans le monde : moveY > 0 = vers le nord = z négatif
  const moveX = intent.moveX;
  const moveZ = -intent.moveY;

  // ---------- Esquive : une par appui, si elle est rechargée ----------
  const dashPressed = intent.dash && !p.dashHeld;
  p.dashHeld = intent.dash;
  if (dashPressed && p.dashCooldown === 0 && p.dashTimer === 0) {
    // Dans le sens de la marche, sinon droit devant
    const len = Math.hypot(moveX, moveZ);
    const d = len > 0 ? { x: moveX / len, z: moveZ / len } : dirOf(p.facing);
    p.dashX = d.x;
    p.dashZ = d.z;
    p.dashTimer = ticks(cfg.dash.duration);
    p.dashCooldown = ticks(st.dashCooldown);
    p.invuln = Math.max(p.invuln, ticks(cfg.dash.invuln));
    p.attackTimer = 0; // l'esquive annule le coup en cours
    p.facing = facingOf(p.dashX, p.dashZ);
    state.events.push({ type: 'dash', x: p.x, z: p.z });
  }

  // ---------- Vitesse ----------
  if (p.dashTimer > 0) {
    p.vx = p.dashX * cfg.dash.speed;
    p.vz = p.dashZ * cfg.dash.speed;
  } else {
    const slow = p.attackTimer > 0 ? cfg.attack.moveFactor : 1;
    const targetVx = moveX * st.speed * slow;
    const targetVz = moveZ * st.speed * slow;
    // Accélération franche, freinage encore plus franc : le héros répond tout de suite
    const rate = (moving ? cfg.acceleration : cfg.deceleration) * dt;
    p.vx = approach(p.vx, targetVx, rate);
    p.vz = approach(p.vz, targetVz, rate);
  }

  const before = { x: p.x, z: p.z };
  const pos = { x: p.x, z: p.z };
  moveCircle(state.dungeon, pos, p.vx * dt, p.vz * dt, cfg.radius);
  p.x = pos.x;
  p.z = pos.z;
  // Contre un mur, la vitesse réelle est celle du déplacement effectué
  p.vx = (p.x - before.x) / dt;
  p.vz = (p.z - before.z) / dt;

  // ---------- Orientation (hors esquive) ----------
  const aiming = intent.aimX !== 0 || intent.aimY !== 0;
  if (p.dashTimer === 0 && p.attackTimer === 0) {
    if (aiming) p.facing = facingOf(intent.aimX, -intent.aimY);
    else if (moving) p.facing = facingOf(moveX, moveZ);
  }

  // ---------- Attaque (bouton maintenu = coups enchaînés au rythme du délai) ----------
  if (intent.attack && p.attackCooldown === 0 && p.dashTimer === 0) {
    if (aiming) p.facing = facingOf(intent.aimX, -intent.aimY);
    else {
      const target = autoAimTarget(state);
      if (target) p.facing = facingOf(target.x - p.x, target.z - p.z);
    }
    p.attackTimer = ticks(cfg.attack.duration);
    p.attackCooldown = ticks(st.attackCooldown);
    state.events.push({ type: 'swing', x: p.x, z: p.z, facing: p.facing });
    resolvePlayerHit(state);
  }
}

// Le coup touche tous les ennemis dans l'arc, à portée, et visibles (pas à travers un mur)
function resolvePlayerHit(state) {
  const p = state.player;
  const a = SIM.player.attack;
  const st = playerStats(p);
  const dir = dirOf(p.facing);
  for (const e of state.enemies) {
    const r = SIM.enemies[e.type].radius;
    if (!inArc(p.x, p.z, p.facing, st.attackRange, a.arc, e.x, e.z, r)) continue;
    if (!hasLineOfSight(state.dungeon, p.x, p.z, e.x, e.z)) continue;
    if (e.invulnerable) {
      state.events.push({ type: 'deflect', id: e.id, x: e.x, z: e.z });
      continue;
    }
    e.hp -= st.damage;
    e.hitFlash = ticks(0.12);
    e.alert = true;
    // Recul dans l'axe du coup : éloigne l'ennemi et interrompt sa préparation.
    // Un boss, lui, ne recule pas et ne se laisse pas interrompre.
    if (!e.boss) {
      e.kvx = dir.x * a.knockback;
      e.kvz = dir.z * a.knockback;
      if (e.mode === 'windup') {
        e.mode = 'recover';
        e.timer = ticks(0.35);
      }
    }
    state.events.push({ type: 'hit', id: e.id, x: e.x, z: e.z });
  }
  // Boss vaincu : ses serviteurs se dissipent avec lui
  const deadBoss = state.enemies.find((e) => e.boss && e.hp <= 0);
  if (deadBoss) {
    for (const e of state.enemies) {
      if (!e.boss && e.hp > 0) {
        e.hp = 0;
        e.noDrop = true;
      }
    }
    state.projectiles = [];
    state.events.push({ type: 'bossDefeated', id: deadBoss.id, bossType: deadBoss.type, x: deadBoss.x, z: deadBoss.z });
    dropBossReward(state, deadBoss);
  }
  // Retrait des ennemis vaincus
  const before = state.enemies.length;
  state.enemies = state.enemies.filter((e) => {
    if (e.hp > 0) return true;
    state.events.push({ type: 'enemyDied', id: e.id, enemyType: e.type, x: e.x, z: e.z, boss: e.boss });
    if (!e.boss && !e.noDrop) dropFromEnemy(state, e);
    // Tribut d'Hadès : la vie revient au fil des ennemis vaincus
    if (st.killsPerHeal && ++p.killsSinceHeal >= st.killsPerHeal) {
      p.killsSinceHeal = 0;
      if (p.hp < p.maxHp) {
        p.hp++;
        state.events.push({ type: 'heal', amount: 1, x: p.x, z: p.z });
      }
    }
    return false;
  });
  state.kills += before - state.enemies.length;
}

// Sans visée (mobile) : l'ennemi le plus proche à portée, en privilégiant ceux devant
export function autoAimTarget(state) {
  const p = state.player;
  let best = null;
  let bestScore = Infinity;
  for (const e of state.enemies) {
    const dist = Math.hypot(e.x - p.x, e.z - p.z);
    if (dist > SIM.player.attack.autoAimRange * (playerStats(p).attackRange / SIM.player.attack.range)) continue;
    if (!hasLineOfSight(state.dungeon, p.x, p.z, e.x, e.z)) continue;
    // Un ennemi derrière "compte" comme 1,5 m plus loin qu'un ennemi devant
    const behind = angleBetween(p.facing, facingOf(e.x - p.x, e.z - p.z)) / Math.PI;
    const score = dist + behind * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

// Dégâts reçus par le héros (ignorés s'il est invulnérable)
export function hurtPlayer(state, amount, fromX, fromZ) {
  const p = state.player;
  if (p.invuln > 0 || state.status !== 'playing') return false;
  p.hp = Math.max(0, p.hp - amount);
  p.invuln = ticks(playerStats(p).hurtInvuln);
  state.events.push({ type: 'playerHurt', amount, x: p.x, z: p.z, fromX, fromZ });
  if (p.hp === 0) {
    state.status = 'dead';
    state.events.push({ type: 'playerDied', x: p.x, z: p.z });
  }
  return true;
}

function tickDown(p) {
  if (p.attackTimer > 0) p.attackTimer--;
  if (p.attackCooldown > 0) p.attackCooldown--;
  if (p.dashTimer > 0) p.dashTimer--;
  if (p.dashCooldown > 0) p.dashCooldown--;
  if (p.invuln > 0) p.invuln--;
}

function approach(value, target, maxDelta) {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}
