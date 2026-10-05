// Collisions du joueur (un cercle) contre les cases pleines de la grille.
// Fonctions pures sur des données : réutilisables telles quelles côté serveur.

import { isSolid, tileAt } from '../dungeon/tiles.js';

// Déplace un cercle de (dx, dz) en glissant le long des murs.
// Le mouvement est découpé en petits pas pour ne jamais traverser un mur,
// même à grande vitesse (esquive) ou lors d'un pas de temps exceptionnellement long.
export function moveCircle(dungeon, pos, dx, dz, radius) {
  const maxStep = radius * 0.5;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / maxStep));
  for (let i = 0; i < steps; i++) {
    // Axe par axe : c'est ce qui donne le glissement naturel contre un mur
    pos.x += dx / steps;
    pushOut(dungeon, pos, radius);
    pos.z += dz / steps;
    pushOut(dungeon, pos, radius);
  }
}

// Repousse le cercle hors des cases pleines qu'il chevauche
export function pushOut(dungeon, pos, radius) {
  const c0 = Math.floor(pos.x - radius);
  const c1 = Math.floor(pos.x + radius);
  const r0 = Math.floor(pos.z - radius);
  const r1 = Math.floor(pos.z + radius);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!isSolid(tileAt(dungeon, c, r))) continue;
      // Point de la case le plus proche du centre du cercle
      const nx = clamp(pos.x, c, c + 1);
      const nz = clamp(pos.z, r, r + 1);
      const ddx = pos.x - nx;
      const ddz = pos.z - nz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        pos.x += (ddx / d) * (radius - d);
        pos.z += (ddz / d) * (radius - d);
      } else {
        // Centre à l'intérieur de la case (ne devrait pas arriver) : sortie par le côté le plus proche
        const exits = [
          { d: pos.x - c, x: c - radius, z: pos.z },
          { d: c + 1 - pos.x, x: c + 1 + radius, z: pos.z },
          { d: pos.z - r, x: pos.x, z: r - radius },
          { d: r + 1 - pos.z, x: pos.x, z: r + 1 + radius },
        ];
        exits.sort((a, b) => a.d - b.d);
        pos.x = exits[0].x;
        pos.z = exits[0].z;
      }
    }
  }
}

// Le cercle chevauche-t-il une case pleine ? (utilisé par les tests)
export function overlapsSolid(dungeon, pos, radius, tolerance = 1e-6) {
  const c0 = Math.floor(pos.x - radius);
  const c1 = Math.floor(pos.x + radius);
  const r0 = Math.floor(pos.z - radius);
  const r1 = Math.floor(pos.z + radius);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!isSolid(tileAt(dungeon, c, r))) continue;
      const ddx = pos.x - clamp(pos.x, c, c + 1);
      const ddz = pos.z - clamp(pos.z, r, r + 1);
      const d = Math.sqrt(ddx * ddx + ddz * ddz);
      if (d < radius - tolerance) return true;
    }
  }
  return false;
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
