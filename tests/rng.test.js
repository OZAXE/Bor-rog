// Tests du générateur pseudo-aléatoire : c'est la fondation du déterminisme.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng,
  nextUint32,
  nextFloat,
  nextInt,
  pick,
  shuffle,
  fork,
  hashString,
} from '../src/core/rng.js';

const draw = (rng, n) => Array.from({ length: n }, () => nextUint32(rng));

test('même graine = même suite de nombres', () => {
  assert.deepEqual(draw(createRng(42), 100), draw(createRng(42), 100));
  assert.deepEqual(draw(createRng('donjon'), 50), draw(createRng('donjon'), 50));
});

test('graines différentes = suites différentes', () => {
  assert.notDeepEqual(draw(createRng(1), 20), draw(createRng(2), 20));
});

test("l'état est sérialisable : on peut reprendre une suite après JSON", () => {
  const a = createRng(7);
  draw(a, 13);
  const b = JSON.parse(JSON.stringify(a));
  assert.deepEqual(draw(a, 30), draw(b, 30));
});

test('valeur de référence figée (détecte tout changement de l\'algorithme)', () => {
  // 2693262067 / 2^32 = 0.6270739… : valeur publiée de mulberry32 pour la graine 1
  // Si ce test casse, toutes les graines partagées donneraient un autre donjon
  assert.deepEqual(draw(createRng(1), 3), [2693262067, 11749833, 2265367787]);
});

test('nextFloat reste dans [0, 1[ et nextInt dans ses bornes', () => {
  const rng = createRng(99);
  const seen = new Set();
  for (let i = 0; i < 10000; i++) {
    const f = nextFloat(rng);
    assert.ok(f >= 0 && f < 1);
    const n = nextInt(rng, -2, 3);
    assert.ok(n >= -2 && n <= 3 && Number.isInteger(n));
    seen.add(n);
  }
  assert.equal(seen.size, 6, 'toutes les valeurs de -2 à 3 doivent sortir');
});

test('distribution à peu près uniforme', () => {
  const rng = createRng(2024);
  const buckets = new Array(10).fill(0);
  const n = 50000;
  for (let i = 0; i < n; i++) buckets[Math.floor(nextFloat(rng) * 10)]++;
  for (const b of buckets) assert.ok(Math.abs(b - n / 10) < n / 100, `case ${b}`);
});

test('pick et shuffle sont déterministes', () => {
  const items = ['slime', 'squelette', 'rat', 'chauve-souris'];
  assert.equal(pick(createRng(5), items), pick(createRng(5), items));
  assert.deepEqual(shuffle(createRng(5), [...items]), shuffle(createRng(5), [...items]));
  assert.deepEqual([...shuffle(createRng(5), [...items])].sort(), [...items].sort());
});

test('fork : sous-générateur reproductible et différent du parent', () => {
  const a = fork(createRng(10), 'etage-1');
  const b = fork(createRng(10), 'etage-1');
  const c = fork(createRng(10), 'etage-2');
  assert.deepEqual(draw(a, 10), draw(b, 10));
  assert.notDeepEqual(draw(fork(createRng(10), 'etage-1'), 10), draw(c, 10));
});

test('hashString : texte -> entier 32 bits stable', () => {
  assert.equal(hashString('a'), hashString('a'));
  assert.notEqual(hashString('a'), hashString('b'));
  assert.ok(Number.isInteger(hashString('xyz')) && hashString('xyz') >= 0);
});
