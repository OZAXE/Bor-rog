// Partenaire contrôlé par l'ordinateur (mode de test ?coop=bot, étape 8c).
// Comme les vrais contrôles, il ne touche jamais à l'état : il LIT l'état et
// produit une intention, que la simulation traite comme celle d'un joueur.
// Déterministe (aucun Math.random) : une partie avec lui se rejoue à l'identique.
//
// Priorités : relever l'allié à terre, puis se battre, puis suivre l'allié.

import { walkDistances } from '../dungeon/generate.js';
import { isWalkable, tileAt } from '../dungeon/tiles.js';
import { hasClearPath, hasLineOfSight } from '../systems/geometry.js';
import { isActive } from '../state/gameState.js';
import { SIM } from '../systems/simConfig.js';

// Distance de combat et portée d'attaque par classe
const STYLE = {
  warrior: { keep: 1.2, reach: 2.2 },
  huntress: { keep: 4.5, reach: 8 },
  mystic: { keep: 3.5, reach: 6.5 },
};

export function createAllyBot(index) {
  let flowKey = '';
  let flow = null;
  let lastDash = -999;

  // Direction vers une cible : tout droit si le passage est libre, sinon le plus court chemin
  function toward(state, me, tx, tz) {
    const d = state.dungeon;
    const dx = tx - me.x;
    const dz = tz - me.z;
    const len = Math.hypot(dx, dz) || 1;
    if (hasClearPath(d, me.x, me.z, tx, tz, SIM.player.radius)) return { moveX: dx / len, moveY: -dz / len };
    const key = `${d.width}:${Math.floor(tx)},${Math.floor(tz)}:${state.floorIndex}`;
    if (key !== flowKey) {
      flowKey = key;
      flow = walkDistances(d, { c: Math.floor(tx), r: Math.floor(tz) });
    }
    const c = Math.floor(me.x);
    const r = Math.floor(me.z);
    const here = flow[r * d.width + c];
    let best = null;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!isWalkable(tileAt(d, c + dc, r + dr))) continue;
      const v = flow[(r + dr) * d.width + c + dc];
      if (v >= 0 && (here < 0 || v < here) && (!best || v < best.v)) best = { c: c + dc, r: r + dr, v };
    }
    if (!best) return { moveX: dx / len, moveY: -dz / len };
    const gx = best.c + 0.5 - me.x;
    const gz = best.r + 0.5 - me.z;
    const gl = Math.hypot(gx, gz) || 1;
    return { moveX: gx / gl, moveY: -gz / gl };
  }

  return function allyIntent(state) {
    const me = state.players[index];
    if (!me) return {};
    // Écran de Charon : soin s'il est bien entamé, puis le premier bienfait proposé
    if (state.status === 'choosing') {
      if (!me.offer) return {};
      if (me.hp < me.maxHp * 0.5 && me.gold >= 15 && state.tick % 2 === 0) return { shop: 'heal' };
      return { choice: 0 };
    }
    if (state.status !== 'playing' || !isActive(me)) return {};
    const mate = state.players.find((p) => p !== me);

    // 1. Relever l'allié à terre (sauf si un ennemi est collé à soi)
    if (mate && mate.down > 0) {
      const d = Math.hypot(mate.x - me.x, mate.z - me.z);
      return d > SIM.coop.reviveRadius * 0.7 ? toward(state, me, mate.x, mate.z) : {};
    }

    // 2. Combat : l'ennemi repéré le plus proche, visible
    const style = STYLE[me.cls] || STYLE.warrior;
    let near = null;
    let nd = Infinity;
    for (const e of state.enemies) {
      if (e.untargetable || !e.alert) continue;
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      if (d < nd && d < 9 && hasLineOfSight(state.dungeon, me.x, me.z, e.x, e.z)) {
        nd = d;
        near = e;
      }
    }
    // Esquive d'une attaque annoncée toute proche (une fois de temps en temps)
    const danger = state.enemies.some(
      (e) => e.mode === 'windup' && e.timer < 12 && Math.hypot(e.x - me.x, e.z - me.z) < (e.boss ? 4.5 : 3),
    );
    const dash = danger && state.tick - lastDash > 45 && (state.tick + index) % 3 !== 0;
    if (dash) lastDash = state.tick;
    // Zone dangereuse au sol : on en sort
    const zone = state.hazards.find((h) => Math.hypot(h.x - me.x, h.z - me.z) < h.r + 0.4);
    if (zone) {
      const zx = me.x - zone.x;
      const zz = me.z - zone.z;
      const zl = Math.hypot(zx, zz) || 1;
      return { moveX: zx / zl, moveY: -zz / zl, dash };
    }
    if (near) {
      const dx = near.x - me.x;
      const dz = near.z - me.z;
      const l = Math.hypot(dx, dz) || 1;
      const keep = near.boss || near.part ? Math.min(style.keep, 2.2) : style.keep;
      let move = {};
      if (nd > keep) move = toward(state, me, near.x, near.z);
      else if (nd < keep - 1.5 && keep > 2) move = { moveX: -dx / l, moveY: dz / l };
      const crowd = state.enemies.filter((e) => !e.untargetable && Math.hypot(e.x - me.x, e.z - me.z) < 2.6).length;
      const special = me.cls === 'huntress' ? nd < 7 : crowd >= 2 || (near.boss && nd < 2.6);
      return { ...move, attack: nd < style.reach, aimX: dx, aimY: -dz, dash, special: special && state.tick % 2 === 0 };
    }

    // 3. Suivre l'allié s'il s'éloigne
    if (mate && isActive(mate) && Math.hypot(mate.x - me.x, mate.z - me.z) > 2.5) return { ...toward(state, me, mate.x, mate.z), dash };
    return { dash };
  };
}
