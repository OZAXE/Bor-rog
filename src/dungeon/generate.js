// Génération procédurale d'un étage par découpage BSP (Binary Space Partitioning).
//
// Principe, en 4 temps :
// 1. On coupe la carte en deux (verticalement ou horizontalement), puis chaque
//    moitié en deux, etc., jusqu'à obtenir des "feuilles" assez petites.
// 2. On creuse une salle de taille aléatoire dans chaque feuille.
// 3. On relie les deux moitiés de chaque découpe par un couloir : comme on
//    remonte tout l'arbre, toutes les salles finissent reliées entre elles.
// 4. On entoure le vide creusé de murs, puis on "type" les salles (départ,
//    escalier, trésor, combat) et on pose le décor.
//
// Tout le hasard vient d'un générateur créé à partir de (graine, numéro d'étage) :
// même graine + même étage = exactement le même plan, sur n'importe quelle machine.

import { createRng, nextInt, nextFloat, chance, pick } from '../core/rng.js';
import { TILE, isWalkable, isLowWall, tileAt } from './tiles.js';

export const DEFAULT_PARAMS = {
  width: 60, // largeur de la carte (cases)
  height: 44, // hauteur de la carte (cases)
  minLeaf: 11, // taille mini d'une feuille BSP
  minRoom: 5, // côté mini d'une salle
  maxRoom: 13, // côté maxi d'une salle
  corridorWidth: 2, // couloirs larges : on doit pouvoir y esquiver en combat
  treasureChance: 0.35, // probabilité qu'une petite salle devienne une salle au trésor
  pillarChance: 0.5, // probabilité de piliers dans une grande salle de combat
  torchChance: 0.3, // probabilité d'une flamme sur un mur éligible (face sud ou est)
  debrisChance: 0.03, // probabilité de débris (décor) sur une case de sol
};

export function generateFloor(seed, floorIndex, params = DEFAULT_PARAMS) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const rng = createRng(`${seed}/etage-${floorIndex}`);

  const dungeon = {
    width: p.width,
    height: p.height,
    tiles: new Array(p.width * p.height).fill(TILE.VOID),
    rooms: [],
    start: null,
    stairs: null,
    decor: [],
  };

  // 1-3. Découpage, salles et couloirs. On garde une marge d'une case tout autour
  // de la carte pour que les murs extérieurs tiennent dans la grille.
  const root = { x: 1, y: 1, w: p.width - 2, h: p.height - 2 };
  buildNode(rng, dungeon, root, p);

  // 4a. Murs : toute case vide touchant du sol (8 voisins) devient un mur
  surroundWithWalls(dungeon);

  // 4b. Rôle de chaque salle
  assignRoomTypes(rng, dungeon, p);

  // 4c. Décor (piliers bloquants, torches et débris purement visuels)
  placePillars(rng, dungeon, p);
  placeTorches(rng, dungeon, p);
  placeDebris(rng, dungeon, p);

  return dungeon;
}

// ---------------------------------------------------------------------------
// Étage de boss : plan fixe, du sud au nord
//   salle de départ (où l'on se prépare) -> grande arène -> sanctuaire de l'escalier
// Le sanctuaire n'est accessible qu'en traversant l'arène, qui se scelle dès qu'on
// y entre : l'escalier n'est donc atteignable qu'après la victoire.
// ---------------------------------------------------------------------------

export function generateBossFloor(seed, floorIndex, bossId) {
  const rng = createRng(`${seed}/boss-${floorIndex}`);
  const W = 31;
  const H = 40;
  const dungeon = {
    width: W,
    height: H,
    tiles: new Array(W * H).fill(TILE.VOID),
    rooms: [],
    start: null,
    stairs: null,
    decor: [],
    boss: null,
  };
  const room = (x, y, w, h, type) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) setTile(dungeon, c, r, TILE.FLOOR);
    const rm = { id: dungeon.rooms.length, x, y, w, h, type };
    dungeon.rooms.push(rm);
    return rm;
  };
  const sanctum = room(13, 2, 5, 5, 'stairs');
  const arena = room(7, 10, 17, 15, 'boss');
  const start = room(12, 30, 7, 7, 'start');
  // Couloirs de 2 cases entre les salles
  carveLine(dungeon, center(sanctum), center(arena), 2);
  carveLine(dungeon, center(arena), center(start), 2);
  surroundWithWalls(dungeon);

  // Quatre colonnes dans l'arène : des abris... et des murs où un boss qui charge s'écrase
  for (const [c, r] of [
    [arena.x + 3, arena.y + 3],
    [arena.x + arena.w - 4, arena.y + 3],
    [arena.x + 3, arena.y + arena.h - 4],
    [arena.x + arena.w - 4, arena.y + arena.h - 4],
  ]) {
    setTile(dungeon, c, r, TILE.PILLAR);
  }

  dungeon.start = center(start);
  dungeon.stairs = center(sanctum);
  setTile(dungeon, dungeon.stairs.c, dungeon.stairs.r, TILE.STAIRS);
  const ac = center(arena);
  dungeon.boss = { id: bossId, roomId: arena.id, x: ac.c + 0.5, z: ac.r - 2 + 0.5 };

  placeTorches(rng, dungeon, { torchChance: 0.55 });
  placeDebris(rng, dungeon, { debrisChance: 0.02 });
  return dungeon;
}

