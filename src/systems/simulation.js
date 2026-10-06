// Un pas de simulation : état(t+1) = simuler(état(t), intention).
// Aucune dépendance au navigateur ni à Three.js : tourne tel quel dans Node
// (tests) et, plus tard, sur un serveur multijoueur.

import { SIM } from './simConfig.js';
import { sanitizeIntent } from './intent.js';
import { updatePlayer, updateDowned } from './player.js';
import { updateEnemies } from './enemies.js';
import { updateProjectiles } from './projectiles.js';
import { tickPoison } from './player.js';
import { updateRooms } from './rooms.js';
import { updateLoot } from './loot.js';
import { updateHazards } from './hazards.js';
import { startDescent, updateDescent } from './descent.js';
import { TILE, tileAt } from '../dungeon/tiles.js';
import { isActive } from '../state/gameState.js';

export const STEP = 1 / SIM.tickRate;

// rawIntents : une intention (solo) ou un tableau d'intentions, une par joueur
export function stepGame(state, rawIntents) {
  state.events = [];
  const list = Array.isArray(rawIntents) ? rawIntents : [rawIntents];
  const intents = state.players.map((_, i) => sanitizeIntent(list[i]));
  // Écran de Charon : seuls les choix sont traités, le donjon est en pause
  if (state.status === 'choosing') {
    updateDescent(state, intents);
    return;
  }
  // Partie terminée (mort ou victoire) : l'état ne bouge plus (l'écran de fin s'affiche)
  if (state.status !== 'playing') return;
  state.tick++;
  state.players.forEach((p, i) => {
    if (isActive(p)) updatePlayer(state, p, intents[i], STEP);
  });
  updateEnemies(state, STEP);
  updateProjectiles(state, STEP);
  tickPoison(state);
  updateHazards(state);
  if (state.players.length > 1) updateDowned(state);
  if (state.status !== 'playing') return;
  updateRooms(state);
  updateLoot(state, STEP);
  checkStairs(state);
}

// Un héros debout sur le centre de l'escalier ouvre l'écran de Charon (puis la descente)
function checkStairs(state) {
  for (const p of state.players) {
    if (!isActive(p)) continue;
    const c = Math.floor(p.x);
    const r = Math.floor(p.z);
    if (tileAt(state.dungeon, c, r) !== TILE.STAIRS) continue;
    const dx = p.x - (c + 0.5);
    const dz = p.z - (r + 0.5);
    if (dx * dx + dz * dz > SIM.stairsRadius * SIM.stairsRadius) continue;
    startDescent(state);
    return;
  }
}
