// Comportement des boss (pur, déterministe). Même principe que les ennemis :
// une machine à états, et CHAQUE attaque est annoncée (zone rouge au sol) avant
// de partir, dans une direction figée au début de l'annonce.
//
// Cerbère :
//   chase   : marche vers le héros pendant une courte pause, puis choisit une attaque
//   windup  : annonce (e.attack = 'charge' | 'breath' | 'bite' | 'howl')
//   charge  : fonce en ligne droite ; s'écrase sur un mur ou une colonne (sonné)
//   recover : temps mort, la fenêtre pour frapper
// À 50 % de vie (une seule fois) : hurlement (invulnérable), 3 Ombres appelées,
// puis ses charges vont par deux.

import { SIM, ticks } from './simConfig.js';
import { nextInt } from '../core/rng.js';
import { facingOf, inArc } from './geometry.js';
import { hurtPlayer } from './player.js';
import { approachDir } from './enemies.js';
import { createEnemy } from '../state/gameState.js';
import { isWalkable, tileAt } from '../dungeon/tiles.js';

export function cerberusBrain(state, e, cfg, dx, dz, dist, ctx) {
  const b = SIM.bosses.cerberus;
  const p = state.player;
  const still = { mvx: 0, mvz: 0 };
  switch (e.mode) {
    case 'chase': {
      e.facing = facingOf(dx, dz);
      // Seconde phase : une seule fois, dès la moitié de la vie perdue
      if (!e.phase2 && e.hp <= e.maxHp * b.phase2.at) {
        e.phase2 = true;
        return startWindup(state, e, 'howl', b.phase2.howl, dx, dz, dist);
      }
      if (--e.timer > 0) {
        // Il ne s'approche que si le héros est loin : à mi-distance, il le jauge.
        // (S'il collait toujours au héros, il ne ferait plus que mordre.)
        if (dist <= b.keepDistance) return still;
        const dir = approachDir(state, e, cfg, ctx);
        return { mvx: dir.x * b.speed, mvz: dir.z * b.speed };
      }
      // Morsure si le héros est collé à lui, mais jamais deux fois de suite
      if (dist <= b.bite.trigger && e.lastAttack !== 'bite') {
        return startWindup(state, e, 'bite', b.bite.windup, dx, dz, dist);
      }
      // Sinon, il alterne charge et souffle
      e.nextAttack = e.nextAttack === 'breath' ? 'charge' : 'breath';
      const kind = e.nextAttack;
      if (kind === 'charge') e.chainLeft = e.phase2 ? 1 : 0;
      return startWindup(state, e, kind, b[kind].windup, dx, dz, dist);
    }
    case 'windup': {
      if (--e.timer > 0) return still;
      return release(state, e, b);
    }
    case 'charge': {
      if (--e.timer <= 0) return endCharge(state, e, b, b.charge.recover);
      return { mvx: e.aimX * b.charge.speed, mvz: e.aimZ * b.charge.speed };
    }
    case 'recover':
      if (--e.timer <= 0) {
        e.mode = 'chase';
        e.stunned = false;
        e.timer = pauseTicks(state, b);
      }
      return still;
    default:
      e.mode = 'chase';
      e.timer = pauseTicks(state, b);
      return still;
  }

  function startWindup(st, en, kind, seconds, ddx, ddz, d) {
    en.mode = 'windup';
    en.attack = kind;
    en.timer = ticks(seconds);
    en.aimX = ddx / (d || 1);
    en.aimZ = ddz / (d || 1);
    en.facing = facingOf(ddx, ddz);
    en.windupTotal = en.timer;
    en.lastAttack = kind;
    if (kind === 'howl') en.invulnerable = true;
    st.events.push({ type: 'windup', id: en.id, attack: kind });
    return still;
  }

  function release(st, en, cfgB) {
    const pl = st.player;
    switch (en.attack) {
      case 'charge':
        en.mode = 'charge';
        en.timer = Math.ceil((cfgB.charge.maxDistance / cfgB.charge.speed) * SIM.tickRate);
        en.chargeHit = false;
        st.events.push({ type: 'charge', id: en.id, x: en.x, z: en.z });
        return { mvx: en.aimX * cfgB.charge.speed, mvz: en.aimZ * cfgB.charge.speed };
      case 'breath': {
        st.events.push({ type: 'breath', id: en.id, x: en.x, z: en.z, facing: en.facing });
        const br = cfgB.breath;
        const hit = br.angles.some((a) => inArc(en.x, en.z, en.facing + a, br.range, br.coneArc, pl.x, pl.z, SIM.player.radius));
        if (hit) hurtPlayer(st, br.damage, en.x, en.z);
        return toRecover(en, br.recover);
      }
      case 'bite': {
        st.events.push({ type: 'strike', id: en.id, x: en.x, z: en.z, facing: en.facing });
        if (inArc(en.x, en.z, en.facing, cfgB.bite.range, cfgB.bite.arc, pl.x, pl.z, SIM.player.radius)) {
          hurtPlayer(st, cfgB.bite.damage, en.x, en.z);
        }
        return toRecover(en, cfgB.bite.recover);
      }
      case 'howl':
      default:
        en.invulnerable = false;
        summonShades(st, en, cfgB.phase2.adds);
        st.events.push({ type: 'howl', id: en.id, x: en.x, z: en.z });
        return toRecover(en, 0.3);
    }
  }

  function toRecover(en, seconds) {
    en.mode = 'recover';
    en.timer = ticks(seconds);
    return still;
  }
}