// ---------------------------------------------------------------------------
// Découpage BSP
// ---------------------------------------------------------------------------

// Traite un nœud : soit on le coupe en deux, soit c'est une feuille et on y creuse une salle.
// Renvoie la liste des salles contenues dans ce nœud (pour pouvoir relier les deux moitiés).
function buildNode(rng, dungeon, node, p) {
  const halves = splitNode(rng, node, p);
  if (!halves) {
    const room = carveRoom(rng, dungeon, node, p);
    return [room];
  }
  const roomsA = buildNode(rng, dungeon, halves[0], p);
  const roomsB = buildNode(rng, dungeon, halves[1], p);
  // On relie les deux salles les plus proches de part et d'autre de la coupe :
  // ça évite les couloirs interminables qui traversent toute la carte
  const [a, b] = closestPair(roomsA, roomsB);
  carveCorridor(rng, dungeon, center(a), center(b), p.corridorWidth);
  return roomsA.concat(roomsB);
}

function splitNode(rng, node, p) {
  const canSplitW = node.w >= p.minLeaf * 2;
  const canSplitH = node.h >= p.minLeaf * 2;
  if (!canSplitW && !canSplitH) return null;

  // On coupe de préférence le côté le plus long, pour éviter des salles en "spaghetti"
  let vertical;
  if (canSplitW && !canSplitH) vertical = true;
  else if (!canSplitW && canSplitH) vertical = false;
  else if (node.w > node.h * 1.25) vertical = true;
  else if (node.h > node.w * 1.25) vertical = false;
  else vertical = chance(rng, 0.5);

  const size = vertical ? node.w : node.h;
  const cut = nextInt(rng, p.minLeaf, size - p.minLeaf);
  if (vertical) {
    return [
      { x: node.x, y: node.y, w: cut, h: node.h },
      { x: node.x + cut, y: node.y, w: node.w - cut, h: node.h },
    ];
  }
  return [
    { x: node.x, y: node.y, w: node.w, h: cut },
    { x: node.x, y: node.y + cut, w: node.w, h: node.h - cut },
  ];
}

// Creuse une salle dans une feuille, avec au moins une case de marge (pour les murs)
function carveRoom(rng, dungeon, leaf, p) {
  const w = nextInt(rng, p.minRoom, Math.min(p.maxRoom, leaf.w - 2));
  const h = nextInt(rng, p.minRoom, Math.min(p.maxRoom, leaf.h - 2));
  const x = leaf.x + nextInt(rng, 1, leaf.w - w - 1);
  const y = leaf.y + nextInt(rng, 1, leaf.h - h - 1);
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) setTile(dungeon, c, r, TILE.FLOOR);
  }
  const room = { id: dungeon.rooms.length, x, y, w, h, type: 'combat' };
  dungeon.rooms.push(room);
  return room;
}

// Couloir en "L" entre deux points, de largeur donnée
function carveCorridor(rng, dungeon, from, to, width) {
  const horizontalFirst = chance(rng, 0.5);
  const corner = horizontalFirst ? { c: to.c, r: from.r } : { c: from.c, r: to.r };
  carveLine(dungeon, from, corner, width);
  carveLine(dungeon, corner, to, width);
}

function carveLine(dungeon, a, b, width) {
  const c0 = Math.min(a.c, b.c);
  const c1 = Math.max(a.c, b.c);
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  for (let r = r0; r <= r1 + width - 1; r++) {
    for (let c = c0; c <= c1 + width - 1; c++) {
      if (tileAt(dungeon, c, r) === TILE.VOID) setTile(dungeon, c, r, TILE.FLOOR);
    }
  }
}

