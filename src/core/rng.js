// Générateur pseudo-aléatoire déterministe (mulberry32).
//
// Pourquoi pas Math.random() ? Parce qu'on veut que la même graine donne
// exactement la même partie : même donjon, mêmes monstres, mêmes objets.
// C'est indispensable pour tester dans Node, rejouer une partie et, plus tard,
// pour que tous les joueurs d'une partie multijoueur voient le même monde.
//
// L'état du générateur est un simple objet { s } (un entier 32 bits) : il est
// sérialisable en JSON et peut donc être rangé dans l'état du jeu.
// Toutes les fonctions ci-dessous sont pures vis-à-vis de l'extérieur :
// elles ne modifient que l'objet rng qu'on leur passe.

// Crée un générateur à partir d'une graine (entier ou texte)
export function createRng(seed) {
  return { s: normalizeSeed(seed) };
}

// Convertit une graine quelconque en entier 32 bits non signé
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  return hashString(String(seed));
}

// Hachage FNV-1a 32 bits : transforme un texte ("donjon-42") en graine
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Prochain entier 32 bits non signé (cœur de mulberry32)
export function nextUint32(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

// Réel dans [0, 1[
export function nextFloat(rng) {
  return nextUint32(rng) / 4294967296;
}

// Entier dans [min, max] (bornes incluses)
export function nextInt(rng, min, max) {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

// Réel dans [min, max[
export function nextRange(rng, min, max) {
  return min + nextFloat(rng) * (max - min);
}

// Vrai avec la probabilité p (entre 0 et 1)
export function chance(rng, p) {
  return nextFloat(rng) < p;
}

// Élément au hasard d'un tableau non vide
export function pick(rng, array) {
  return array[Math.floor(nextFloat(rng) * array.length)];
}

// Mélange un tableau sur place (Fisher-Yates) et le renvoie
export function shuffle(rng, array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(rng) * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Crée un générateur indépendant dérivé de celui-ci (ex. un par étage),
// pour que la génération d'un étage ne décale pas le tirage des autres
export function fork(rng, label = '') {
  return { s: (nextUint32(rng) ^ hashString(label)) >>> 0 };
}
