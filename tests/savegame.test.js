// Tests de la reprise d'une descente (étape 8a) : une partie sauvegardée puis relue
// continue EXACTEMENT comme si elle n'avait jamais été interrompue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, STATE_VERSION } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { serializeRun, parseRun, runSummary } from '../src/state/savegame.js';
import { scriptedIntents, stateHash } from './helpers.js';

const META = {
  attrs: { ares: 10, demeter: 10, hermes: 10, charon: 10 },
  talents: { venom: 2, quiver: 2, linger: 1, swift: 3 },
};

test('sauvegarder puis reprendre ne change rien à la suite de la partie', () => {
  for (const cls of ['warrior', 'huntress', 'mystic']) {
    const intents = scriptedIntents(3000, 4).map((it, i) => ({ ...it, special: i % 83 < 2 }));
    const a = createGameState('reprise', { cls, meta: { ...META, cls } });
    const b = createGameState('reprise', { cls, meta: { ...META, cls } });
    for (let i = 0; i < 1500; i++) {
      stepGame(a, intents[i]);
      stepGame(b, intents[i]);
    }
    // b est "fermé" puis rouvert à partir de sa sauvegarde
    const resumed = parseRun(serializeRun(b));
    assert.ok(resumed, cls);
    for (let i = 1500; i < 3000; i++) {
      stepGame(a, intents[i]);
      stepGame(resumed, intents[i]);
    }
    assert.equal(stateHash(resumed), stateHash(a), cls);
  }
});

test("une sauvegarde abîmée, d'une autre version ou d'une partie finie est refusée", () => {
  const s = createGameState('refus');
  const ok = serializeRun(s);
  assert.ok(parseRun(ok));
  assert.equal(parseRun('pas du json'), null);
  assert.equal(parseRun(null), null);
  assert.equal(parseRun('42'), null);
  assert.equal(parseRun(JSON.stringify({ ...JSON.parse(ok), version: STATE_VERSION - 1 })), null);
  assert.equal(parseRun(JSON.stringify({ ...JSON.parse(ok), status: 'dead' })), null);
  assert.equal(parseRun(JSON.stringify({ ...JSON.parse(ok), status: 'victory' })), null);
  assert.equal(parseRun(JSON.stringify({ ...JSON.parse(ok), dungeon: null })), null);
});

test('la sauvegarde ne garde pas les événements du dernier pas, et résume la partie', () => {
  const s = createGameState('resume', { cls: 'mystic' });
  s.events.push({ type: 'hit' });
  assert.deepEqual(JSON.parse(serializeRun(s)).events, []);
  assert.deepEqual(runSummary(s), { floor: 1, cls: 'mystic', hp: s.player.hp, maxHp: s.player.maxHp, seed: 'resume' });
  // Pendant l'écran de Charon, la partie se reprend aussi
  s.status = 'choosing';
  assert.ok(parseRun(serializeRun(s)));
});