function closestPair(roomsA, roomsB) {
  let best = null;
  let bestDist = Infinity;
  for (const a of roomsA) {
    for (const b of roomsB) {
      const ca = center(a);
      const cb = center(b);
      const d = Math.abs(ca.c - cb.c) + Math.abs(ca.r - cb.r);
      if (d < bestDist) {
        bestDist = d;
        best = [a, b];
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Murs, rôles des salles, décor
// ---------------------------------------------------------------------------

function surroundWithWalls(dungeon) {
  const { width, height } = dungeon;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (tileAt(dungeon, c, r) !== TILE.VOID) continue;
      let touchesFloor = false;
      for (let dr = -1; dr <= 1 && !touchesFloor; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (tileAt(dungeon, c + dc, r + dr) === TILE.FLOOR) {
            touchesFloor = true;
            break;
          }
        }
      }
      if (touchesFloor) setTile(dungeon, c, r, TILE.WALL);
    }
  }
}

function assignRoomTypes(rng, dungeon, p) {
  const rooms = dungeon.rooms;

  // Départ : une salle au hasard
  const startRoom = pick(rng, rooms);
  startRoom.type = 'start';
  dungeon.start = center(startRoom);

  // Escalier : la salle la plus éloignée du départ EN DISTANCE DE MARCHE
  // (et pas à vol d'oiseau : deux salles proches peuvent être reliées par un long détour)
  const dist = walkDistances(dungeon, dungeon.start);
  let stairsRoom = null;
  let far = -1;
  for (const room of rooms) {
    if (room === startRoom) continue;
    const cc = center(room);
    const d = dist[cc.r * dungeon.width + cc.c];
    if (d > far) {
      far = d;
      stairsRoom = room;
    }
  }
  stairsRoom.type = 'stairs';
  dungeon.stairs = center(stairsRoom);
  setTile(dungeon, dungeon.stairs.c, dungeon.stairs.r, TILE.STAIRS);

  // Trésor : les petites salles restantes ont une chance d'en devenir une
  for (const room of rooms) {
    if (room.type !== 'combat') continue;
    if (room.w * room.h <= 42 && chance(rng, p.treasureChance)) room.type = 'treasure';
  }
}

// Piliers : 4 colonnes dans les grandes salles de combat.
// Un pilier n'est posé que si ses 8 voisins sont du sol : il ne peut donc jamais
// boucher un couloir ni couper une salle en deux.
function placePillars(rng, dungeon, p) {
  for (const room of dungeon.rooms) {
    if (room.type !== 'combat' || room.w < 7 || room.h < 7) continue;
    if (!chance(rng, p.pillarChance)) continue;
    const spots = [
      { c: room.x + 2, r: room.y + 2 },
      { c: room.x + room.w - 3, r: room.y + 2 },
      { c: room.x + 2, r: room.y + room.h - 3 },
      { c: room.x + room.w - 3, r: room.y + room.h - 3 },
    ];
    for (const s of spots) {
      if (isOpenAround(dungeon, s.c, s.r)) setTile(dungeon, s.c, s.r, TILE.PILLAR);
    }
  }
}

// Flammes (torches) : la caméra est placée au sud-est et regarde vers le nord-ouest,
// elle ne voit donc que les faces SUD et EST des murs. Une flamme est accrochée à
// l'une de ces faces quand elle donne sur du sol. On exclut les murs abaissés
// (cf. isLowWall) : une flamme y flotterait dans le vide.
function placeTorches(rng, dungeon, p) {
  const placed = [];
  for (let r = 0; r < dungeon.height; r++) {
    for (let c = 0; c < dungeon.width; c++) {
      if (tileAt(dungeon, c, r) !== TILE.WALL || isLowWall(dungeon, c, r)) continue;
      const faces = [];
      if (tileAt(dungeon, c, r + 1) === TILE.FLOOR) faces.push('south');
      if (tileAt(dungeon, c + 1, r) === TILE.FLOOR) faces.push('east');
      if (faces.length === 0) continue;
      // Au moins 4 cases entre deux flammes, pour ne pas en tapisser les murs
      if (placed.some((t) => Math.max(Math.abs(t.c - c), Math.abs(t.r - r)) < 4)) continue;
      if (!chance(rng, p.torchChance)) continue;
      const torch = { kind: 'torch', c, r, face: pick(rng, faces) };
      dungeon.decor.push(torch);
      placed.push(torch);
    }
  }
}

function placeDebris(rng, dungeon, p) {
  for (let r = 0; r < dungeon.height; r++) {
    for (let c = 0; c < dungeon.width; c++) {
      if (tileAt(dungeon, c, r) !== TILE.FLOOR) continue;
      if (!chance(rng, p.debrisChance)) continue;
      // Position et rotation dans la case : purement visuel, mais tiré ici pour être reproductible
      dungeon.decor.push({
        kind: 'debris',
        c,
        r,
        x: c + 0.2 + nextFloat(rng) * 0.6,
        z: r + 0.2 + nextFloat(rng) * 0.6,
        angle: nextFloat(rng) * Math.PI * 2,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Utilitaires (exportés pour les tests et la simulation)
// ---------------------------------------------------------------------------

export function center(room) {
  return { c: room.x + Math.floor(room.w / 2), r: room.y + Math.floor(room.h / 2) };
}

// Distance de marche (en cases, 4 directions) depuis une case vers toutes les autres.
// -1 = inaccessible.
export function walkDistances(dungeon, from) {
  const { width, height } = dungeon;
  const dist = new Array(width * height).fill(-1);
  const queue = [from.r * width + from.c];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const c = i % width;
    const r = (i - c) / width;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isWalkable(tileAt(dungeon, nc, nr))) continue;
      const j = nr * width + nc;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

function isOpenAround(dungeon, c, r) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (tileAt(dungeon, c + dc, r + dr) !== TILE.FLOOR) return false;
    }
  }
  return true;
}

function setTile(dungeon, c, r, value) {
  dungeon.tiles[r * dungeon.width + c] = value;
}
