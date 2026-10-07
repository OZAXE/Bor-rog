// Règles de synchronisation du profil avec le compte en ligne (étape 8b).
// Fonctions pures (testables dans Node) : le réseau et l'affichage sont dans src/ui/account.js.
//
// Chaque enregistrement en ligne porte un numéro de version (rev). Le navigateur retient
// la dernière version qu'il connaît (`rev`) et s'il a des changements pas encore envoyés
// (`dirty`). Le serveur refuse une écriture basée sur une version dépassée : c'est ce qui
// empêche un appareil d'écraser en silence la progression faite sur un autre.

import { investedShadows, characterLevel } from './profile.js';
import { CLASS_IDS } from '../systems/classes.js';

// Profil « vierge » : jamais joué, rien acheté (rien à perdre en prenant celui du compte)
export function isBlankProfile(p) {
  return p.stats.runs === 0 && p.shadows === 0 && investedShadows(p) === 0;
}

export function sameProfile(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// À la connexion : que faire du profil de cet appareil et de celui du compte ?
// 'push' (le compte est vide : on y envoie celui-ci), 'adopt' (on prend celui du compte),
// 'conflict' (les deux ont de la progression différente : le joueur choisit)
export function loginAction(local, remote) {
  if (!remote) return 'push';
  if (isBlankProfile(local) || sameProfile(local, remote)) return 'adopt';
  return 'conflict';
}

// Relecture du compte (ouverture du jeu) : sync = { rev, dirty } de cet appareil,
// remoteRev / remote = ce que le serveur a. 'none' : rien à faire.
export function refreshAction(sync, remoteRev, remote) {
  if (!remote) return 'push';
  if (remoteRev === sync.rev) return sync.dirty ? 'push' : 'none';
  // Un autre appareil a écrit depuis : sans changement ici, on le suit ; sinon, au joueur de choisir
  return sync.dirty ? 'conflict' : 'adopt';
}

// Résumé lisible d'un profil (écran de choix en cas de conflit)
export function profileSummary(p) {
  // Niveaux gagnés, tous personnages confondus
  const levels = CLASS_IDS.reduce((s, c) => s + characterLevel(p, c), 0);
  return {
    shadows: p.shadows + investedShadows(p), // Ombres au total (dépensées comprises)
    levels,
    runs: p.stats.runs,
    victories: p.stats.victories,
    bestFloor: p.stats.bestFloor,
  };
}
