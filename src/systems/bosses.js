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
import { nextInt, nextFloat } from '../core/rng.js';
import { addHazard } from './hazards.js';
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

// ===========================================================================
// L'Hydre de Lerne
// Le corps ne bouge pas : il gère ses têtes (repousse, cautérisation) et, en
// phase 2, fait jaillir des flaques de lave annoncées autour du héros.
// ===========================================================================

export function hydraBrain(state, e) {
  const b = SIM.bosses.hydra;
  const p = state.player;
  e.facing = facingOf(p.x - e.x, p.z - e.z);
  const still = { mvx: 0, mvz: 0 };

  // Premier pas : on recense les têtes de départ, une par emplacement
  if (!e.slots) {
    // Recensement par EMPLACEMENT (et non par tête vivante) : une tête tranchée avant
    // ce tout premier pas est ainsi bien prise en compte, et repoussera
    const list = state.enemies.filter((h) => h.type === 'hydraHead');
    e.slots = [];
    for (let k = 0; k < b.heads; k++) {
      const h = list.find((x) => x.slot === k);
      e.slots.push({ slot: k, headId: h ? h.id : null, regrow: h ? 0 : ticks(b.regrow), sealed: false });
    }
    e.lastHp = e.hp;
    // Premières attaques décalées : synchronisées, les têtes cracheraient un mur de projectiles
    for (const h of list) h.timer = ticks(1.2 + h.slot * 0.65);
  }
  const alive = new Set(state.enemies.map((h) => h.id));

  // Frapper le corps cautérise les moignons : ces têtes-là ne repousseront plus
  if (e.hp < e.lastHp) {
    for (const s of e.slots) {
      if (s.headId === null && !s.sealed) {
        s.sealed = true;
        state.events.push({ type: 'cauterize', slot: s.slot, ...slotPos(e, s.slot, e.slots.length) });
      }
    }
  }
  e.lastHp = e.hp;

  for (const s of e.slots) {
    if (s.headId !== null && !alive.has(s.headId)) {
      s.headId = null;
      s.regrow = ticks(b.regrow);
      state.events.push({ type: 'headSevered', slot: s.slot, ...slotPos(e, s.slot, e.slots.length) });
    } else if (s.headId === null && !s.sealed && --s.regrow <= 0) {
      s.headId = spawnHead(state, e, s.slot, e.slots.length).id;
      state.events.push({ type: 'headRegrow', slot: s.slot, ...slotPos(e, s.slot, e.slots.length) });
    }
  }

  // Seconde phase : une tête de plus, et des flaques de lave régulières
  if (!e.phase2 && e.hp <= e.maxHp * b.phase2.at) {
    e.phase2 = true;
    const total = e.slots.length + b.phase2.extraHeads;
    for (let k = e.slots.length; k < total; k++) e.slots.push({ slot: k, headId: null, regrow: 1, sealed: false });
    // Les têtes se répartissent à nouveau sur le cercle
    for (const s of e.slots) {
      const h = state.enemies.find((x) => x.id === s.headId);
      if (h) Object.assign(h, slotPos(e, s.slot, total));
    }
    e.poolTimer = ticks(1);
    state.events.push({ type: 'howl', id: e.id, x: e.x, z: e.z });
  }
  if (e.phase2 && --e.poolTimer <= 0) {
    const ph = b.phase2;
    e.poolTimer = nextInt(state.rng, ticks(ph.poolEvery[0]), ticks(ph.poolEvery[1]));
    const a = nextFloat(state.rng) * Math.PI * 2;
    const r = nextFloat(state.rng) * 1.2;
    addHazard(state, {
      kind: 'lava',
      x: p.x + Math.cos(a) * r,
      z: p.z + Math.sin(a) * r,
      r: ph.poolRadius,
      warn: ticks(ph.poolWarn),
      life: ticks(ph.poolLife),
      damage: ph.poolDamage,
    });
  }
  return still;
}

function slotPos(body, slot, total) {
  const a = (slot / total) * Math.PI * 2 + Math.PI / 4;
  const r = SIM.bosses.hydra.headRing;
  return { x: body.x + Math.cos(a) * r, z: body.z + Math.sin(a) * r };
}

function spawnHead(state, body, slot, total) {
  const pos = slotPos(body, slot, total);
  const h = createEnemy(state, { type: 'hydraHead', x: pos.x, z: pos.z, slot });
  h.alert = true;
  h.mode = 'chase';
  h.timer = ticks(1.2); // une tête qui repousse ne mord pas tout de suite
  state.enemies.push(h);
  return h;
}

