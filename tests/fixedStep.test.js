// Tests de la boucle à pas fixe : le nombre de pas ne dépend que du temps écoulé,
// pas de la fréquence de l'écran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixedStep } from '../src/core/fixedStep.js';

const STEP = 1 / 60;

function runFrames(frameDt, seconds) {
  const loop = createFixedStep(STEP);
  let ticks = 0;
  const frames = Math.round(seconds / frameDt);
  for (let i = 0; i < frames; i++) loop.advance(frameDt, () => ticks++);
  return ticks;
}

test('même nombre de pas à 30, 60, 120 et 144 Hz', () => {
  // 2 secondes de jeu = 120 pas, à un pas près selon l'arrondi flottant
  for (const hz of [30, 60, 120, 144]) {
    const ticks = runFrames(1 / hz, 2);
    assert.ok(Math.abs(ticks - 120) <= 1, `${hz} Hz -> ${ticks} pas`);
  }
});

test('alpha reste dans [0, 1[', () => {
  const loop = createFixedStep(STEP);
  for (let i = 0; i < 500; i++) {
    const alpha = loop.advance(0.007 + (i % 5) * 0.003, () => {});
    assert.ok(alpha >= 0 && alpha < 1);
  }
});

test('un gros saut de temps est plafonné (pas de gel après un onglet en arrière-plan)', () => {
  const loop = createFixedStep(STEP, 5);
  let ticks = 0;
  loop.advance(10, () => ticks++);
  assert.equal(ticks, 5);
});

test('un dt négatif ou nul ne fait rien', () => {
  const loop = createFixedStep(STEP);
  let ticks = 0;
  loop.advance(-1, () => ticks++);
  loop.advance(0, () => ticks++);
  assert.equal(ticks, 0);
});
