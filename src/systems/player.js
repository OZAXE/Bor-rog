// Le héros : déplacement, esquive, attaque, dégâts reçus. Fonctions pures sur l'état.

import { SIM, ticks } from './simConfig.js';
import { moveCircle } from './collision.js';
import { hasLineOfSight, facingOf, dirOf, inArc, angleBetween } from './geometry.js';
import { playerStats } from './boons.js';
import { dropFromEnemy, dropBossReward } from './loot.js';
import { nextFloat } from '../core/rng.js';
import { metaValue, rankOf } from '../meta/tree.js';
import { classRules } from './classes.js';

export function updatePlayer(state, intent, dt) {
  const p = state.player;
  const cfg = SIM.player;
  const st = playerStats(p);
  tickDown(p, st);

  const moving = intent.moveX !== 0 || intent.moveY !== 0;
  // Direction de marche dans le monde : moveY > 0 = vers le nord = z négatif
  const moveX = intent.moveX;
  const moveZ = -intent.moveY;

  // ---------- Esquive : une par appui, s'il reste une charge ----------
  // (une seule charge sans amélioration ; deux avec le Second souffle)
  const dashPressed = intent.dash && !p.dashHeld;
  p.dashHeld = intent.dash;
  if (dashPressed && p.dashCharges > 0 && p.dashTimer === 0) {
    // Dans le sens de la marche, sinon droit devant
    const len = Math.hypot(moveX, moveZ);
    const d = len > 0 ? { x: moveX / len, z: moveZ / len } : dirOf(p.facing);
    p.dashX = d.x;
    p.dashZ = d.z;
    p.dashTimer = ticks(cfg.dash.duration);
    p.dashCharges--;
    if (p.dashCooldown === 0) p.dashCooldown = ticks(st.dashCooldown);
    p.invuln = Math.max(p.invuln, ticks(st.dashInvuln));
    p.attackTimer = 0; // l'esquive annule le coup en cours
    // Élan : le premier coup qui suit de près l'esquive est renforcé
    if (st.momentum) p.afterDash = ticks(cfg.dash.duration + 0.6);
    p.danceHits = [];
    p.facing = facingOf(p.dashX, p.dashZ);
    state.events.push({ type: 'dash', x: p.x, z: p.z });
  }

  // ---------- Vitesse ----------
  if (p.dashTimer > 0) {
    p.vx = p.dashX * cfg.dash.speed;
    p.vz = p.dashZ * cfg.dash.speed;
  } else {
    const slow = p.attackTimer > 0 ? st.moveFactor : 1;
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
  if (p.dashTimer > 0 && st.bladeDance) danceStrike(state, st);
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
    p.attackTimer = ticks(st.attackDuration);
    p.attackCooldown = ticks(st.attackCooldown);
    if (st.weapon === 'sword') {
      state.events.push({ type: 'swing', x: p.x, z: p.z, facing: p.facing, range: st.attackRange, arc: st.attackArc });
      resolvePlayerHit(state);
    } else shoot(state, st);
  }

  // ---------- Capacité spéciale (une par appui, si elle est rechargée) ----------
  const specialPressed = intent.special && !p.specialHeld;
  p.specialHeld = intent.special;
  if (specialPressed && p.specialCooldown === 0 && p.dashTimer === 0) {
    if (aiming) p.facing = facingOf(intent.aimX, -intent.aimY);
    else {
      const target = autoAimTarget(state);
      if (target) p.facing = facingOf(target.x - p.x, target.z - p.z);
    }
    useSpecial(state, st);
  }
  // Seconde frappe du Tourbillon / seconde salve de la Volée
  if (p.specialEcho > 0 && --p.specialEcho === 0) {
    const facing = p.facing;
    p.facing = p.echoFacing;
    useSpecial(state, st, true);
    p.facing = facing;
  }
}

