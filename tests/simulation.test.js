// Tests de la simulation complète : déterminisme, rejeu, et parcours réel
// d'un étage par un "bot" soumis aux mêmes règles que le joueur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { sanitizeIntent } from '../src/systems/intent.js';
import { SIM } from '../src/systems/simConfig.js';
import { overlapsSolid } from '../src/systems/collision.js';
import { stateHash, makePathBot, scriptedIntents } from './helpers.js';

function play(seed, intents) {
  const state = createGameState(seed);
  for (const intent of intents) stepGame(state, intent);
  return state;
}

test('rejeu : même graine + mêmes intentions = même état final', () => {
  const intents = scriptedIntents(3000, 7);
  assert.equal(stateHash(play('rejeu', intents)), stateHash(play('rejeu', intents)));
});

test('des intentions différentes donnent une partie différente', () => {
  const a = play('rejeu', scriptedIntents(600, 1));
  const b = play('rejeu', scriptedIntents(600, 2));
  assert.notEqual(stateHash(a), stateHash(b));
});

test("sauvegarde en JSON au milieu d'une partie puis reprise = même résultat", () => {
  const intents = scriptedIntents(2000, 3);
  const direct = play('sauvegarde', intents);

  const first = play('sauvegarde', intents.slice(0, 1000));
  const restored = JSON.parse(JSON.stringify(first));
  for (const intent of intents.slice(1000)) stepGame(restored, intent);

  assert.equal(stateHash(restored), stateHash(direct));
});

test('intentions invalides (réseau, bug de contrôle) nettoyées sans planter', () => {
  const state = createGameState('robuste');
  for (const bad of [null, undefined, {}, { moveX: NaN, moveY: Infinity }, { moveX: '1' }]) {
    stepGame(state, bad);
  }
  assert.ok(Number.isFinite(state.players[0].x) && Number.isFinite(state.players[0].z));
  // La diagonale n'est pas plus rapide que la ligne droite
  const i = sanitizeIntent({ moveX: 1, moveY: 1 });
  assert.ok(Math.abs(Math.hypot(i.moveX, i.moveY) - 1) < 1e-12);
});

test('vitesse de marche respectée et arrêt net quand on lâche', () => {
  const state = createGameState('vitesse');
  // Une demi-seconde vers la droite (on peut toucher un mur : on vérifie juste le plafond)
  for (let i = 0; i < 30; i++) stepGame(state, { moveX: 1, moveY: 0 });
  assert.ok(Math.hypot(state.players[0].vx, state.players[0].vz) <= SIM.player.speed + 1e-9);
  // 0,15 s sans intention : arrêt complet
  for (let i = 0; i < 9; i++) stepGame(state, {});
  assert.equal(Math.hypot(state.players[0].vx, state.players[0].vz), 0);
});

test("un bot va du départ à l'escalier et descend, sur 25 graines", () => {
  for (let s = 0; s < 25; s++) {
    const state = createGameState(`bot-${s}`, { enemies: false });
    const bot = makePathBot(state.dungeon, state.dungeon.stairs);
    const maxTicks = 60 * 90; // 90 secondes de jeu maximum
    let t = 0;
    while (state.floorIndex === 0 && t < maxTicks) {
      // Sur l'escalier, l'écran de Charon s'ouvre : on prend le premier bienfait
      stepGame(state, state.status === 'choosing' ? { choice: 0 } : bot(state.players[0]));
      assert.ok(!overlapsSolid(state.dungeon, state.players[0], SIM.player.radius), `bot-${s} dans un mur`);
      t++;
    }
    assert.equal(state.floorIndex, 1, `bot-${s} : escalier non atteint en ${t} pas`);
    // Nouvel étage : joueur replacé au départ
    const st = state.dungeon.start;
    assert.equal(state.players[0].x, st.c + 0.5);
    assert.equal(state.players[0].z, st.r + 0.5);
  }
});
