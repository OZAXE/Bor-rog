// Projectiles : vont tout droit, se brisent sur les murs.
// - Ennemis (flèches, venin) : blessent le héros. Avec le Bouclier du vent (talent),
//   esquiver à travers un projectile le renvoie : il change de camp.
// - Alliés (`friendly`, ou renvoyés) : flèches de la Chasseresse (touchent le premier
//   ennemi, ou en traversent plusieurs avec Fendoir) et orbes de la Mystique (explosent
//   au contact, contre un mur ou en bout de course, et blessent tout autour).

import { SIM, ticks } from './simConfig.js';
import { isSolid, tileAt } from '../dungeon/tiles.js';
import { hurtPlayer, damageEnemy, removeDeadEnemies } from './player.js';
import { playerStats } from './boons.js';
import { nextFloat } from '../core/rng.js';
import { isActive } from '../state/gameState.js';

export function updateProjectiles(state, dt) {
  const hitDist = SIM.player.radius + 0.08;
  // Héros qui a touché un ennemi en dernier (crédité des victimes)
  let enemyHit = null;
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
          if (explode(state, a)) enemyHit = ownerOf(state, a);
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
        const owner = ownerOf(state, a);
        enemyHit = owner;
        if (a.blast) {
          explode(state, a);
          return false;
        }
        const len = Math.hypot(a.vx, a.vz) || 1;
        const st = playerStats(owner);
        let dmg = a.damage ?? st.damage;
        // Tir précis (Chasseresse) : bonus sur une cible touchée à plus de 5 m du tireur
        if (a.kind === 'heroArrow' && st.marksman && Math.hypot(e.x - a.ox, e.z - a.oz) > 5) dmg *= 1 + st.marksman;
        if (damageEnemy(state, e, dmg, { x: a.vx / len, z: a.vz / len }, owner) && a.kind === 'heroArrow' && st.poisonDps) {
          // Flèches empoisonnées : le poison se renouvelle à chaque flèche
          e.poison = ticks(st.poisonTime);
          e.poisonDps = st.poisonDps;
          e.poisonBy = owner.id;
        }
        // Flèche perforante (Fendoir) : continue sa course
        if (a.pierce > 0) {
          a.pierce--;
          a.hit.push(e.id);
          continue;
        }
        return false;
      }
      // Projectile ennemi : touche le premier héros debout sur sa route
      const p = state.players.find((h) => isActive(h) && Math.hypot(a.x - h.x, a.z - h.z) < hitDist);
      if (p) {
        // Esquive en cours + Bouclier du vent : le projectile repart vers l'ennemi
        if (playerStats(p).reflect && p.dashTimer > 0) {
          a.vx = -a.vx;
          a.vz = -a.vz;
          a.reflected = true;
          a.owner = p.id;
          a.damage = playerStats(p).damage;
          a.travelLeft = Math.max(a.travelLeft, 8);
          state.events.push({ type: 'reflect', x: a.x, z: a.z });
          continue;
        }
        // Pendant l'esquive (invulnérable), le projectile passe à travers le héros
        if (p.invuln === 0) {
          hurtPlayer(state, p, a.damage, a.x - a.vx, a.z - a.vz);
          return false;
        }
      }
    }
    a.travelLeft -= total;
    if (a.travelLeft > 0) return true;
    // En bout de course, l'orbe explose quand même
    if (a.blast && explode(state, a)) enemyHit = ownerOf(state, a);
    return false;
  });
  // Après le tri (un boss vaincu vide la liste des projectiles)
  if (enemyHit) removeDeadEnemies(state, enemyHit);
}

// Héros à l'origine d'un projectile allié (tireur, ou héros qui l'a renvoyé)
function ownerOf(state, a) {
  return state.players[a.owner] || state.players[0];
}

// Explosion d'un orbe : blesse tous les ennemis dans le rayon. Renvoie true si quelqu'un est touché.
// depth : génération de la réaction en chaîne (limitée pour rester raisonnable)
function explode(state, a, depth = 0) {
  state.events.push({ type: 'orbBurst', x: a.x, z: a.z, r: a.blast, chain: depth > 0 });
  const owner = ownerOf(state, a);
  const st = playerStats(owner);
  let any = false;
  const killed = [];
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.untargetable) continue;
    const dx = e.x - a.x;
    const dz = e.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d > a.blast + SIM.enemies[e.type].radius) continue;
    // Recul vers l'extérieur de l'explosion
    const dir = d > 1e-6 ? { x: dx / d, z: dz / d } : { x: 0, z: 1 };
    if (!damageEnemy(state, e, a.damage, dir, owner)) continue;
    any = true;
    // Torrent d'âmes (Mystique) : l'explosion ralentit (pas les boss)
    if (st.blastSlow && !e.boss && !e.part) e.slow = Math.max(e.slow || 0, ticks(st.blastSlow));
    if (e.hp <= 0) killed.push(e);
  }
  // Réaction en chaîne (Mystique) : un ennemi tué peut exploser à son tour.
  // Le tirage n'a lieu qu'avec le talent (sinon la partie ne change pas).
  if (st.chain && depth < 3) {
    for (const e of killed) {
      if (nextFloat(state.rng) < st.chain) explode(state, { x: e.x, z: e.z, blast: a.blast, damage: a.damage, owner: owner.id }, depth + 1);
    }
  }
  return any;
}
