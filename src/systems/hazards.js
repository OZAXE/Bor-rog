// Zones dangereuses au sol : flaques de lave (Hydre), impacts d'âmes (Thanatos).
// Toujours en deux temps : d'abord l'ANNONCE (cercle au sol, sans danger), puis
// l'effet. Une zone "once" frappe une seule fois à la fin de l'annonce ; les autres
// brûlent tant qu'elles durent (au plus un dégât par passage d'invulnérabilité).

import { hurtPlayersWhere } from './player.js';
import { SIM } from './simConfig.js';

// warn, life, every : en pas de simulation
export function addHazard(state, { x, z, r, warn, life = 0, damage, every = 30, kind = 'lava' }) {
  const h = { id: state.nextId++, kind, x, z, r, warn, life, damage, every, timer: 0, once: life === 0 };
  state.hazards.push(h);
  return h;
}

export function updateHazards(state) {
  state.hazards = state.hazards.filter((h) => {
    const inside = (p) => Math.hypot(p.x - h.x, p.z - h.z) < h.r + SIM.player.radius * 0.5;
    if (h.warn > 0) {
      h.warn--;
      if (h.warn > 0) return true;
      state.events.push({ type: 'hazardStart', kind: h.kind, x: h.x, z: h.z, r: h.r });
      if (h.once) {
        hurtPlayersWhere(state, inside, h.damage, h.x, h.z);
        return false;
      }
    }
    if (h.life-- <= 0) return false;
    if (h.timer > 0) h.timer--;
    else if (state.players.some(inside)) {
      hurtPlayersWhere(state, inside, h.damage, h.x, h.z);
      h.timer = h.every;
    }
    return true;
  });
}