// Capacités spéciales des classes (réglages : SIM.classes[classe].special)
// echo : seconde frappe ou seconde salve (Tempête, Seconde salve), sans recharge
function useSpecial(state, st, echo = false) {
  const p = state.player;
  const sp = st.special;
  if (!echo) {
    p.specialCooldown = ticks(sp.cooldown);
    if (sp.echo) {
      p.specialEcho = ticks(0.3);
      p.echoFacing = p.facing;
    }
  }
  p.attackTimer = 0;
  if (sp.id === 'volley') {
    // Volée : flèches en éventail autour de la direction visée
    const base = p.facing;
    for (let k = 0; k < sp.count; k++) {
      p.facing = base + (k / (sp.count - 1) - 0.5) * sp.spread;
      shoot(state, st, true);
    }
    p.facing = base;
    state.events.push({ type: 'special', id: 'volley', x: p.x, z: p.z, facing: base, echo });
    return;
  }
  // Tourbillon (Guerrier) et Nova (Mystique) : tout ce qui est autour du héros
  if (sp.id === 'whirl' && !echo) p.invuln = Math.max(p.invuln, ticks(sp.invuln));
  state.events.push({ type: 'special', id: sp.id, x: p.x, z: p.z, r: sp.radius, facing: p.facing, echo });
  for (const e of state.enemies) {
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > sp.radius + SIM.enemies[e.type].radius) continue;
    if (!hasLineOfSight(state.dungeon, p.x, p.z, e.x, e.z)) continue;
    const dir = d > 1e-6 ? { x: dx / d, z: dz / d } : { x: 0, z: 1 };
    if (!damageEnemy(state, e, st.damage * sp.damageMult, dir)) continue;
    if (e.boss || e.part) continue; // un boss ne recule pas et n'est pas ralenti
    if (sp.knockback) {
      e.kvx = dir.x * sp.knockback;
      e.kvz = dir.z * sp.knockback;
    }
    if (sp.slow) e.slow = ticks(sp.slow);
  }
  removeDeadEnemies(state);
}

// Le coup touche tous les ennemis dans l'arc, à portée, et visibles (pas à travers un mur)
function resolvePlayerHit(state) {
  const p = state.player;
  const st = playerStats(p);
  const dir = dirOf(p.facing);
  // Élan : bonus sur le premier coup après une esquive (consommé même si le coup rate)
  const bonus = p.afterDash > 0 ? st.momentum : 0;
  p.afterDash = 0;
  // Riposte : coup doublé juste après une parade
  const mult = p.riposte ? 2 : 1;
  p.riposte = false;
  for (const e of state.enemies) {
    const r = SIM.enemies[e.type].radius;
    if (!inArc(p.x, p.z, p.facing, st.attackRange, st.attackArc, e.x, e.z, r)) continue;
    if (!hasLineOfSight(state.dungeon, p.x, p.z, e.x, e.z)) continue;
    damageEnemy(state, e, (st.damage + bonus) * mult, dir);
  }
  removeDeadEnemies(state);
}

// Chasseresse et Mystique : le coup est un projectile allié (flèche ou orbe), qui
// part devant le héros dans la direction visée. Il est résolu dans projectiles.js.
// special : tir d'une capacité (Volée), sans Élan ni événement de tir
function shoot(state, st, special = false) {
  const p = state.player;
  const d = dirOf(p.facing);
  // Élan : bonus sur le premier tir après une esquive
  const bonus = !special && p.afterDash > 0 ? st.momentum : 0;
  if (!special) p.afterDash = 0;
  const start = SIM.player.radius + 0.2;
  const kind = st.weapon === 'bow' ? 'heroArrow' : 'orb';
  // Orbes jumeaux (Mystique) : deux orbes un peu écartés, chacun moins fort
  if (kind === 'orb' && st.twinOrbs && !p.twinning) {
    const f = p.facing;
    p.twinning = true;
    for (const da of [-0.16, 0.16]) {
      p.facing = f + da;
      shoot(state, { ...st, damage: st.damage * st.twinOrbs }, special);
    }
    p.facing = f;
    p.twinning = false;
    return;
  }
  state.projectiles.push({
    id: state.nextId++,
    kind,
    friendly: true, // touche les ennemis, jamais le héros
    x: p.x + d.x * start,
    z: p.z + d.z * start,
    vx: d.x * st.shotSpeed,
    vz: d.z * st.shotSpeed,
    travelLeft: st.shotRange,
    radius: st.shotRadius,
    damage: st.damage + bonus,
    pierce: st.pierce, // ennemis que la flèche peut encore traverser
    hit: [], // ennemis déjà touchés par ce projectile
    blast: st.blast, // rayon d'explosion de l'orbe (0 = pas d'explosion)
    ox: p.x, // point de départ (Tir précis : bonus au-delà de 5 m)
    oz: p.z,
  });
  if (!special) state.events.push({ type: 'heroShot', kind, x: p.x, z: p.z, facing: p.facing });
}

