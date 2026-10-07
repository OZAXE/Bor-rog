// Profil du joueur : ce qui survit d'une partie à l'autre (Ombres, niveaux d'attributs,
// talents, statistiques). Fonctions pures : la lecture/écriture dans le navigateur se
// fait côté client (src/ui/storage.js), ce qui garde ces règles testables dans Node.

import {
  ATTR_IDS,
  ATTR_MAX,
  ATTR_COSTS,
  TALENT_IDS,
  attrLevel,
  attrValue,
  metaValue,
  rankOf,
  cleanMeta,
  talentBlocker,
  talentPoints,
  pointsSpent,
} from './tree.js';
import { CLASSES, CLASS_IDS, classOf } from '../systems/classes.js';

// Version 4 : un personnage par classe, chacun avec ses niveaux et ses talents
// (version 3 : classes à attributs communs ; 2 : attributs + talents ; 1 : arbre simple)
export const PROFILE_VERSION = 4;
const BOSS_IDS = ['cerberus', 'hydra', 'thanatos'];

// Chaque classe est un personnage qu'on fait progresser : ses niveaux d'attributs et ses
// talents lui sont propres. Les Ombres (monnaie) et les statistiques sont communes.
// attrs / talents : le personnage choisi (cls) ; characters : les autres, rangés.
export function newProfile() {
  return {
    version: PROFILE_VERSION,
    shadows: 0, // Ombres disponibles (communes à tous les personnages)
    attrs: freshAttrs(), // niveaux d'attributs du personnage choisi (1 à 10)
    cls: 'warrior', // personnage (classe) choisi
    talents: {}, // talents du personnage choisi : { id: rang }
    characters: {}, // les autres personnages : { classe: { attrs, talents } }
    stats: { runs: 0, victories: 0, bestFloor: 0, totalShadows: 0, bosses: newBossCount() },
  };
}

function freshAttrs() {
  return Object.fromEntries(ATTR_IDS.map((id) => [id, 1]));
}

// Personnage d'une classe (le choisi ou un rangé) : { attrs, talents } (lecture seule)
export function characterOf(profile, cls) {
  if (cls === profile.cls) return { attrs: profile.attrs, talents: profile.talents };
  return profile.characters[cls] || { attrs: freshAttrs(), talents: {} };
}

// Niveaux gagnés par un personnage (0 au départ, 36 tout au maximum)
export function characterLevel(profile, cls) {
  const { attrs } = characterOf(profile, cls);
  return ATTR_IDS.reduce((sum, id) => sum + attrLevel({ attrs }, id) - 1, 0);
}

function newBossCount() {
  return Object.fromEntries(BOSS_IDS.map((b) => [b, 0]));
}

// ---------- Classes ----------

// Une classe est disponible si elle n'a pas de boss à vaincre (aujourd'hui : toutes),
// ou si ce boss a été vaincu au moins une fois
export function classUnlocked(profile, cls) {
  const boss = CLASSES[cls] && CLASSES[cls].unlockBoss;
  if (CLASSES[cls] === undefined) return false;
  return !boss || profile.stats.bosses[boss] > 0;
}

// Change de personnage : l'ancien est rangé (niveaux et talents), le nouveau ressorti
export function selectClass(profile, cls) {
  if (!classUnlocked(profile, cls) || cls === profile.cls) return false;
  profile.characters[profile.cls] = { attrs: profile.attrs, talents: profile.talents };
  const next = characterOf(profile, cls);
  profile.attrs = next.attrs;
  profile.talents = next.talents;
  delete profile.characters[cls];
  profile.cls = cls;
  return true;
}

// Ce que la partie reçoit du profil (copie : la partie ne touche jamais au profil)
export function metaOf(profile) {
  return { attrs: { ...profile.attrs }, talents: { ...profile.talents }, cls: profile.cls };
}

// ---------- Attributs ----------

// Prix du prochain niveau, ou null au niveau maximum
export function levelCost(profile, attr) {
  const lvl = attrLevel(profile, attr);
  return lvl < ATTR_MAX ? ATTR_COSTS[lvl - 1] : null;
}

export function levelBlocker(profile, attr) {
  const cost = levelCost(profile, attr);
  if (cost === null) return 'maximum';
  if (profile.shadows < cost) return 'trop cher';
  return '';
}

// Monte un attribut d'un niveau (donne aussi un point de talent). Renvoie true si c'est fait.
export function buyLevel(profile, attr) {
  if (levelBlocker(profile, attr)) return false;
  profile.shadows -= levelCost(profile, attr);
  profile.attrs[attr] = attrLevel(profile, attr) + 1;
  return true;
}

// ---------- Talents ----------

export function freePoints(profile) {
  return talentPoints(profile.attrs) - spentPoints(profile);
}

export function spentPoints(profile) {
  return pointsSpent(profile);
}

// Prend un rang de talent (1 à 3 points selon le palier). Renvoie true si c'est fait.
export function learn(profile, id) {
  if (talentBlocker(profile, id)) return false;
  profile.talents[id] = rankOf(profile, id) + 1;
  return true;
}

// Remise à zéro gratuite des talents (les niveaux d'attributs restent acquis)
export function resetTalents(profile) {
  profile.talents = {};
}

// ---------- Fin de partie ----------

