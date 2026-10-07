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
import { inRoom } from './rooms.js';

// Escalier gardé : un ennemi encore debout dans la salle de l'escalier (on ne fuit pas
// un combat en descendant). Renvoie cette salle, ou null. Les ennemis restés ailleurs
// dans l'étage ne comptent pas.
export function stairsGuard(state, c, r) {
  const room = state.dungeon.rooms.find((rm) => c >= rm.x && c < rm.x + rm.w && r >= rm.y && r < rm.y + rm.h);
  if (!room) return null;
  return state.enemies.some((e) => e.hp > 0 && inRoom(room, e.x, e.z)) ? room : null;
}

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

// Un héros debout sur le centre de l'escalier ouvre l'écran de Charon (puis la descente),
// à condition que la salle de l'escalier soit vide d'ennemis
function checkStairs(state) {
  for (const p of state.players) {
    if (!isActive(p)) continue;
    const c = Math.floor(p.x);
    const r = Math.floor(p.z);
    if (tileAt(state.dungeon, c, r) !== TILE.STAIRS) continue;
    const dx = p.x - (c + 0.5);
    const dz = p.z - (r + 0.5);
    if (dx * dx + dz * dz > SIM.stairsRadius * SIM.stairsRadius) continue;
    const guard = stairsGuard(state, c, r);
    if (guard) {
      // Des ennemis sont revenus dans une salle déjà purifiée : elle se scelle à nouveau
      // (grilles, compteur d'ennemis), comme un combat normal, au pas suivant
      if (!state.lock) guard.cleared = false;
      // Rappel au joueur, une fois par seconde tant qu'il attend sur l'escalier
      if (state.tick % SIM.tickRate === 0) state.events.push({ type: 'stairsBlocked', x: p.x, z: p.z, player: p.id });
      return;
    }
    startDescent(state);
    return;
  }
}
