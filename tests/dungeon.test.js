// Tests de la génération procédurale : on vérifie sur des centaines de graines
// que chaque étage produit est jouable (pas seulement "joli sur un exemple").
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor, walkDistances, center } from '../src/dungeon/generate.js';
import { TILE, isWalkable, isSolid, isLowWall, tileAt } from '../src/dungeon/tiles.js';

const SEEDS = Array.from({ length: 300 }, (_, i) => `graine-${i}`);
const floors = SEEDS.map((s, i) => generateFloor(s, i % 4));

test('même graine + même étage = exactement le même étage', () => {
  for (const seed of ['a', 'demo', 'x9z']) {
    for (const f of [0, 3]) {
      assert.deepEqual(generateFloor(seed, f), generateFloor(seed, f));
    }
  }
});

test('graines ou étages différents = plans différents', () => {
  const plans = new Set(floors.map((d) => d.tiles.join('')));
  assert.equal(plans.size, floors.length, 'deux graines ont donné le même plan');
  assert.notDeepEqual(generateFloor('demo', 0).tiles, generateFloor('demo', 1).tiles);
});

test('toutes les cases praticables sont accessibles depuis le départ', () => {
  for (const [i, d] of floors.entries()) {
    const dist = walkDistances(d, d.start);
    for (let k = 0; k < d.tiles.length; k++) {
      if (isWalkable(d.tiles[k])) {
        assert.ok(dist[k] >= 0, `${SEEDS[i]} : case ${k % d.width},${Math.floor(k / d.width)} isolée`);
      }
    }
  }
});

test("l'escalier est loin du départ (en distance de marche)", () => {
  for (const [i, d] of floors.entries()) {
    const dist = walkDistances(d, d.start);
    const stairs = dist[d.stairs.r * d.width + d.stairs.c];
    assert.ok(stairs >= 15, `${SEEDS[i]} : escalier à ${stairs} cases seulement`);
    // et c'est (presque) la salle la plus lointaine. "Presque" : l'escalier est choisi
    // avant la pose des piliers, qui peuvent rallonger un trajet d'une ou deux cases.
    for (const room of d.rooms) {
      const cc = center(room);
      const roomDist = dist[cc.r * d.width + cc.c];
      assert.ok(roomDist <= stairs * 1.1, `${SEEDS[i]} : salle à ${roomDist}, escalier à ${stairs}`);
    }
  }
});

test('départ sur du sol, escalier sur sa case, une seule de chaque', () => {
  for (const d of floors) {
    assert.equal(tileAt(d, d.start.c, d.start.r), TILE.FLOOR);
    assert.equal(tileAt(d, d.stairs.c, d.stairs.r), TILE.STAIRS);
    assert.equal(d.tiles.filter((t) => t === TILE.STAIRS).length, 1);
    assert.equal(d.rooms.filter((r) => r.type === 'start').length, 1);
    assert.equal(d.rooms.filter((r) => r.type === 'stairs').length, 1);
  }
});

test('le donjon est fermé : aucun sol au bord de la carte ni contre la roche', () => {
  for (const d of floors) {
    for (let r = 0; r < d.height; r++) {
      for (let c = 0; c < d.width; c++) {
        if (!isWalkable(tileAt(d, c, r))) continue;
        assert.ok(c > 0 && r > 0 && c < d.width - 1 && r < d.height - 1, 'sol au bord');
        // Les 8 voisins d'un sol ne sont jamais de la roche pleine (il y a toujours un mur)
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            assert.notEqual(tileAt(d, c + dc, r + dr), TILE.VOID, `sol en ${c},${r} contre la roche`);
          }
        }
      }
    }
  }
});

test('nombre de salles raisonnable et salles typées', () => {
  const types = new Set(['start', 'stairs', 'combat', 'treasure']);
  for (const d of floors) {
    assert.ok(d.rooms.length >= 6 && d.rooms.length <= 24, `${d.rooms.length} salles`);
    for (const room of d.rooms) assert.ok(types.has(room.type), room.type);
  }
  // Sur 300 étages, il doit y avoir des trésors, des piliers et des flammes des deux côtés
  const faces = new Set(floors.flatMap((d) => d.decor.filter((x) => x.kind === 'torch').map((x) => x.face)));
  assert.deepEqual([...faces].sort(), ['east', 'south']);
  assert.ok(floors.some((d) => d.rooms.some((r) => r.type === 'treasure')));
  assert.ok(floors.some((d) => d.tiles.includes(TILE.PILLAR)));
});

test('décor bien placé : flammes sur des faces de murs hauts visibles, débris sur du sol', () => {
  for (const d of floors) {
    for (const item of d.decor) {
      if (item.kind === 'torch') {
        assert.equal(tileAt(d, item.c, item.r), TILE.WALL);
        // accrochée à une face visible par la caméra (sud ou est) qui donne sur du sol
        const [dc, dr] = item.face === 'south' ? [0, 1] : item.face === 'east' ? [1, 0] : [NaN, NaN];
        assert.equal(tileAt(d, item.c + dc, item.r + dr), TILE.FLOOR, `face ${item.face}`);
        // jamais sur un mur abaissé (elle flotterait dans le vide)
        assert.ok(!isLowWall(d, item.c, item.r), `torche sur mur bas en ${item.c},${item.r}`);
      } else {
        assert.equal(item.kind, 'debris');
        assert.ok(!isSolid(tileAt(d, item.c, item.r)));
      }
    }
  }
});

test("l'étage est sérialisable en JSON sans perte", () => {
  const d = generateFloor('json', 2);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});
