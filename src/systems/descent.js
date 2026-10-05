// Descente d'étage : en marchant sur l'escalier, la partie se met en pause sur
// l'écran de Charon. Le joueur y choisit 1 bienfait parmi 3, et peut payer en
// oboles un soin ou une relance des propositions. Le choix fait descendre.

import { SIM } from './simConfig.js';
import { shuffle } from '../core/rng.js';
import { availableBoons, takeBoon } from './boons.js';
import { enterFloor } from '../state/gameState.js';
import { metaValue, rankOf } from '../meta/tree.js';

// Pacte de Charon (talent) : au tout début de la partie, choix d'un bienfait sans descendre
export function startPact(state) {
  state.status = 'choosing';
  state.offer = { boons: drawBoons(state), rerolls: 0, free: rankOf(state.player.meta, 'freeReroll'), start: true };
  state.events.push({ type: 'descentOffer', start: true });
}

// Prix chez Charon, Marchandage compris
export function healCost(state) {
  return Math.round(SIM.loot.healCost * (1 - metaValue(state.player.meta, 'haggle')));
}

export function startDescent(state) {
  state.status = 'choosing';
  // free : relances gratuites restantes (Ami du passeur, arbre permanent)
  state.offer = { boons: drawBoons(state), rerolls: 0, free: rankOf(state.player.meta, 'freeReroll') };
  state.events.push({ type: 'descentOffer' });
}

function drawBoons(state) {
  const pool = shuffle(state.rng, availableBoons(state.player));
  // Faveur des dieux (arbre permanent) : un bienfait de plus proposé
  return pool.slice(0, SIM.loot.boonChoices + rankOf(state.player.meta, 'choice4'));
}

export function rerollCost(state) {
  if (state.offer.free > 0) return 0;
  const base = SIM.loot.rerollCost + SIM.loot.rerollCostStep * state.offer.rerolls;
  return Math.round(base * (1 - metaValue(state.player.meta, 'haggle')));
}

// Traite l'intention pendant l'écran de choix (rien d'autre ne bouge)
export function updateDescent(state, intent) {
  const l = SIM.loot;
  const p = state.player;
  if (intent.shop === 'heal' && state.gold >= healCost(state) && p.hp < p.maxHp) {
    state.gold -= healCost(state);
    p.hp = Math.min(p.maxHp, p.hp + l.healAmount);
    state.events.push({ type: 'bought', item: 'heal' });
  } else if (intent.shop === 'reroll' && state.gold >= rerollCost(state)) {
    if (state.offer.free > 0) state.offer.free--;
    else {
      state.gold -= rerollCost(state);
      state.offer.rerolls++;
    }
    state.offer.boons = drawBoons(state);
    state.events.push({ type: 'bought', item: 'reroll' });
  }

  const id = state.offer.boons[intent.choice];
  if (intent.choice >= 0 && state.offer.start) {
    // Pacte de Charon : le bienfait choisi, la partie commence sur place
    if (id) {
      takeBoon(p, id);
      state.events.push({ type: 'boon', id });
    }
    state.offer = null;
    state.status = 'playing';
  } else if (intent.choice >= 0 && id) {
    takeBoon(p, id);
    state.events.push({ type: 'boon', id });
    descend(state);
  } else if (intent.choice >= 0 && state.offer.boons.length === 0) {
    // Tous les bienfaits sont au maximum : on descend sans rien prendre
    descend(state);
  }
}

// Passage à l'étage suivant
function descend(state) {
  const p = state.player;
  state.offer = null;
  state.status = 'playing';
  enterFloor(state, state.floorIndex + 1);
  state.shadows += SIM.shadows.floor;
  state.events.push({ type: 'floor', floor: state.floorIndex });
  // Racines nourricières (arbre permanent) : soin à l'arrivée sur l'étage
  const heal = Math.min(metaValue(p.meta, 'roots'), p.maxHp - p.hp);
  if (heal > 0) {
    p.hp += heal;
    state.events.push({ type: 'heal', amount: heal, x: p.x, z: p.z });
  }
}
