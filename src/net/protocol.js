// Protocole du jeu en ligne (étape 8d), partagé par le serveur et le navigateur.
// Fonctions pures (testables dans Node) : aucune connexion réseau ici.
//
// Principe : le SERVEUR fait tourner la simulation (il fait autorité). Les joueurs
// lui envoient leurs intentions ; il leur renvoie l'état du jeu 20 fois par seconde
// (« instantanés »). Le décor d'un étage (le plus gros) n'est envoyé qu'une fois.
//
// Messages joueur -> serveur :
//   { t: 'create', name, cls, meta }       créer un salon
//   { t: 'join', code, name, cls, meta }   rejoindre un salon avec son code
//   { t: 'start' }                         lancer la descente (créateur du salon)
//   { t: 'in', s, l }                      intentions : s = numéro de la première, l = liste compacte
//   { t: 'act', choice, shop }             écran de Charon : choix d'un bienfait, achat
//   { t: 'rejoin', code, token }           revenir dans la partie après une coupure
//   { t: 'leave' }                         quitter le salon ou la partie
// Messages serveur -> joueur :
//   { t: 'lobby', code, you, host, players: [{ name, cls }], token }
//   { t: 'start', you, fixed, snap }       début de partie (ou retour après coupure)
//   { t: 'floor', fixed }                  nouvel étage (décor)
//   { t: 'snap', ...instantané, ack, ev }  état du jeu ; ack = dernière intention traitée
//   { t: 'left', name }                    l'allié a quitté la partie
//   { t: 'error', message }

import { TILE } from '../dungeon/tiles.js';

export const ROOM_CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // sans I, L, O (confondus avec 1 et 0)
export const SNAPSHOT_EVERY = 3; // un instantané tous les 3 pas (20 par seconde)

// ---------- Intentions (une par pas, envoyées par paquets) ----------

const r3 = (v) => Math.round(v * 1000) / 1000;

// Forme compacte : [moveX, moveY, aimX, aimY, boutons] (boutons : 1 frapper, 2 esquiver, 4 capacité)
export function packIntent(i) {
  return [r3(i.moveX || 0), r3(i.moveY || 0), r3(i.aimX || 0), r3(i.aimY || 0), (i.attack ? 1 : 0) | (i.dash ? 2 : 0) | (i.special ? 4 : 0)];
}

export function unpackIntent(a) {
  if (!Array.isArray(a)) return {};
  const b = Number.isInteger(a[4]) ? a[4] : 0;
  return { moveX: a[0], moveY: a[1], aimX: a[2], aimY: a[3], attack: (b & 1) > 0, dash: (b & 2) > 0, special: (b & 4) > 0 };
}

// ---------- Instantanés ----------

// Envoi en JSON avec des nombres arrondis au millimètre (plus court, et se compresse mieux)
export function encode(obj) {
  return JSON.stringify(obj, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? r3(v) : v));
}

// Partie fixe d'un étage : graine, décor, et ce qui ne change pas des héros (améliorations)
export function fixedOf(state) {
  return {
    seed: state.seed,
    version: state.version,
    floorIndex: state.floorIndex,
    dungeon: state.dungeon,
    metas: state.players.map((p) => p.meta),
  };
}

// Ce qui bouge : tout l'état sauf le décor, le générateur aléatoire et les améliorations
export function snapshotOf(state) {
  return {
    tick: state.tick,
    status: state.status,
    floorIndex: state.floorIndex,
    kills: state.kills,
    shadows: state.shadows,
    bossesDefeated: state.bossesDefeated,
    lock: state.lock,
    players: state.players.map(({ meta, ...rest }) => rest),
    enemies: state.enemies,
    projectiles: state.projectiles,
    pickups: state.pickups,
    hazards: state.hazards,
    chests: state.chests,
  };
}

// Reconstitue, côté navigateur, un état de même forme que celui de la simulation
// (le rendu et l'interface le lisent comme en solo). fixed : dernier décor reçu.
export function stateFromSnapshot(fixed, snap) {
  const dungeon = { ...fixed.dungeon, tiles: fixed.dungeon.tiles.slice() };
  // Grilles d'une salle verrouillée : posées sur le décor (collisions de la prédiction, rendu)
  if (snap.lock) for (const d of snap.lock.doors) dungeon.tiles[d.r * dungeon.width + d.c] = TILE.GATE;
  return {
    version: fixed.version,
    seed: fixed.seed,
    options: { enemies: true, dungeonParams: null },
    tick: snap.tick,
    status: snap.status,
    floorIndex: snap.floorIndex,
    kills: snap.kills,
    shadows: snap.shadows,
    bossesDefeated: snap.bossesDefeated,
    rng: { s: 0 },
    nextId: 0,
    dungeon,
    players: snap.players.map((p, i) => ({ ...p, meta: fixed.metas[i] })),
    enemies: snap.enemies,
    projectiles: snap.projectiles,
    lock: snap.lock,
    pickups: snap.pickups,
    hazards: snap.hazards,
    chests: snap.chests,
    events: [],
  };
}

// Code de salon : 4 lettres. random() renvoie un nombre dans [0, 1[
export function roomCode(random) {
  let c = '';
  for (let k = 0; k < 4; k++) c += ROOM_CODE_LETTERS[Math.floor(random() * ROOM_CODE_LETTERS.length)];
  return c;
}

// Pseudo affiché dans le salon : nettoyé et raccourci
export function cleanPlayerName(name) {
  const n = typeof name === 'string' ? name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 20) : '';
  return n || 'Invité';
}