// Fin de charge : enchaîne une seconde charge en phase 2, sinon temps mort
function endCharge(state, e, b, recoverSeconds) {
  if (e.chainLeft > 0) {
    e.chainLeft--;
    const p = state.player;
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    e.mode = 'windup';
    e.attack = 'charge';
    e.timer = ticks(b.phase2.chainWindup);
    e.windupTotal = e.timer;
    e.aimX = dx / d;
    e.aimZ = dz / d;
    e.facing = facingOf(dx, dz);
    state.events.push({ type: 'windup', id: e.id, attack: 'charge' });
  } else {
    e.mode = 'recover';
    e.timer = ticks(recoverSeconds);
  }
  return { mvx: 0, mvz: 0 };
}

// Après le déplacement d'un pas : contact pendant la charge, et choc contre un obstacle
export function resolveBossCharge(state, e, moved, wanted) {
  const b = SIM.bosses[e.type];
  const p = state.player;
  if (!e.chargeHit && Math.hypot(p.x - e.x, p.z - e.z) < b.radius + SIM.player.radius + 0.1) {
    if (hurtPlayer(state, b.charge.damage, e.x, e.z)) e.chargeHit = true;
  }
  if (wanted > 0 && moved < wanted * 0.5) {
    // Contre un mur ou une colonne : sonné, la grande fenêtre pour frapper
    e.chainLeft = 0;
    e.mode = 'recover';
    e.timer = ticks(b.charge.wallStun);
    e.stunned = true;
    state.events.push({ type: 'crash', id: e.id, x: e.x, z: e.z });
  }
}

function pauseTicks(state, b) {
  return nextInt(state.rng, ticks(b.pause[0]), ticks(b.pause[1]));
}

// Le hurlement appelle des Ombres autour du boss, sur des cases libres
function summonShades(state, e, count) {
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + 0.6;
    for (const r of [3, 2.2, 1.6]) {
      const x = e.x + Math.cos(a) * r;
      const z = e.z + Math.sin(a) * r;
      if (!isWalkable(tileAt(state.dungeon, Math.floor(x), Math.floor(z)))) continue;
      const add = createEnemy(state, { type: 'shade', x, z });
      add.alert = true;
      add.mode = 'chase';
      add.summoned = true;
      state.enemies.push(add);
      state.events.push({ type: 'summon', id: add.id, x, z });
      break;
    }
  }
}
