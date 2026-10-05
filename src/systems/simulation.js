// Un pas de simulation : état(t+1) = simuler(état(t), intention).
// Aucune dépendance au navigateur ni à Three.js : tourne tel quel dans Node
// (tests) et, plus tard, sur un serveur multijoueur.

import { SIM } from './simConfig.js';
import { sanitizeIntent } from './intent.js';
import { updatePlayer } from './player.js';
import { updateEnemies } from './enemies.js';
import { updateProjectiles } from './projectiles.js';
import { TILE, tileAt } from '../dungeon/tiles.js';
import { enterFloor } from '../state/gameState.js';

export const STEP = 1 / SIM.tickRate;

export function stepGame(state, rawIntent) {
  state.events = [];
  // Partie terminée : l'état ne bouge plus (l'écran de fin s'affiche)
  if (state.status !== 'playing') return;
  const intent = sanitizeIntent(rawIntent);
  state.tick++;
  updatePlayer(state, intent, STEP);
  updateEnemies(state, STEP);
  updateProjectiles(state, STEP);
  if (state.status === 'playing') checkStairs(state);
}

// Marcher sur le centre de l'escalier fait descendre à l'étage suivant
function checkStairs(state) {
  const p = state.player;
  const c = Math.floor(p.x);
  const r = Math.floor(p.z);
  if (tileAt(state.dungeon, c, r) !== TILE.STAIRS) return;
  const dx = p.x - (c + 0.5);
  const dz = p.z - (r + 0.5);
  if (dx * dx + dz * dz > SIM.stairsRadius * SIM.stairsRadius) return;
  enterFloor(state, state.floorIndex + 1);
  state.events.push({ type: 'floor', floor: state.floorIndex });
}
