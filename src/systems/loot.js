// Butin : oboles et potions au sol, coffres des salles au trésor.
// Tout le hasard passe par le générateur de la partie (state.rng) : même graine
// + mêmes actions = mêmes trésors.

import { SIM } from './simConfig.js';
import { nextInt, nextFloat, chance } from '../core/rng.js';
import { isWalkable, tileAt } from '../dungeon/tiles.js';

const L = () => SIM.loot;

// Pose un objet au sol près de (x, z), légèrement dispersé, toujours sur une case praticable
export function spawnPickup(state, kind, x, z, amount = 1) {
  const a = nextFloat(state.rng) * Math.PI * 2;
  const r = 0.25 + nextFloat(state.rng) * 0.45;
  let px = x + Math.cos(a) * r;
  let pz = z + Math.sin(a) * r;
  if (!isWalkable(tileAt(state.dungeon, Math.floor(px), Math.floor(pz)))) {
    px = x;
    pz = z;
  }
  const item = { id: state.nextId++, kind, x: px, z: pz, amount };
  state.pickups.push(item);
  return item;
}

// Plusieurs petits tas d'oboles plutôt qu'un seul : c'est plus agréable à ramasser
function spawnObols(state, x, z, total) {
  while (total > 0) {
    const n = Math.min(total, nextInt(state.rng, 1, 3));
    spawnPickup(state, 'obol', x, z, n);
    total -= n;
  }
}

export function dropFromEnemy(state, e) {
  const l = L();
  if (chance(state.rng, l.enemyObolChance)) spawnObols(state, e.x, e.z, nextInt(state.rng, ...l.enemyObols));
  if (chance(state.rng, l.enemyPotionChance)) spawnPickup(state, 'potion', e.x, e.z);
}

export function dropRoomReward(state, room) {
  const l = L();
  const x = room.x + room.w / 2;
  const z = room.y + room.h / 2;
  spawnObols(state, x, z, nextInt(state.rng, ...l.roomObols));
  if (chance(state.rng, l.roomPotionChance)) spawnPickup(state, 'potion', x, z);
}

// Ramassage (et attraction des oboles), ouverture des coffres
export function updateLoot(state, dt) {
  const p = state.player;
  const l = L();

  for (const chest of state.chests) {
    if (chest.opened || Math.hypot(chest.x - p.x, chest.z - p.z) > 0.9) continue;
    chest.opened = true;
    spawnObols(state, chest.x, chest.z, nextInt(state.rng, ...l.chestObols));
    if (chance(state.rng, l.chestPotionChance)) spawnPickup(state, 'potion', chest.x, chest.z);
    state.events.push({ type: 'chestOpened', id: chest.id, x: chest.x, z: chest.z });
  }

  state.pickups = state.pickups.filter((it) => {
    const dx = p.x - it.x;
    const dz = p.z - it.z;
    const d = Math.hypot(dx, dz);
    // Une potion n'est pas gaspillée si le héros a déjà toute sa vie
    if (it.kind === 'potion' && p.hp >= p.maxHp) return true;
    if (d <= l.pickupRadius) {
      if (it.kind === 'obol') state.gold += it.amount;
      else p.hp = Math.min(p.maxHp, p.hp + l.potionHeal);
      state.events.push({ type: 'pickup', kind: it.kind, amount: it.amount, x: it.x, z: it.z });
      return false;
    }
    // Les oboles filent vers le héros quand il passe à proximité
    if (it.kind === 'obol' && d < l.magnetRadius) {
      const step = Math.min(d, l.magnetSpeed * dt);
      it.x += (dx / d) * step;
      it.z += (dz / d) * step;
    }
    return true;
  });
}

// Trésor d'un boss vaincu : beaucoup d'oboles et des potions
export function dropBossReward(state, boss) {
  const r = SIM.bosses[boss.type].reward;
  spawnObols(state, boss.x, boss.z, nextInt(state.rng, ...r.obols));
  for (let k = 0; k < r.potions; k++) spawnPickup(state, 'potion', boss.x, boss.z);
}
