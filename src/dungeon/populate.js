// Peuplement d'un étage : où apparaissent les ennemis, et lesquels.
//
// Le hasard vient d'un générateur dérivé de (graine, étage) mais DISTINCT de celui
// du plan : on peut ainsi régler le nombre d'ennemis sans changer la forme des
// étages déjà connus (une graine partagée garde le même plan).

import { createRng, nextInt, nextFloat, chance, shuffle } from '../core/rng.js';
import { TILE, tileAt } from './tiles.js';
import { SIM } from '../systems/simConfig.js';
import { floorScaling } from '../systems/difficulty.js';

// Renvoie la liste des ennemis (sans identifiant : c'est l'état qui les numérote)
export function populateFloor(dungeon, seed, floorIndex, spawn = SIM.spawn) {
  // Étage de boss : le boss seul dans son arène
  if (dungeon.boss) {
    const b = dungeon.boss;
    const list = [{ type: b.id, x: b.x, z: b.z, roomId: b.roomId, boss: true }];
    // L'Hydre arrive avec ses têtes, réparties en cercle autour du corps
    if (b.id === 'hydra') {
      const cfg = SIM.bosses.hydra;
      for (let k = 0; k < cfg.heads; k++) {
        const a = (k / cfg.heads) * Math.PI * 2 + Math.PI / 4;
        list.push({ type: 'hydraHead', x: b.x + Math.cos(a) * cfg.headRing, z: b.z + Math.sin(a) * cfg.headRing, roomId: b.roomId, slot: k });
      }
    }
    return list;
  }
  const rng = createRng(`${seed}/monstres-${floorIndex}`);
  const archerChance = Math.min(
    spawn.maxArcherChance,
    spawn.archerChance + spawn.archerChancePerFloor * floorIndex,
  );
  const furyChance =
    floorIndex >= spawn.furyFromFloor
      ? Math.min(spawn.maxFuryChance, spawn.furyChance + spawn.furyChancePerFloor * (floorIndex - spawn.furyFromFloor))
      : 0;
  const eliteChance = floorScaling(floorIndex).eliteChance;
  const enemies = [];

  for (const room of dungeon.rooms) {
    // Le départ est un sanctuaire ; les salles au trésor auront leur butin (étape 4)
    if (room.type !== 'combat' && room.type !== 'stairs') continue;

    const area = room.w * room.h;
    const wanted = Math.min(
      spawn.maxPerRoom,
      spawn.basePerRoom + spawn.perFloor * floorIndex + Math.floor(area / spawn.perArea) + nextInt(rng, -1, 1),
    );

    // Cases candidates : sol libre à l'intérieur de la salle (pas contre les murs)
    const spots = [];
    for (let r = room.y + 1; r < room.y + room.h - 1; r++) {
      for (let c = room.x + 1; c < room.x + room.w - 1; c++) {
        if (tileAt(dungeon, c, r) !== TILE.FLOOR) continue;
        const far = Math.max(Math.abs(c - dungeon.start.c), Math.abs(r - dungeon.start.r));
        if (far < spawn.safeDistance) continue;
        spots.push({ c, r });
      }
    }
    shuffle(rng, spots);

    // Au plus un ennemi par case, et pas deux sur des cases voisines
    const taken = [];
    for (const s of spots) {
      if (taken.length >= wanted) break;
      if (taken.some((t) => Math.abs(t.c - s.c) <= 1 && Math.abs(t.r - s.r) <= 1)) continue;
      taken.push(s);
      const roll = nextFloat(rng);
      const type = roll < furyChance ? 'fury' : roll < furyChance + archerChance ? 'archer' : 'shade';
      enemies.push({
        type,
        elite: chance(rng, eliteChance),
        x: s.c + 0.5,
        z: s.r + 0.5,
        roomId: room.id,
        // Décalage initial du premier tir, pour que les archers ne tirent pas tous ensemble
        firstShotDelay: nextInt(rng, 0, 60),
      });
    }
  }
  return enemies;
}
