// Sauvegarde d'une descente en cours (étape 8a) : l'état complet de la partie est
// déjà de simples données (JSON), générateur aléatoire compris. On le range donc tel
// quel ; à la reprise, la partie continue exactement là où elle s'était arrêtée.
// Fonctions pures (le stockage navigateur est dans src/ui/storage.js).

import { STATE_VERSION } from './gameState.js';

// Texte à ranger. Les événements du dernier pas ne sont pas une mémoire de la partie.
export function serializeRun(state) {
  return JSON.stringify({ ...state, events: [] });
}

// Relit une sauvegarde ; renvoie l'état, ou null si elle est inutilisable
// (abîmée, d'une ancienne version du jeu, ou d'une partie déjà terminée)
export function parseRun(text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    return null;
  }
  if (!s || typeof s !== 'object' || s.version !== STATE_VERSION) return null;
  if (s.status !== 'playing' && s.status !== 'choosing') return null;
  if (!s.player || !s.dungeon || !Array.isArray(s.dungeon.tiles) || !Array.isArray(s.enemies) || !s.rng) return null;
  s.events = [];
  return s;
}

// Résumé affiché pour proposer la reprise
export function runSummary(state) {
  return { floor: state.floorIndex + 1, cls: state.player.cls, hp: state.player.hp, maxHp: state.player.maxHp, seed: state.seed };
}