// Danse des lames : pendant l'esquive, chaque ennemi traversé est frappé une fois
function danceStrike(state, st) {
  const p = state.player;
  let hit = false;
  for (const e of state.enemies) {
    if (e.hp <= 0 || p.danceHits.includes(e.id)) continue;
    if (Math.hypot(e.x - p.x, e.z - p.z) > SIM.enemies[e.type].radius + SIM.player.radius + 0.35) continue;
    p.danceHits.push(e.id);
    if (damageEnemy(state, e, st.damage, { x: p.dashX, z: p.dashZ })) hit = true;
  }
  if (hit) removeDeadEnemies(state);
}

// Inflige des dégâts du héros à un ennemi (coup ou projectile renvoyé).
// dir : direction du coup, pour le recul. Renvoie false si l'ennemi n'a pas été touché.
export function damageEnemy(state, e, amount, dir) {
  if (e.untargetable) return false; // Thanatos disparu dans sa téléportation
  // Un double de Thanatos s'évanouit au premier coup, sans blesser le vrai
  if (e.type === 'thanatosDouble') {
    e.hp = 0;
    e.noDrop = true;
    state.events.push({ type: 'dispel', id: e.id, x: e.x, z: e.z });
    return true;
  }
  if (e.invulnerable) {
    state.events.push({ type: 'deflect', id: e.id, x: e.x, z: e.z });
    return false;
  }
  // Coup du destin (arbre permanent) : chance de dégâts doublés.
  // Le tirage n'a lieu que si l'amélioration est possédée (sinon la partie ne change pas)
  const st = playerStats(state.player);
  let dmg = amount;
  let crit = false;
  if (st.critChance > 0 && nextFloat(state.rng) < st.critChance) {
    dmg *= 2;
    crit = true;
  }
  // Bris de glace (Mystique) : plus de dégâts sur un ennemi ralenti
  if (st.shatter && e.slow > 0) dmg *= 1 + st.shatter;
  // Exécution : dégâts doublés sur un ennemi déjà bien entamé
  if (st.executeBelow && e.hp <= e.maxHp * st.executeBelow) dmg *= 2;
  e.hp -= dmg;
  e.hitFlash = ticks(0.12);
  e.alert = true;
  // Recul dans l'axe du coup : éloigne l'ennemi et interrompt sa préparation.
  // Un boss, lui, ne recule pas et ne se laisse pas interrompre.
  if (!e.boss && !e.part) {
    const kb = st.knockback;
    e.kvx = dir.x * kb;
    e.kvz = dir.z * kb;
    if (e.mode === 'windup') {
      e.mode = 'recover';
      e.timer = ticks(0.35);
    }
  }
  state.events.push({ type: 'hit', id: e.id, x: e.x, z: e.z, crit });
  return true;
}

