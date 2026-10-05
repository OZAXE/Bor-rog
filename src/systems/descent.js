// Descente d'étage : en marchant sur l'escalier, la partie se met en pause sur
// l'écran de Charon. Le joueur y choisit 1 bienfait parmi 3, et peut payer en
// oboles un soin ou une relance des propositions. Le choix fait descendre.

import { SIM } from './simConfig.js';
import { shuffle } from '../core/rng.js';
import { availableBoons, takeBoon } from './boons.js';
import { enterFloor } from '../state/gameState.js';

export function startDescent(state) {
  state.status = 'choosing';
  state.offer = { boons: drawBoons(state), rerolls: 0 };
  state.events.push({ type: 'descentOffer' });
}

function drawBoons(state) {
  const pool = shuffle(state.rng, availableBoons(state.player));
  return pool.slice(0, SIM.loot.boonChoices);
}

export function rerollCost(state) {
  return SIM.loot.rerollCost + SIM.loot.rerollCostStep * state.offer.rerolls;
}

// Traite l'intention pendant l'écran de choix (rien d'autre ne bouge)
export function updateDescent(state, intent) {
  const l = SIM.loot;
  const p = state.player;
  if (intent.shop === 'heal' && state.gold >= l.healCost && p.hp < p.maxHp) {
    state.gold -= l.healCost;
    p.hp = Math.min(p.maxHp, p.hp + l.healAmount);
    state.events.push({ type: 'bought', item: 'heal' });
  } else if (intent.shop === 'reroll' && state.gold >= rerollCost(state)) {
    state.gold -= rerollCost(state);
    state.offer.rerolls++;
    state.offer.boons = drawBoons(state);
    state.events.push({ type: 'bought', item: 'reroll' });
  }

  const id = state.offer.boons[intent.choice];
  if (intent.choice >= 0 && id) {
    takeBoon(p, id);
    state.events.push({ type: 'boon', id });
    state.offer = null;
    state.status = 'playing';
    enterFloor(state, state.floorIndex + 1);
    state.events.push({ type: 'floor', floor: state.floorIndex });
  } else if (intent.choice >= 0 && state.offer.boons.length === 0) {
    // Tous les bienfaits sont au maximum : on descend sans rien prendre
    state.offer = null;
    state.status = 'playing';
    enterFloor(state, state.floorIndex + 1);
    state.events.push({ type: 'floor', floor: state.floorIndex });
  }
}
