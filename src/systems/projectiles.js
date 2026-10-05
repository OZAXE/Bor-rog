// Projectiles : vont tout droit, se brisent sur les murs.
// - Ennemis (flèches, venin) : blessent le héros. Avec le Bouclier du vent (talent),
//   esquiver à travers un projectile le renvoie : il change de camp.
// - Alliés (`friendly`, ou renvoyés) : flèches de la Chasseresse (touchent le premier
//   ennemi, ou en traversent plusieurs avec Fendoir) et orbes de la Mystique (explosent
//   au contact, contre un mur ou en bout de course, et blessent tout autour).

import { SIM } from './simConfig.js';
import { isSolid, tileAt } from '../dungeon/tiles.js';
import { hurtPlayer, damageEnemy, removeDeadEnemies } from './player.js';
import { playerStats } from './boons.js';

export function updateProjectiles(state, dt) {
  const p = state.player;
  const hitDist = SIM.player.radius + 0.08;
  const reflect = playerStats(p).reflect;
  let enemyHit = false;
  state.projectiles = state.projectiles.filter((a) => {
    const ally = a.friendly || a.reflected;
    // Petits pas pour ne traverser ni un mur ni une cible entre deux images
    const total = Math.hypot(a.vx, a.vz) * dt;
    const steps = Math.max(1, Math.ceil(total / 0.15));
    for (let s = 0; s < steps; s++) {
      a.x += (a.vx * dt) / steps;
      a.z += (a.vz * dt) / steps;
      if (isSolid(tileAt(state.dungeon, Math.floor(a.x), Math.floor(a.z)))) {
        if (a.blast) {
          // L'orbe explose contre le mur, un peu en retrait pour toucher ceux qui s'y collent
          a.x -= (a.vx * dt) / steps;
          a.z -= (a.vz * dt) / steps;
          enemyHit = explode(state, a) || enemyHit;
        } else state.events.push({ type: 'arrowBreak', x: a.x, z: a.z, ally });
        return false;
      }
      if (ally) {
        // Projectile allié : touche le premier ennemi rencontré (pas encore touché)
        const e = state.enemies.find(
          (en) =>
            en.hp > 0 &&
            !en.untargetable &&
            !(a.hit && a.hit.includes(en.id)) &&
            Math.hypot(a.x - en.x, a.z - en.z) < SIM.enemies[en.type].radius + (a.radius || 0.1),
        );
        if (!e) continue;
        enemyHit = true;
        if (a.blast) {
          explode(state, a);
          return false;
        }
        const len = Math.hypot(a.vx, a.vz) || 1;
        damageEnemy(state, e, a.damage ?? playerStats(p).damage, { x: a.vx / len, z: a.vz / len });
        // Flèche perforante (Fendoir) : continue sa course
        if (a.pierce > 0) {
          a.pierce--;
          a.hit.push(e.id);
          continue;
        }
        return false;
      }
      if (Math.hypot(a.x - p.x, a.z - p.z) < hitDist) {
        // Esquive en cours + Bouclier du vent : le projectile repart vers l'ennemi
        if (reflect && p.dashTimer > 0) {
          a.vx = -a.vx;
          a.vz = -a.vz;
          a.reflected = true;
          a.damage = playerStats(p).damage;
          a.travelLeft = Math.max(a.travelLeft, 8);
          state.events.push({ type: 'reflect', x: a.x, z: a.z });
          continue;
        }
        // Pendant l'esquive (invulnérable), le projectile passe à travers le héros
        if (p.invuln === 0) {
          hurtPlayer(state, a.damage, a.x - a.vx, a.z - a.vz);
          return false;
        }
      }
    }
    a.travelLeft -= total;
    if (a.travelLeft > 0) return true;
    // En bout de course, l'orbe explose quand même
    if (a.blast) enemyHit = explode(state, a) || enemyHit;
    return false;
  });
  // Après le tri (un boss vaincu vide la liste des projectiles)
  if (enemyHit) removeDeadEnemies(state);
}

// Explosion d'un orbe : blesse tous les ennemis dans le rayon. Renvoie true si quelqu'un est touché.
function explode(state, a) {
  state.events.push({ type: 'orbBurst', x: a.x, z: a.z, r: a.blast });
  let any = false;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.untargetable) continue;
    const dx = e.x - a.x;
    const dz = e.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d > a.blast + SIM.enemies[e.type].radius) continue;
    // Recul vers l'extérieur de l'explosion
    const dir = d > 1e-6 ? { x: dx / d, z: dz / d } : { x: 0, z: 1 };
    if (damageEnemy(state, e, a.damage, dir)) any = true;
  }
  return any;
}
