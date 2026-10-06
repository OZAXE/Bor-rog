// Descente d'étage : en marchant sur l'escalier, la partie se met en pause sur
// l'écran de Charon. Le joueur y choisit 1 bienfait parmi 3, et peut payer en
// oboles un soin ou une relance des propositions. Le choix fait descendre.

import { SIM } from './simConfig.js';
import { shuffle } from '../core/rng.js';
import { availableBoons, takeBoon } from './boons.js';
import { enterFloor } from '../state/gameState.js';
import { metaValue, rankOf } from '../meta/tree.js';

// Pacte de Charon (talent) : au tout début de la partie, choix d'un bienfait sans descendre
// (seuls les héros qui ont le talent choisissent ; les autres attendent)
export function startPact(state) {
  state.status = 'choosing';
  for (const p of state.players) {
    if (rankOf(p.meta, 'pact')) p.offer = { boons: drawBoons(state, p), rerolls: 0, free: rankOf(p.meta, 'freeReroll'), start: true };
  }
  state.events.push({ type: 'descentOffer', start: true });
}

// Prix chez Charon, Marchandage compris
export function healCost(p) {
  return Math.round(SIM.loot.healCost * (1 - metaValue(p.meta, 'haggle')));
}

// Escalier : chaque héros (même tombé) reçoit son offre ; on descend quand tous ont choisi
export function startDescent(state) {
  state.status = 'choosing';
  // free : relances gratuites restantes (Ami du passeur, arbre permanent)
  for (const p of state.players) p.offer = { boons: drawBoons(state, p), rerolls: 0, free: rankOf(p.meta, 'freeReroll') };
  state.events.push({ type: 'descentOffer' });
}

function drawBoons(state, p) {
  const pool = shuffle(state.rng, availableBoons(p));
  // Faveur des dieux (arbre permanent) : un bienfait de plus proposé
  return pool.slice(0, SIM.loot.boonChoices + rankOf(p.meta, 'choice4'));
}

export function rerollCost(p) {
  if (p.offer.free > 0) return 0;
  const base = SIM.loot.rerollCost + SIM.loot.rerollCostStep * p.offer.rerolls;
  return Math.round(base * (1 - metaValue(p.meta, 'haggle')));
}

// Traite les intentions pendant l'écran de choix (rien d'autre ne bouge).
// intents[i] : intention du joueur i
export function updateDescent(state, intents) {
  let start = false;
  state.players.forEach((p, i) => {
    if (!p.offer) return; // déjà choisi : attend l'autre joueur
    start = start || !!p.offer.start;
    choose(state, p, intents[i]);
  });
  if (state.players.some((p) => p.offer)) return;
  // Tous ont choisi
  if (start) state.status = 'playing'; // Pacte de Charon : la partie commence sur place
  else descend(state);
}

function choose(state, p, intent) {
  const l = SIM.loot;
  const offer = p.offer;
  if (intent.shop === 'heal' && p.gold >= healCost(p) && p.hp < p.maxHp) {
    p.gold -= healCost(p);
    p.hp = Math.min(p.maxHp, p.hp + l.healAmount);
    state.events.push({ type: 'bought', item: 'heal', player: p.id });
  } else if (intent.shop === 'reroll' && p.gold >= rerollCost(p)) {
    if (offer.free > 0) offer.free--;
    else {
      p.gold -= rerollCost(p);
      offer.rerolls++;
    }
    offer.boons = drawBoons(state, p);
    state.events.push({ type: 'bought', item: 'reroll', player: p.id });
  }

  const id = offer.boons[intent.choice];
  if (intent.choice >= 0 && id) {
    takeBoon(p, id);
    state.events.push({ type: 'boon', id, player: p.id });
    p.offer = null;
  } else if (intent.choice >= 0 && (offer.start || offer.boons.length === 0)) {
    // Pacte sans bienfait disponible, ou tous les bienfaits au maximum : on passe
    p.offer = null;
  }
}

// Passage à l'étage suivant
function descend(state) {
  state.status = 'playing';
  enterFloor(state, state.floorIndex + 1);
  state.shadows += SIM.shadows.floor;
  state.events.push({ type: 'floor', floor: state.floorIndex });
  // Racines nourricières (arbre permanent) : soin à l'arrivée sur l'étage
  for (const p of state.players) {
    const heal = Math.min(metaValue(p.meta, 'roots'), p.maxHp - p.hp);
    if (heal > 0) {
      p.hp += heal;
      state.events.push({ type: 'heal', amount: heal, x: p.x, z: p.z, player: p.id });
    }
  }
}
