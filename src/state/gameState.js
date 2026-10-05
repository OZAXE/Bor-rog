// État complet d'une partie : uniquement des données simples (nombres, textes,
// tableaux, objets), donc sérialisable en JSON. C'est ce qui permettra plus tard
// d'envoyer l'état par le réseau ou de sauvegarder une partie.

import { createRng } from '../core/rng.js';
import { generateFloor } from '../dungeon/generate.js';

export const STATE_VERSION = 1;

export function createGameState(seed, params) {
  const state = {
    version: STATE_VERSION,
    seed: String(seed),
    tick: 0, // nombre de pas de simulation écoulés (60 par seconde)
    floorIndex: 0, // étage actuel (0 = premier)
    // Générateur de la partie (combats, butin… aux étapes suivantes).
    // La génération des étages a ses propres générateurs dérivés de la graine.
    rng: createRng(`${seed}/partie`),
    dungeon: null,
    player: {
      x: 0,
      z: 0,
      vx: 0, // vitesse (m/s)
      vz: 0,
      facing: 0, // orientation (radians, 0 = vers le bas de l'écran)
    },
  };
  enterFloor(state, 0, params);
  return state;
}

// Génère l'étage demandé et place le joueur au départ
export function enterFloor(state, floorIndex, params) {
  state.floorIndex = floorIndex;
  state.dungeon = generateFloor(state.seed, floorIndex, params);
  const s = state.dungeon.start;
  // Centre de la case de départ
  state.player.x = s.c + 0.5;
  state.player.z = s.r + 0.5;
  state.player.vx = 0;
  state.player.vz = 0;
}