// Une tête : fixe ; mord si le héros est proche, crache un éventail sinon
export function hydraHeadBrain(state, e, cfg, dx, dz, dist) {
  const b = SIM.bosses.hydra;
  const still = { mvx: 0, mvz: 0 };
  e.facing = facingOf(dx, dz);
  switch (e.mode) {
    case 'chase':
      if (--e.timer > 0) return still;
      e.attack = dist <= b.bite.trigger ? 'bite' : 'spit';
      e.mode = 'windup';
      e.timer = ticks(b[e.attack].windup);
      e.windupTotal = e.timer;
      e.aimX = dx / (dist || 1);
      e.aimZ = dz / (dist || 1);
      state.events.push({ type: 'windup', id: e.id, attack: e.attack });
      return still;
    case 'windup': {
      if (--e.timer > 0) return still;
      const aim = Math.atan2(e.aimX, e.aimZ);
      if (e.attack === 'bite') {
        state.events.push({ type: 'strike', id: e.id, x: e.x, z: e.z, facing: aim });
        if (inArc(e.x, e.z, aim, b.bite.range, b.bite.arc, state.player.x, state.player.z, SIM.player.radius)) {
          hurtPlayer(state, b.bite.damage, e.x, e.z);
        }
      } else {
        const sp = b.spit;
        for (let k = 0; k < sp.count; k++) {
          const a = aim + (k - (sp.count - 1) / 2) * sp.spread;
          state.projectiles.push({
            id: state.nextId++,
            x: e.x + Math.sin(a) * 0.5,
            z: e.z + Math.cos(a) * 0.5,
            vx: Math.sin(a) * sp.speed,
            vz: Math.cos(a) * sp.speed,
            travelLeft: sp.range,
            damage: sp.damage,
            kind: 'venom',
          });
        }
        state.events.push({ type: 'shoot', id: e.id, x: e.x, z: e.z });
      }
      e.mode = 'chase';
      e.timer = nextInt(state.rng, ticks(b.headCooldown[0]), ticks(b.headCooldown[1]));
      return still;
    }
    default:
      e.mode = 'chase';
      e.timer = ticks(1);
      return still;
  }
}

// ===========================================================================
// Thanatos, la Mort
// ===========================================================================

export function thanatosBrain(state, e, cfg, dx, dz, dist, ctx) {
  const b = SIM.bosses.thanatos;
  const p = state.player;
  const still = { mvx: 0, mvz: 0 };
  // Phase 3 : plus rapide, préparations plus courtes
  const fast = e.phase3 ? b.phase3 : { speed: 1, windup: 1 };
  const windup = (s) => Math.max(1, Math.round(ticks(s) * fast.windup));

  // Phases : doubles illusoires à 50 % (et à nouveau s'ils ont tous disparu), accélération à 25 %
  if (!e.phase2 && e.hp <= e.maxHp * b.phase2.at) {
    e.phase2 = true;
    e.resummon = 0;
  }
  if (!e.phase3 && e.hp <= e.maxHp * b.phase3.at) {
    e.phase3 = true;
    state.events.push({ type: 'howl', id: e.id, x: e.x, z: e.z });
  }
  if (e.phase2 && e.mode !== 'vanish' && !state.enemies.some((d) => d.type === 'thanatosDouble')) {
    if (--e.resummon <= 0) {
      summonDoubles(state, e, b.phase2.doubles);
      e.resummon = ticks(b.phase2.resummon);
    }
  }

  switch (e.mode) {
    case 'chase': {
      e.facing = facingOf(dx, dz);
      if (--e.timer > 0) {
        if (dist <= b.keepDistance) return still;
        const dir = approachDir(state, e, cfg, ctx);
        return { mvx: dir.x * b.speed * fast.speed, mvz: dir.z * b.speed * fast.speed };
      }
      // Faux si le héros est à portée, sinon il alterne pluie d'âmes et téléportation
      if (dist <= b.reap.radius * 0.8) return begin('reap', windup(b.reap.windup));
      e.cycle = (e.cycle || 0) + 1;
      return e.cycle % 2 ? castRain() : vanish();
    }
    case 'windup':
      if (--e.timer > 0) return still;
      return release();
    case 'vanish':
      if (--e.timer > 0) return still;
      // Réapparition derrière le héros, puis un coup de faux rapide
      e.x = e.blinkX;
      e.z = e.blinkZ;
      e.untargetable = false;
      e.invulnerable = false;
      state.events.push({ type: 'appear', id: e.id, x: e.x, z: e.z });
      return begin('slash', windup(b.blink.slashWindup));
    case 'recover':
      if (--e.timer <= 0) {
        e.mode = 'chase';
        e.timer = nextInt(state.rng, ticks(b.pause[0] / fast.speed), ticks(b.pause[1] / fast.speed));
      }
      return still;
    default:
      e.mode = 'chase';
      e.timer = ticks(b.pause[0]);
      return still;
  }

  function begin(kind, t) {
    const ddx = p.x - e.x;
    const ddz = p.z - e.z;
    const d = Math.hypot(ddx, ddz) || 1;
    e.mode = 'windup';
    e.attack = kind;
    e.timer = t;
    e.windupTotal = t;
    e.aimX = ddx / d;
    e.aimZ = ddz / d;
    e.facing = facingOf(ddx, ddz);
    state.events.push({ type: 'windup', id: e.id, attack: kind });
    return still;
  }

  function release() {
    if (e.attack === 'reap') {
      state.events.push({ type: 'reap', id: e.id, x: e.x, z: e.z, r: b.reap.radius });
      if (Math.hypot(p.x - e.x, p.z - e.z) < b.reap.radius + SIM.player.radius) hurtPlayer(state, b.reap.damage, e.x, e.z);
      return recover(b.reap.recover);
    }
    // 'slash' (après la téléportation)
    state.events.push({ type: 'strike', id: e.id, x: e.x, z: e.z, facing: e.facing });
    if (inArc(e.x, e.z, e.facing, b.blink.slashRange, b.blink.slashArc, p.x, p.z, SIM.player.radius)) {
      hurtPlayer(state, b.blink.damage, e.x, e.z);
    }
    return recover(b.blink.recover);
  }

  function recover(seconds) {
    e.mode = 'recover';
    e.timer = ticks(seconds);
    return still;
  }

  // Pluie d'âmes : des cercles annoncés autour du héros (le premier pile sur lui)
  function castRain() {
    const r = b.rain;
    for (let k = 0; k < r.count; k++) {
      const a = nextFloat(state.rng) * Math.PI * 2;
      const d = k === 0 ? 0 : 1 + nextFloat(state.rng) * (r.spread - 1);
      addHazard(state, { kind: 'soul', x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, r: r.radius, warn: windup(r.warn), damage: r.damage });
    }
    state.events.push({ type: 'rain', id: e.id, x: e.x, z: e.z });
    e.attack = 'rain';
    return recover(r.recover);
  }

  // Téléportation : il disparaît et choisit un point DERRIÈRE le héros
  function vanish() {
    const bl = b.blink;
    const back = { x: -Math.sin(p.facing), z: -Math.cos(p.facing) };
    let tx = p.x + back.x * bl.behind;
    let tz = p.z + back.z * bl.behind;
    if (!isWalkable(tileAt(state.dungeon, Math.floor(tx), Math.floor(tz)))) {
      // Pas de place derrière : il réapparaît là où il était
      tx = e.x;
      tz = e.z;
    }
    e.blinkX = tx;
    e.blinkZ = tz;
    e.mode = 'vanish';
    e.attack = 'blink';
    e.timer = windup(bl.vanish);
    e.windupTotal = e.timer;
    e.untargetable = true;
    e.invulnerable = true;
    state.events.push({ type: 'vanish', id: e.id, x: e.x, z: e.z, tx, tz });
    return still;
  }
}

