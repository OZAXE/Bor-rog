// Tests des collisions joueur / murs, sur de vrais étages générés.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor } from '../src/dungeon/generate.js';
import { moveCircle, overlapsSolid } from '../src/systems/collision.js';
import { TILE, tileAt } from '../src/dungeon/tiles.js';
import { createRng, nextFloat } from '../src/core/rng.js';

const R = 0.35;

test('on ne rentre jamais dans un mur, même en fonçant dans tous les sens', () => {
  const rng = createRng(3);
  for (let s = 0; s < 20; s++) {
    const d = generateFloor(`mur-${s}`, 0);
    const pos = { x: d.start.c + 0.5, z: d.start.r + 0.5 };
    for (let i = 0; i < 3000; i++) {
      const a = nextFloat(rng) * Math.PI * 2;
      // jusqu'à 0,5 m par pas = 30 m/s : bien plus que la vitesse de marche
      const len = nextFloat(rng) * 0.5;
      moveCircle(d, pos, Math.cos(a) * len, Math.sin(a) * len, R);
      assert.ok(!overlapsSolid(d, pos, R), `graine mur-${s}, pas ${i} : dans un mur en ${pos.x},${pos.z}`);
    }
  }
});

test('un très grand déplacement ne traverse pas un mur (pas de "tunnel")', () => {
  // Couloir fermé à droite : sol de c=1 à c=3, mur en c=4
  const d = {
    width: 6,
    height: 3,
    tiles: [
      2, 2, 2, 2, 2, 2,
      2, 1, 1, 1, 2, 1,
      2, 2, 2, 2, 2, 2,
    ],
  };
  const pos = { x: 1.5, z: 1.5 };
  moveCircle(d, pos, 10, 0, R);
  assert.ok(pos.x <= 4 - R + 1e-9, `traversé : x = ${pos.x}`);
  assert.ok(pos.x > 3.5, 'aurait dû avancer jusqu\'au mur');
});

test('on glisse le long d\'un mur au lieu de rester collé', () => {
  // Grande salle ouverte avec un mur au nord (r = 0)
  const w = 8;
  const tiles = new Array(w * 5).fill(TILE.FLOOR);
  for (let c = 0; c < w; c++) tiles[c] = TILE.WALL;
  const d = { width: w, height: 5, tiles };
  const pos = { x: 2, z: 1 + R };
  // On pousse en diagonale vers le mur : on doit quand même avancer en x
  for (let i = 0; i < 30; i++) moveCircle(d, pos, 0.05, -0.05, R);
  assert.ok(pos.x > 3.4, `pas de glissement : x = ${pos.x}`);
  assert.ok(Math.abs(pos.z - (1 + R)) < 1e-6, 'doit rester plaqué contre le mur');
});

test('les piliers bloquent', () => {
  const tiles = new Array(25).fill(TILE.FLOOR);
  tiles[2 * 5 + 2] = TILE.PILLAR;
  const d = { width: 5, height: 5, tiles };
  const pos = { x: 0.5, z: 2.5 };
  moveCircle(d, pos, 3, 0, R);
  assert.ok(pos.x <= 2 - R + 1e-9, `traverse le pilier : x = ${pos.x}`);
  assert.equal(tileAt(d, Math.floor(pos.x), 2), TILE.FLOOR);
});
