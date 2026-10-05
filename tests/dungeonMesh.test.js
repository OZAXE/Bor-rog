// Tests du maillage du décor : on vérifie que le constructeur produit une géométrie
// valide et sans faces inutiles, sur de vrais étages générés.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor } from '../src/dungeon/generate.js';
import { TILE, isLowWall, tileAt } from '../src/dungeon/tiles.js';
import { buildDungeonMesh, DEFAULT_MESH_OPTIONS } from '../src/render/dungeonMesh.js';

const floors = Array.from({ length: 30 }, (_, i) => generateFloor(`maillage-${i}`, i % 3));
const meshes = floors.map((d) => buildDungeonMesh(d, { debug: true }));

test('une dalle par case de sol (et sous chaque pilier), aucune sous l\'escalier', () => {
  for (const [i, d] of floors.entries()) {
    const expected = d.tiles.filter((t) => t === TILE.FLOOR || t === TILE.PILLAR).length;
    assert.equal(meshes[i].stats.floorQuads, expected);
    const s = d.stairs;
    assert.ok(!meshes[i].faces.some((f) => f.kind === 'floor' && f.c === s.c && f.r === s.r));
  }
});

test('un dessus par mur', () => {
  for (const [i, d] of floors.entries()) {
    assert.equal(meshes[i].stats.wallTops, d.tiles.filter((t) => t === TILE.WALL).length);
  }
});

test('faces de murs : seulement sud/est, seulement là où le voisin est plus bas', () => {
  const { tallHeight, lowHeight } = DEFAULT_MESH_OPTIONS;
  const h = (d, c, r) =>
    tileAt(d, c, r) !== TILE.WALL ? 0 : isLowWall(d, c, r) ? lowHeight : tallHeight;
  for (const [i, d] of floors.entries()) {
    for (const f of meshes[i].faces) {
      if (f.kind === 'floor') continue;
      assert.ok(f.kind === 'south' || f.kind === 'east', f.kind);
      const [dc, dr] = f.kind === 'south' ? [0, 1] : [1, 0];
      const neighbour = h(d, f.c + dc, f.r + dr);
      assert.equal(f.y0, neighbour, 'la face doit partir du haut du voisin');
      assert.equal(f.y1, h(d, f.c, f.r));
      assert.ok(f.y1 > f.y0, 'face inutile entre deux murs de même hauteur');
    }
  }
});

test('murs abaissés exactement là où la règle isLowWall le demande', () => {
  for (const [i, d] of floors.entries()) {
    for (const f of meshes[i].faces) {
      if (f.kind === 'floor') continue;
      const expected = isLowWall(d, f.c, f.r) ? DEFAULT_MESH_OPTIONS.lowHeight : DEFAULT_MESH_OPTIONS.tallHeight;
      assert.equal(f.y1, expected);
    }
  }
});

test('les murs du fond restent hauts, ceux côté caméra sont bas', () => {
  // Salle 3 × 3 entourée de murs : le mur nord (fond) et le mur ouest (fond) sont hauts,
  // le mur sud et le mur est (côté caméra) sont bas
  const W = 5;
  const tiles = new Array(W * W).fill(TILE.WALL);
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) tiles[r * W + c] = TILE.FLOOR;
  const d = { width: W, height: W, tiles, decor: [] };
  assert.equal(isLowWall(d, 2, 0), false, 'mur nord');
  assert.equal(isLowWall(d, 0, 2), false, 'mur ouest');
  assert.equal(isLowWall(d, 2, 4), true, 'mur sud');
  assert.equal(isLowWall(d, 4, 2), true, 'mur est');
  // Sur de vrais étages, il y a beaucoup de murs hauts (pas tous abaissés)
  for (const d2 of floors) {
    const walls = [];
    for (let k = 0; k < d2.tiles.length; k++) if (d2.tiles[k] === TILE.WALL) walls.push(k);
    const low = walls.filter((k) => isLowWall(d2, k % d2.width, Math.floor(k / d2.width))).length;
    assert.ok(low / walls.length < 0.6, `${Math.round((100 * low) / walls.length)} % de murs bas`);
  }
});

test('géométrie valide : tailles cohérentes, indices, UV, normales et couleurs', () => {
  for (const m of meshes) {
    const n = m.positions.length / 3;
    assert.equal(m.normals.length, n * 3);
    assert.equal(m.colors.length, n * 3);
    assert.equal(m.uvs.length, n * 2);
    assert.equal(m.indices.length % 3, 0);
    for (const i of m.indices) assert.ok(i < n);
    for (const v of m.uvs) assert.ok(v >= 0 && v <= 1, `UV hors atlas : ${v}`);
    for (const v of m.colors) assert.ok(Number.isFinite(v) && v >= 0, `couleur ${v}`);
    for (let k = 0; k < n; k++) {
      const len = Math.hypot(m.normals[k * 3], m.normals[k * 3 + 1], m.normals[k * 3 + 2]);
      assert.ok(Math.abs(len - 1) < 1e-6);
    }
  }
});

test('triangles orientés vers leur normale (sinon ils seraient invisibles)', () => {
  const m = meshes[0];
  const P = (i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  for (let k = 0; k < m.indices.length; k += 3) {
    const [a, b, c] = [P(m.indices[k]), P(m.indices[k + 1]), P(m.indices[k + 2])];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const ni = m.indices[k] * 3;
    const dot = cross[0] * m.normals[ni] + cross[1] * m.normals[ni + 1] + cross[2] * m.normals[ni + 2];
    assert.ok(dot > 0, `triangle ${k / 3} à l'envers`);
  }
});

test('même étage = même maillage', () => {
  const d = generateFloor('stable', 1);
  assert.deepEqual(buildDungeonMesh(d), buildDungeonMesh(d));
});
