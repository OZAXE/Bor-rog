// Projectiles (flèches, venin) : vont tout droit, se brisent sur les murs, blessent le héros.
// Avec le Bouclier du vent (arbre permanent), esquiver à travers un projectile le
// renvoie : il change de camp et blesse les ennemis qu'il traverse.

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
    // Petits pas pour ne traverser ni un mur ni le héros entre deux images
    const total = Math.hypot(a.vx, a.vz) * dt;
    const steps = Math.max(1, Math.ceil(total / 0.15));
    for (let s = 0; s < steps; s++) {
      a.x += (a.vx * dt) / steps;
      a.z += (a.vz * dt) / steps;
      if (isSolid(tileAt(state.dungeon, Math.floor(a.x), Math.floor(a.z)))) {
        state.events.push({ type: 'arrowBreak', x: a.x, z: a.z });
        return false;
      }
      if (a.reflected) {
        // Projectile renvoyé : touche le premier ennemi rencontré
        const e = state.enemies.find(
          (en) => en.hp > 0 && !en.untargetable && Math.hypot(a.x - en.x, a.z - en.z) < SIM.enemies[en.type].radius + 0.1,
        );
        if (e) {
          const len = Math.hypot(a.vx, a.vz) || 1;
          damageEnemy(state, e, playerStats(p).damage, { x: a.vx / len, z: a.vz / len });
          enemyHit = true;
          return false;
        }
        continue;
      }
      if (Math.hypot(a.x - p.x, a.z - p.z) < hitDist) {
        // Esquive en cours + Bouclier du vent : le projectile repart vers l'ennemi
        if (reflect && p.dashTimer > 0) {
          a.vx = -a.vx;
          a.vz = -a.vz;
          a.reflected = true;
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
    return a.travelLeft > 0;
  });
  // Après le tri (un boss vaincu vide la liste des projectiles)
  if (enemyHit) removeDeadEnemies(state);
}
