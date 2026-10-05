// Projectiles (flèches) : vont tout droit, se brisent sur les murs, blessent le héros.

import { SIM } from './simConfig.js';
import { isSolid, tileAt } from '../dungeon/tiles.js';
import { hurtPlayer } from './player.js';

export function updateProjectiles(state, dt) {
  const p = state.player;
  const hitDist = SIM.player.radius + 0.08;
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
      // Pendant l'esquive (invulnérable), la flèche passe à travers le héros
      if (Math.hypot(a.x - p.x, a.z - p.z) < hitDist && p.invuln === 0) {
        hurtPlayer(state, a.damage, a.x - a.vx, a.z - a.vz);
        return false;
      }
    }
    a.travelLeft -= total;
    return a.travelLeft > 0;
  });
}
