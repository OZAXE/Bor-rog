// Salles verrouillées, à la Hades : quand le héros entre dans une salle de combat
// occupée, des grilles se dressent dans tous ses passages. Elles retombent quand
// tous les ennemis ENFERMÉS avec lui sont vaincus, et la salle est alors purifiée
// pour de bon.
//
// Garantie anti-blocage : on n'enferme que les ennemis qui sont physiquement dans
// la salle au moment de la fermeture (pas "ceux qui y sont nés", qui ont pu partir
// poursuivre le héros ailleurs). Les grilles étant infranchissables dans les deux
// sens, chaque ennemi à vaincre reste à portée.

import { TILE, isWalkable, tileAt } from '../dungeon/tiles.js';
import { pushOut } from './collision.js';
import { SIM } from './simConfig.js';
import { dropRoomReward } from './loot.js';

export function updateRooms(state) {
  if (state.lock) {
    const alive = new Set(state.enemies.map((e) => e.id));
    if (state.lock.enemyIds.some((id) => alive.has(id))) return;
    unlock(state);
    return;
  }

  const room = roomAround(state.dungeon, state.player.x, state.player.z);
  if (!room || room.cleared || (room.type !== 'combat' && room.type !== 'stairs' && room.type !== 'boss')) return;

  const inside = state.enemies.filter((e) => inRoom(room, e.x, e.z));
  if (inside.length === 0) {
    room.cleared = true; // salle vide (ennemis partis ou déjà vaincus) : rien à faire
    return;
  }

  const doors = roomDoors(state.dungeon, room);
  // Un ennemi pile dans l'embrasure est d'abord renvoyé côté couloir : il n'est pas
  // enfermé (il n'était pas dans la salle) et ne doit pas se retrouver dans la grille
  for (const e of state.enemies) {
    const d = doors.find((g) => g.c === Math.floor(e.x) && g.r === Math.floor(e.z));
    if (!d) continue;
    const out = outward(room, d);
    e.x = d.c + 0.5 + out.dc;
    e.z = d.r + 0.5 + out.dr;
  }
  for (const d of doors) state.dungeon.tiles[d.r * state.dungeon.width + d.c] = TILE.GATE;
  // Les ennemis qui frôlent une grille en sont dégagés tout de suite (vers leur côté)
  for (const e of state.enemies) {
    const pos = { x: e.x, z: e.z };
    pushOut(state.dungeon, pos, SIM.enemies[e.type].radius);
    e.x = pos.x;
    e.z = pos.z;
  }
  state.lock = { roomId: room.id, doors, enemyIds: inside.map((e) => e.id) };
  for (const e of inside) {
    if (!e.alert) {
      e.alert = true;
      e.mode = 'chase';
      // Un boss se présente (1,5 s) avant sa première attaque
      if (e.boss) e.timer = 90;
    }
  }
  state.events.push({ type: 'roomLocked', roomId: room.id, count: inside.length });
}

function unlock(state) {
  const { doors, roomId } = state.lock;
  for (const d of doors) state.dungeon.tiles[d.r * state.dungeon.width + d.c] = TILE.FLOOR;
  const room = state.dungeon.rooms.find((r) => r.id === roomId);
  room.cleared = true;
  state.lock = null;
  state.events.push({ type: 'roomCleared', roomId, doors });
  dropRoomReward(state, room);
}

// Salle dans laquelle le héros est VRAIMENT entré : au moins une case entière
// au-delà du seuil. Rester dans l'embrasure d'une porte ne déclenche rien, et
// surtout la grille ne peut jamais se refermer sur le héros.
export function roomAround(dungeon, x, z) {
  const c = Math.floor(x);
  const r = Math.floor(z);
  for (const room of dungeon.rooms) {
    if (c >= room.x + 1 && c <= room.x + room.w - 2 && r >= room.y + 1 && r <= room.y + room.h - 2) {
      return room;
    }
  }
  return null;
}

// Direction "vers l'extérieur de la salle" depuis un passage
function outward(room, d) {
  if (d.r < room.y) return { dc: 0, dr: -1 };
  if (d.r >= room.y + room.h) return { dc: 0, dr: 1 };
  if (d.c < room.x) return { dc: -1, dr: 0 };
  return { dc: 1, dr: 0 };
}

export function inRoom(room, x, z) {
  return x >= room.x && x <= room.x + room.w && z >= room.y && z <= room.y + room.h;
}

// Passages d'une salle : cases praticables collées à l'extérieur de son rectangle
// (là où un couloir débouche). Les fermer suffit à isoler la salle, car le reste
// de son pourtour est en murs. "axis" indique l'orientation de la grille à dessiner.
export function roomDoors(dungeon, room) {
  const doors = [];
  const add = (c, r, axis) => {
    if (isWalkable(tileAt(dungeon, c, r))) doors.push({ c, r, axis });
  };
  for (let c = room.x; c < room.x + room.w; c++) {
    add(c, room.y - 1, 'x'); // bord nord : grille alignée sur l'axe x
    add(c, room.y + room.h, 'x'); // bord sud
  }
  for (let r = room.y; r < room.y + room.h; r++) {
    add(room.x - 1, r, 'z'); // bord ouest : grille alignée sur l'axe z
    add(room.x + room.w, r, 'z'); // bord est
  }
  return doors;
}