// Ombres finalement gagnées pour une partie (Dîme des ombres et attribut Charon compris)
export function shadowsEarned(rawShadows, meta) {
  return Math.floor(rawShadows * (1 + metaValue(meta, 'tithe') + attrValue(meta, 'charon')));
}

// Fin de partie (mort, victoire ou abandon) : encaisse les Ombres et met à jour les statistiques.
// state : l'état de la partie terminée (lu, jamais modifié). Renvoie les Ombres gagnées.
export function recordRun(profile, state) {
  const earned = shadowsEarned(state.shadows, profile);
  profile.shadows += earned;
  const s = profile.stats;
  s.runs++;
  if (state.status === 'victory') s.victories++;
  for (const b of state.bossesDefeated || []) if (b in s.bosses) s.bosses[b]++;
  s.bestFloor = Math.max(s.bestFloor, state.floorIndex + 1);
  s.totalShadows += earned;
  return earned;
}

// Total des Ombres investies dans les attributs, tous personnages confondus
export function investedShadows(profile) {
  let total = 0;
  for (const cls of CLASS_IDS) {
    const { attrs } = characterOf(profile, cls);
    for (const id of ATTR_IDS) for (let l = 1; l < attrLevel({ attrs }, id); l++) total += ATTR_COSTS[l - 1];
  }
  return total;
}

// ---------- Relecture d'un profil venu de l'extérieur ----------

// Prix de l'ancien arbre (version 1), pour rembourser les sauvegardes d'avant la refonte
const V1_COSTS = {
  blade: [60], swift: [40, 100], crit: [80, 180],
  vigor: [20, 45, 80], roots: [40, 90], defiance: [150, 300],
  fleet: [20, 50], doubleDash: [100], reflect: [150],
  purse: [15, 30, 50], tithe: [40, 80, 140], choice4: [120], freeReroll: [100],
};

// Relit un profil (sauvegarde, code d'export) en ne gardant que des valeurs valides.
// Une donnée abîmée ne doit jamais faire planter le jeu. Un profil de version 1
// est converti : toutes les Ombres investies dans l'ancien arbre sont rendues.
export function sanitizeProfile(raw) {
  const p = newProfile();
  if (!raw || typeof raw !== 'object') return p;
  p.shadows = count(raw.shadows);
  if (raw.version === 1 || (raw.ranks && !raw.attrs)) {
    p.shadows += refundV1(raw.ranks);
  } else {
    // Le personnage choisi (talents de classe compris), validé par les règles
    const meta = cleanMeta({ attrs: raw.attrs, talents: raw.talents, cls: classOf(raw.cls) });
    p.attrs = meta.attrs;
    p.talents = meta.talents;
    // Les autres personnages. Avant la version 4, les niveaux étaient communs à toutes les
    // classes : chacune les garde (personne ne perd rien), avec son build rangé (builds).
    const chars = raw.characters && typeof raw.characters === 'object' ? raw.characters : {};
    const builds = raw.builds && typeof raw.builds === 'object' ? raw.builds : {};
    for (const c of CLASS_IDS) {
      const old = (raw.version ?? 0) < 4;
      const src = old ? { attrs: raw.attrs, talents: builds[c] } : chars[c];
      if (!src || typeof src !== 'object') continue;
      const m = cleanMeta({ attrs: src.attrs, talents: src.talents, cls: c });
      // Un personnage jamais monté n'est pas rangé (forme unique d'un profil neuf)
      const blank = ATTR_IDS.every((id) => m.attrs[id] === 1) && Object.keys(m.talents).length === 0;
      if (!blank) p.characters[c] = { attrs: m.attrs, talents: m.talents };
    }
  }
  const st = raw.stats || {};
  p.stats = {
    runs: count(st.runs),
    victories: count(st.victories),
    bestFloor: count(st.bestFloor),
    totalShadows: count(st.totalShadows),
    bosses: newBossCount(),
  };
  const bosses = st.bosses && typeof st.bosses === 'object' ? st.bosses : {};
  for (const b of BOSS_IDS) p.stats.bosses[b] = count(bosses[b]);
  // Profils d'avant les classes : un boss est réputé vaincu si l'étage suivant a été atteint
  if (!st.bosses) {
    if (p.stats.bestFloor >= 4) p.stats.bosses.cerberus = 1;
    if (p.stats.bestFloor >= 7) p.stats.bosses.hydra = 1;
    if (p.stats.victories > 0) p.stats.bosses.thanatos = p.stats.victories;
  }
  // Classe choisie (les talents actifs sont les siens). Si elle n'est pas débloquée
  // (code trafiqué), son build est rangé et on revient au Guerrier.
  const cls = classOf(raw.cls);
  if (classUnlocked(p, cls)) p.cls = cls;
  else {
    p.characters[cls] = { attrs: p.attrs, talents: p.talents };
    const w = characterOf(p, 'warrior');
    p.attrs = w.attrs;
    p.talents = w.talents;
  }
  delete p.characters[p.cls];
  return p;
}

function refundV1(ranks) {
  let total = 0;
  if (!ranks || typeof ranks !== 'object') return 0;
  for (const [id, costs] of Object.entries(V1_COSTS)) {
    const r = ranks[id];
    if (!Number.isInteger(r) || r <= 0) continue;
    for (let k = 0; k < Math.min(r, costs.length); k++) total += costs[k];
  }
  return total;
}

function count(v) {
  return Number.isInteger(v) && v > 0 ? v : 0;
}

