// Escalier gardé : on ne descend pas tant que la salle de l'escalier n'est pas vide.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createEnemy } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { inRoom } from '../src/systems/rooms.js';

// Héros posé sur l'escalier, étage vidé ; renvoie la salle de l'escalier
function onStairs(seed) {
  const s = createGameState(seed);
  const st = s.dungeon.stairs;
  const room = s.dungeon.rooms.find((r) => st.c >= r.x && st.c < r.x + r.w && st.r >= r.y && st.r < r.y + r.h);
  s.enemies = [];
  room.cleared = true; // salle déjà purifiée
  return { s, room, st };
}
function shadeAt(s, x, z) {
  const e = createEnemy(s, { type: 'shade', x, z });
  e.mode = 'recover';
  e.timer = 99999; // immobile : on teste l'escalier, pas le combat
  s.enemies.push(e);
  return e;
}

test('un ennemi dans la salle de l’escalier bloque la descente ; vaincu, on descend', () => {
  for (const seed of ['esc-1', 'esc-2', 'esc-3']) {
    const { s, room, st } = onStairs(seed);
    const e = shadeAt(s, room.x + 1.5, room.y + 1.5);
    assert.ok(inRoom(room, e.x, e.z));
    Object.assign(s.players[0], { x: st.c + 0.5, z: st.r + 0.5 });
    for (let k = 0; k < 120; k++) stepGame(s, {});
    assert.equal(s.status, 'playing', `${seed} : la descente doit attendre`);
    assert.equal(s.floorIndex, 0);
    e.hp = 0;
    s.enemies = [];
    for (let k = 0; k < 5; k++) stepGame(s, {});
    assert.equal(s.status, 'choosing', `${seed} : salle vide, Charon s'ouvre`);
  }
});

test('ennemi revenu dans une salle purifiée : elle se scelle à nouveau et le joueur est prévenu', () => {
  const { s, room, st } = onStairs('esc-reseau');
  const e = shadeAt(s, room.x + 1.5, room.y + 1.5);
  Object.assign(s.players[0], { x: st.c + 0.5, z: st.r + 0.5 });
  let warned = 0;
  for (let k = 0; k < 130; k++) {
    stepGame(s, {});
    warned += s.events.filter((ev) => ev.type === 'stairsBlocked').length;
  }
  assert.ok(s.lock, 'la salle est scellée');
  assert.equal(s.lock.roomId, room.id);
  assert.deepEqual(s.lock.enemyIds, [e.id]);
  assert.ok(warned >= 1 && warned <= 3, `${warned} rappels en ~2 s (un par seconde au plus)`);
});

test('les ennemis restés ailleurs dans l’étage ne bloquent pas l’escalier', () => {
  const { s, room, st } = onStairs('esc-ailleurs');
  const far = s.dungeon.rooms.find((r) => r !== room && r.type !== 'stairs');
  shadeAt(s, far.x + far.w / 2, far.y + far.h / 2);
  Object.assign(s.players[0], { x: st.c + 0.5, z: st.r + 0.5 });
  for (let k = 0; k < 5; k++) stepGame(s, {});
  assert.equal(s.status, 'choosing');
});
