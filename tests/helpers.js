// Outils partagés par les tests (pas un fichier de test : pas de suffixe .test.js)

import { walkDistances } from '../src/dungeon/generate.js';
import { isWalkable, tileAt } from '../src/dungeon/tiles.js';
import { hashString } from '../src/core/rng.js';

// Empreinte d'un état : deux états identiques ont la même empreinte
export function stateHash(state) {
  return hashString(JSON.stringify(state));
}

// "Bot" qui produit l'intention pour se rapprocher d'une case cible en suivant
// le plus court chemin (carte de distances calculée depuis la cible)
export function makePathBot(dungeon, target) {
  const dist = walkDistances(dungeon, target);
  return (player) => {
    const c = Math.floor(player.x);
    const r = Math.floor(player.z);
    const here = dist[r * dungeon.width + c];
    // Choisit la case voisine (4 directions) la plus proche de la cible
    let best = null;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isWalkable(tileAt(dungeon, nc, nr))) continue;
      const d = dist[nr * dungeon.width + nc];
      if (d >= 0 && d < here && (!best || d < best.d)) best = { c: nc, r: nr, d };
    }
    const goal = best ?? { c, r }; // sur la cible : on vise le centre de la case
    const dx = goal.c + 0.5 - player.x;
    const dz = goal.r + 0.5 - player.z;
    const len = Math.hypot(dx, dz) || 1;
    return { moveX: dx / len, moveY: -dz / len };
  };
}

// Suite d'intentions "aléatoires" mais reproductible (pour les tests de rejeu)
export function scriptedIntents(n, salt = 1) {
  const out = [];
  let s = salt;
  for (let i = 0; i < n; i++) {
    // Change de direction toutes les 20 images environ
    if (i % 20 === 0) s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const a = (s / 4294967296) * Math.PI * 2;
    out.push({ moveX: Math.cos(a), moveY: Math.sin(a), aimX: 0, aimY: 0 });
  }
  return out;
}
