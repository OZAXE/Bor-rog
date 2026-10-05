// Petites fonctions géométriques partagées par la simulation (pures).

import { isSolid, tileAt } from '../dungeon/tiles.js';

// Ligne de vue entre deux points : faux si un mur ou un pilier est sur le trajet.
// On échantillonne le segment tous les 0,2 m : simple, déterministe et largement
// assez précis à l'échelle de cases de 1 m.
export function hasLineOfSight(dungeon, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const steps = Math.ceil(Math.hypot(dx, dz) / 0.2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isSolid(tileAt(dungeon, Math.floor(x0 + dx * t), Math.floor(z0 + dz * t)))) return false;
  }
  return true;
}

// Orientation (radians) d'une direction (dx, dz) du monde. 0 = vers le sud (+z).
export function facingOf(dx, dz) {
  return Math.atan2(dx, dz);
}

// Direction unitaire correspondant à une orientation
export function dirOf(facing) {
  return { x: Math.sin(facing), z: Math.cos(facing) };
}

// Écart d'angle absolu entre deux orientations, ramené dans [0, π]
export function angleBetween(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

// Le point (tx, tz) est-il dans le "cône" d'un coup donné depuis (x, z) ?
// range : portée (on y ajoute le rayon de la cible), arc : ouverture totale.
export function inArc(x, z, facing, range, arc, tx, tz, targetRadius = 0) {
  const dx = tx - x;
  const dz = tz - z;
  const dist = Math.hypot(dx, dz);
  if (dist > range + targetRadius) return false;
  if (dist < 0.3) return true; // collé : toujours touché
  return angleBetween(facing, facingOf(dx, dz)) <= arc / 2;
}

// Un corps de rayon "radius" peut-il aller en ligne droite de A à B ? On teste
// la ligne centrale et les deux lignes qui longent ses flancs : une ligne fine
// peut frôler un pilier là où le corps, lui, se cognerait.
export function hasClearPath(dungeon, x0, z0, x1, z1, radius) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  const ox = (-dz / len) * radius;
  const oz = (dx / len) * radius;
  return (
    hasLineOfSight(dungeon, x0, z0, x1, z1) &&
    hasLineOfSight(dungeon, x0 + ox, z0 + oz, x1 + ox, z1 + oz) &&
    hasLineOfSight(dungeon, x0 - ox, z0 - oz, x1 - ox, z1 - oz)
  );
}
