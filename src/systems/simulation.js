// Un pas de simulation : état(t+1) = simuler(état(t), intention).
// Aucune dépendance au navigateur ni à Three.js : tourne tel quel dans Node
// (tests) et, plus tard, sur un serveur multijoueur.

import { SIM } from './simConfig.js';
import { sanitizeIntent } from './intent.js';
import { moveCircle } from './collision.js';
import { TILE, tileAt } from '../dungeon/tiles.js';
import { enterFloor } from '../state/gameState.js';

export const STEP = 1 / SIM.tickRate;

export function stepGame(state, rawIntent) {
  const intent = sanitizeIntent(rawIntent);
  state.tick++;
  updatePlayer(state, intent, STEP);
  checkStairs(state);
}

function updatePlayer(state, intent, dt) {
  const p = state.player;
  const cfg = SIM.player;

  // Vitesse visée. Haut de l'écran = z négatif dans le monde.
  const targetVx = intent.moveX * cfg.speed;
  const targetVz = -intent.moveY * cfg.speed;
  const moving = intent.moveX !== 0 || intent.moveY !== 0;
  // Accélération franche au démarrage, freinage encore plus franc :
  // en jeu d'action, le personnage doit répondre tout de suite
  const rate = (moving ? cfg.acceleration : cfg.deceleration) * dt;
  p.vx = approach(p.vx, targetVx, rate);
  p.vz = approach(p.vz, targetVz, rate);

  const before = { x: p.x, z: p.z };
  const pos = { x: p.x, z: p.z };
  moveCircle(state.dungeon, pos, p.vx * dt, p.vz * dt, cfg.radius);
  p.x = pos.x;
  p.z = pos.z;
  // Contre un mur, la vitesse réelle est celle du déplacement effectué :
  // on ne garde pas d'élan "stocké" dans le mur
  p.vx = (p.x - before.x) / dt;
  p.vz = (p.z - before.z) / dt;

  // Orientation : vers la visée si le joueur vise (souris), sinon vers la marche
  if (intent.aimX !== 0 || intent.aimY !== 0) {
    p.facing = Math.atan2(intent.aimX, -intent.aimY);
  } else if (moving) {
    p.facing = Math.atan2(intent.moveX, -intent.moveY);
  }
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
}

function approach(value, target, maxDelta) {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}