// Un double : se déplace comme Thanatos et prépare des coups de faux (moins forts).
// Il s'évanouit au premier coup reçu (cf. player.js).
export function thanatosDoubleBrain(state, e, cfg, dx, dz, dist, ctx) {
  const b = SIM.bosses.thanatos;
  const p = state.player;
  const still = { mvx: 0, mvz: 0 };
  e.facing = facingOf(dx, dz);
  switch (e.mode) {
    case 'chase':
      if (--e.timer > 0) {
        if (dist <= b.keepDistance) return still;
        const dir = approachDir(state, e, cfg, ctx);
        return { mvx: dir.x * b.speed, mvz: dir.z * b.speed };
      }
      if (dist > b.reap.radius * 0.9) {
        e.timer = ticks(0.3);
        const dir = approachDir(state, e, cfg, ctx);
        return { mvx: dir.x * b.speed, mvz: dir.z * b.speed };
      }
      e.mode = 'windup';
      e.attack = 'reap';
      e.timer = ticks(b.reap.windup);
      e.windupTotal = e.timer;
      state.events.push({ type: 'windup', id: e.id, attack: 'reap' });
      return still;
    case 'windup':
      if (--e.timer > 0) return still;
      state.events.push({ type: 'reap', id: e.id, x: e.x, z: e.z, r: b.reap.radius });
      if (Math.hypot(p.x - e.x, p.z - e.z) < b.reap.radius + SIM.player.radius) hurtPlayer(state, b.reap.damage - 1, e.x, e.z);
      e.mode = 'chase';
      e.timer = nextInt(state.rng, ticks(1.2), ticks(2.2));
      return still;
    default:
      e.mode = 'chase';
      e.timer = ticks(1);
      return still;
  }
}

function summonDoubles(state, e, count) {
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + 1.1;
    for (const r of [2.5, 1.8, 1.2]) {
      const x = e.x + Math.cos(a) * r;
      const z = e.z + Math.sin(a) * r;
      if (!isWalkable(tileAt(state.dungeon, Math.floor(x), Math.floor(z)))) continue;
      const d = createEnemy(state, { type: 'thanatosDouble', x, z });
      d.alert = true;
      d.mode = 'chase';
      d.timer = ticks(0.8);
      state.enemies.push(d);
      state.events.push({ type: 'summon', id: d.id, x, z });
      break;
    }
  }
}
