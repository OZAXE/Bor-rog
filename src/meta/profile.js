// Profil du joueur : ce qui survit d'une partie à l'autre (Ombres, rangs de l'arbre,
// statistiques). Fonctions pures : la lecture/écriture dans le navigateur se fait
// côté client (src/ui/storage.js), ce qui garde ces règles testables dans Node.

import { TREE, NODE_IDS, rankOf, metaValue, cleanRanks } from './tree.js';

export const PROFILE_VERSION = 1;

export function newProfile() {
  return {
    version: PROFILE_VERSION,
    shadows: 0, // Ombres disponibles
    ranks: {}, // rangs achetés : { id: rang }
    stats: { runs: 0, victories: 0, bestFloor: 0, totalShadows: 0 },
  };
}

// Prix du prochain rang, ou null si le nœud est au maximum
export function nextCost(profile, id) {
  const r = rankOf(profile.ranks, id);
  return r < TREE[id].costs.length ? TREE[id].costs[r] : null;
}

// Pourquoi un nœud ne peut pas être acheté ('' = il peut l'être)
export function buyBlocker(profile, id) {
  const node = TREE[id];
  if (!node) return 'inconnu';
  if (node.requires && rankOf(profile.ranks, node.requires) === 0) return 'verrouillé';
  const cost = nextCost(profile, id);
  if (cost === null) return 'maximum';
  if (profile.shadows < cost) return 'trop cher';
  return '';
}

// Achète le rang suivant. Renvoie true si l'achat a eu lieu.
export function buy(profile, id) {
  if (buyBlocker(profile, id)) return false;
  profile.shadows -= nextCost(profile, id);
  profile.ranks[id] = rankOf(profile.ranks, id) + 1;
  return true;
}

// Total des Ombres investies dans l'arbre
export function spentShadows(profile) {
  let total = 0;
  for (const id of NODE_IDS) {
    for (let k = 0; k < rankOf(profile.ranks, id); k++) total += TREE[id].costs[k];
  }
  return total;
}

// Remise à zéro gratuite : toutes les Ombres investies sont rendues
export function refundAll(profile) {
  profile.shadows += spentShadows(profile);
  profile.ranks = {};
}

// Ombres finalement gagnées pour une partie (Dîme des ombres comprise)
export function shadowsEarned(rawShadows, ranks) {
  return Math.floor(rawShadows * (1 + metaValue(ranks, 'tithe')));
}

// Fin de partie (mort, victoire ou abandon) : encaisse les Ombres et met à jour les statistiques.
// state : l'état de la partie terminée (lu, jamais modifié). Renvoie les Ombres gagnées.
export function recordRun(profile, state) {
  const earned = shadowsEarned(state.shadows, profile.ranks);
  profile.shadows += earned;
  const s = profile.stats;
  s.runs++;
  if (state.status === 'victory') s.victories++;
  s.bestFloor = Math.max(s.bestFloor, state.floorIndex + 1);
  s.totalShadows += earned;
  return earned;
}

// Relit un profil venu de l'extérieur (sauvegarde, code d'export) en ne gardant que
// des valeurs valides. Une donnée abîmée ne doit jamais faire planter le jeu.
export function sanitizeProfile(raw) {
  const p = newProfile();
  if (!raw || typeof raw !== 'object') return p;
  p.shadows = count(raw.shadows);
  p.ranks = cleanRanks(raw.ranks);
  const st = raw.stats || {};
  p.stats = {
    runs: count(st.runs),
    victories: count(st.victories),
    bestFloor: count(st.bestFloor),
    totalShadows: count(st.totalShadows),
  };
  return p;
}

function count(v) {
  return Number.isInteger(v) && v > 0 ? v : 0;
}
