// Un pas de simulation : état(t+1) = simuler(état(t), intention).
// Aucune dépendance au navigateur ni à Three.js : tourne tel quel dans Node
// (tests) et, plus tard, sur un serveur multijoueur.

import { SIM } from './simConfig.js';
import { sanitizeIntent } from './intent.js';
import { updatePlayer } from './player.js';
import { updateEnemies } from './enemies.js';
import { updateProjectiles } from './projectiles.js';
import { updateRooms } from './rooms.js';
import { updateLoot } from './loot.js';
import { startDescent, updateDescent } from './descent.js';
import { TILE, tileAt } from '../dungeon/tiles.js';

export const STEP = 1 / SIM.tickRate;

export function stepGame(state, rawIntent) {
  state.events = [];
  const intent = sanitizeIntent(rawIntent);
  // Écran de Charon : seul le choix est traité, le donjon est en pause
  if (state.status === 'choosing') {
    updateDescent(state, intent);
    return;
  }
  // Partie terminée : l'état ne bouge plus (l'écran de fin s'affiche)
  if (state.status !== 'playing') return;
  state.tick++;
  updatePlayer(state, intent, STEP);
  updateEnemies(state, STEP);
  updateProjectiles(state, STEP);
  if (state.status !== 'playing') return;
  updateRooms(state);
  updateLoot(state, STEP);
  checkStairs(state);
}

// Marcher sur le centre de l'escalier ouvre l'écran de Charon (puis la descente)
function checkStairs(state) {
  const p = state.player;
  const c = Math.floor(p.x);
  const r = Math.floor(p.z);
  if (tileAt(state.dungeon, c, r) !== TILE.STAIRS) return;
  const dx = p.x - (c + 0.5);
  const dz = p.z - (r + 0.5);
  if (dx * dx + dz * dz > SIM.stairsRadius * SIM.stairsRadius) return;
  startDescent(state);
}