// Retire les ennemis vaincus : butin, Ombres, Tribut d'Hadès, défaite d'un boss
export function removeDeadEnemies(state) {
  const p = state.player;
  const st = playerStats(p);
  const sh = SIM.shadows;
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
    state.hazards = [];
    state.events.push({ type: 'bossDefeated', id: deadBoss.id, bossType: deadBoss.type, x: deadBoss.x, z: deadBoss.z });
    dropBossReward(state, deadBoss);
    state.shadows += sh.bosses[deadBoss.type] || 0;
    state.bossesDefeated.push(deadBoss.type);
    // Moisson (talent) : chaque boss vaincu rend le héros plus robuste
    const grow = metaValue(p.meta, 'harvest');
    if (grow) {
      p.maxHp += grow;
      p.hp += grow;
      state.events.push({ type: 'heal', amount: grow, x: p.x, z: p.z });
    }
    // Thanatos vaincu : c'est la victoire de la partie
    if (deadBoss.type === 'thanatos') {
      state.status = 'victory';
      state.events.push({ type: 'victory' });
    }
  }
  const before = state.enemies.length;
  state.enemies = state.enemies.filter((e) => {
    if (e.hp > 0) return true;
    state.events.push({ type: 'enemyDied', id: e.id, enemyType: e.type, x: e.x, z: e.z, boss: e.boss });
    if (!e.boss && !e.part && !e.noDrop) {
      dropFromEnemy(state, e);
      state.shadows += e.elite ? sh.elite : sh.enemy;
    }
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
  const killed = before - state.enemies.length;
  state.kills += killed;
  // Rage d'Arès : cadence accrue pendant 3 s après avoir vaincu un ennemi
  if (killed > 0 && rankOf(p.meta, 'rage')) p.rage = ticks(3);
  // Instinct de chasse (Chasseresse) : vitesse et cadence pendant 3 s
  if (killed > 0 && rankOf(p.meta, 'hunt')) p.hunt = ticks(3);
  // Colère des Titans (Guerrier) : chaque ennemi vaincu recharge le Tourbillon de 1 s
  if (killed > 0 && rankOf(p.meta, 'titan')) p.specialCooldown = Math.max(0, p.specialCooldown - ticks(1) * killed);
}

// Sans visée (mobile) : l'ennemi le plus proche à portée, en privilégiant ceux devant
export function autoAimTarget(state) {
  const p = state.player;
  let best = null;
  let bestScore = Infinity;
  for (const e of state.enemies) {
    if (e.untargetable) continue;
    const dist = Math.hypot(e.x - p.x, e.z - p.z);
    if (dist > playerStats(p).autoAimRange) continue;
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
  const st = playerStats(p);
  // Parade (Guerrier) : chance d'annuler le coup ; le tirage n'a lieu qu'avec le talent
  if (st.parry > 0 && nextFloat(state.rng) < st.parry) {
    p.invuln = ticks(0.3);
    p.riposte = rankOf(p.meta, 'riposte') > 0;
    state.events.push({ type: 'parry', x: p.x, z: p.z });
    return false;
  }
  p.hp = Math.max(0, p.hp - amount);
  p.invuln = ticks(st.hurtInvuln);
  state.events.push({ type: 'playerHurt', amount, x: p.x, z: p.z, fromX, fromZ });
  if (p.hp === 0 && p.defiance > 0) {
    // Défi de la Mort (arbre permanent) : on se relève, une fois par partie
    p.defiance--;
    p.hp = Math.max(1, Math.round(p.maxHp * metaValue(p.meta, 'defiance')));
    p.invuln = ticks(SIM.player.defianceInvuln);
    state.events.push({ type: 'defiance', x: p.x, z: p.z });
  } else if (p.hp === 0) {
    state.status = 'dead';
    state.events.push({ type: 'playerDied', x: p.x, z: p.z });
  }
  return true;
}

function tickDown(p, st) {
  if (p.attackTimer > 0) p.attackTimer--;
  if (p.attackCooldown > 0) p.attackCooldown--;
  if (p.dashTimer > 0) p.dashTimer--;
  // Recharge des esquives : une charge à la fois
  if (p.dashCooldown > 0 && --p.dashCooldown === 0 && p.dashCharges < st.dashCharges) {
    p.dashCharges++;
    if (p.dashCharges < st.dashCharges) p.dashCooldown = ticks(st.dashCooldown);
  }
  if (p.invuln > 0) p.invuln--;
  if (p.rage > 0) p.rage--;
  if (p.specialCooldown > 0) p.specialCooldown--;
  if (p.hunt > 0) p.hunt--;
  if (p.afterDash > 0) p.afterDash--;
}

function approach(value, target, maxDelta) {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

// Poison (Chasseresse) : les ennemis empoisonnés perdent des PV chaque pas
export function tickPoison(state) {
  let died = false;
  for (const e of state.enemies) {
    if (!(e.poison > 0)) continue;
    e.poison--;
    e.hp -= e.poisonDps / SIM.tickRate;
    if (e.poison % 30 === 0) state.events.push({ type: 'poison', id: e.id, x: e.x, z: e.z });
    if (e.hp <= 0) died = true;
  }
  if (died) removeDeadEnemies(state);
}
