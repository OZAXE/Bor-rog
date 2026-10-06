// État complet d'une partie : uniquement des données simples (nombres, textes,
// tableaux, objets), donc sérialisable en JSON. C'est ce qui permettra plus tard
// d'envoyer l'état par le réseau ou de sauvegarder une partie.

import { createRng } from '../core/rng.js';
import { generateFloor, generateBossFloor } from '../dungeon/generate.js';
import { bossOf } from '../dungeon/zones.js';
import { populateFloor } from '../dungeon/populate.js';
import { SIM, ticks } from '../systems/simConfig.js';
import { enemyStats } from '../systems/difficulty.js';
import { cleanMeta, metaValue, rankOf, attrValue } from '../meta/tree.js';
import { startPact } from '../systems/descent.js';
import { classOf, classRules } from '../systems/classes.js';
import { isWalkable, tileAt } from '../dungeon/tiles.js';

export const STATE_VERSION = 9; // 9 : co-op (state.players)

// options.enemies : false pour un donjon vide (tests d'exploration)
// options.dungeonParams : réglages du générateur d'étages (tests)
// options.meta : améliorations permanentes { attrs, talents } (cf. src/meta/tree.js)
// options.cls : classe du héros ('warrior', 'huntress', 'mystic' ; Guerrier par défaut)
// options.players : co-op, un { meta, cls } par joueur (remplace meta et cls)
export function createGameState(seed, options = {}) {
  const list = Array.isArray(options.players) && options.players.length
    ? options.players.slice(0, SIM.coop.maxPlayers)
    : [{ meta: options.meta, cls: options.cls }];
  const state = {
    version: STATE_VERSION,
    seed: String(seed),
    options: { enemies: options.enemies !== false, dungeonParams: options.dungeonParams || null },
    tick: 0, // nombre de pas de simulation écoulés (60 par seconde)
    status: 'playing', // 'playing', 'choosing' (écran de Charon), 'dead' ou 'victory'
    floorIndex: 0, // étage actuel (0 = premier)
    kills: 0,
    shadows: 0, // Ombres gagnées pendant la partie, par chaque joueur (cf. src/meta/profile.js)
    bossesDefeated: [], // boss vaincus pendant la partie (déblocage des classes)
    // Générateur de la partie (combats, butin…).
    // La génération des étages a ses propres générateurs dérivés de la graine.
    rng: createRng(`${seed}/partie`),
    nextId: 1, // numéro du prochain ennemi ou projectile créé
    dungeon: null,
    // Les héros : un en solo, deux en co-op. L'indice dans ce tableau identifie le joueur.
    players: list.map((o, i) => createPlayer(i, o.meta, o.cls)),
    enemies: [],
    projectiles: [],
    // Salle verrouillée en cours : { roomId, doors, enemyIds } ou null
    lock: null,
    pickups: [], // objets au sol : { id, kind: 'obol' | 'potion', x, z, amount }
    hazards: [], // zones dangereuses au sol (lave, âmes) : { id, x, z, r, warn, life, damage, every, timer }
    chests: [], // coffres : { id, x, z, opened }
    // Ce qui s'est passé pendant le DERNIER pas (coups, morts…), pour que le rendu
    // affiche des effets. Vidé à chaque pas : ce n'est pas une mémoire de la partie.
    events: [],
  };
  enterFloor(state, 0);
  // Pacte de Charon : la partie commence par le choix d'un bienfait
  if (state.players.some((p) => rankOf(p.meta, 'pact'))) startPact(state);
  return state;
}

// Un héros, avec ses améliorations permanentes (même graine + mêmes rangs = même partie)
function createPlayer(id, rawMeta, rawCls) {
  const cls = classOf(rawCls);
  const meta = cleanMeta({ ...rawMeta, cls });
  const maxHp =
    classRules(cls).maxHp + metaValue(meta, 'vigor') + metaValue(meta, 'bulwark') + Math.floor(attrValue(meta, 'demeter'));
  return {
    id, // indice du joueur (0 = premier)
    x: 0,
    z: 0,
    vx: 0, // vitesse (m/s)
    vz: 0,
    facing: 0, // orientation (radians, 0 = vers le sud, z croissant)
    hp: maxHp,
    maxHp,
    cls, // classe du héros (arme, PV)
    meta, // attributs et talents permanents (lus par playerStats)
    gold: metaValue(meta, 'purse'), // oboles (chacun sa bourse ; perdues à la fin de la partie)
    offer: null, // écran de Charon : { boons: [ids], rerolls, free, start } tant que le choix n'est pas fait
    // Co-op : à terre (pas restants avant de disparaître jusqu'à l'étage suivant), hors jeu
    down: 0,
    out: false,
    revive: 0, // progression du relèvement par un allié (pas)
    defiance: rankOf(meta, 'defiance') > 0 ? 1 : 0, // relèvements restants (Défi de la Mort)
    // Compteurs en pas de simulation (0 = inactif)
    attackTimer: 0, // durée restante du coup en cours
    attackCooldown: 0,
    dashTimer: 0, // durée restante de l'esquive en cours
    dashCooldown: 0, // recharge de la prochaine esquive
    dashCharges: 1 + rankOf(meta, 'doubleDash'), // esquives disponibles
    rage: 0, // Rage d'Arès : pas restants de cadence accrue
    afterDash: 0, // Élan : pas restants pendant lesquels le prochain coup est renforcé
    danceHits: [], // Danse des lames : ennemis déjà frappés par l'esquive en cours
    dashX: 0, // direction de l'esquive
    dashZ: 0,
    dashHeld: false, // bouton d'esquive déjà enfoncé au pas précédent (une esquive par appui)
    specialCooldown: 0, // recharge de la capacité spéciale (pas)
    specialHeld: false, // bouton déjà enfoncé au pas précédent (une capacité par appui)
    specialEcho: 0, // Tempête / Seconde salve : pas avant la seconde frappe
    echoFacing: 0, // direction de la seconde salve
    riposte: false, // Riposte : prochain coup renforcé après une parade
    hunt: 0, // Instinct de chasse : pas restants de vitesse et de cadence accrues
    invuln: 0, // invulnérabilité restante
    boons: {}, // bienfaits possédés : { id: nombre }
    killsSinceHeal: 0, // pour le Tribut d'Hadès
  };
}

// Joueur en état de se battre (ni à terre, ni hors jeu jusqu'à l'étage suivant)
export function isActive(p) {
  return p.down === 0 && !p.out;
}

// Joueur actif le plus proche d'un point (null si aucun) : la cible des ennemis
export function nearestPlayer(state, x, z) {
  let best = null;
  let bd = Infinity;
  for (const p of state.players) {
    if (!isActive(p)) continue;
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

// Génère l'étage demandé, le peuple et place le joueur au départ
export function enterFloor(state, floorIndex) {
  state.floorIndex = floorIndex;
  const boss = bossOf(floorIndex);
  state.dungeon = boss
    ? generateBossFloor(state.seed, floorIndex, boss)
    : generateFloor(state.seed, floorIndex, state.options.dungeonParams || undefined);
  const s = state.dungeon.start;
  state.players.forEach((p, i) => {
    // Le second héros apparaît sur une case voisine praticable
    const spot = i === 0 ? s : startSpot(state.dungeon, s, i);
    p.x = spot.c + 0.5;
    p.z = spot.r + 0.5;
    p.vx = 0;
    p.vz = 0;
    p.dashTimer = 0;
    // Co-op : un héros tombé revient au nouvel étage, avec la moitié de sa vie
    if (p.out || p.down > 0) {
      p.out = false;
      p.down = 0;
      p.revive = 0;
      p.hp = Math.max(1, Math.ceil(p.maxHp * SIM.coop.returnHp));
    }
  });

  state.projectiles = [];
  state.enemies = [];
  state.lock = null;
  state.pickups = [];
  state.hazards = [];
  // Un coffre au centre de chaque salle au trésor
  state.chests = state.dungeon.rooms
    .filter((r) => r.type === 'treasure')
    .map((r) => ({ id: state.nextId++, x: r.x + Math.floor(r.w / 2) + 0.5, z: r.y + Math.floor(r.h / 2) + 0.5, opened: false }));
  if (state.options.enemies) {
    for (const e of populateFloor(state.dungeon, state.seed, floorIndex)) {
      state.enemies.push(createEnemy(state, e));
    }
  }
}

export function createEnemy(state, { type, x, z, roomId = -1, firstShotDelay = 0, elite = false, boss = false, slot = -1 }) {
  // Caractéristiques selon l'étage, le statut d'élite et le nombre de joueurs (cf. src/systems/difficulty.js)
  const stats = enemyStats(type, state.floorIndex, elite, state.players.length);
  return {
    id: state.nextId++,
    type,
    x,
    z,
    kvx: 0, // vitesse de recul (après un coup reçu)
    kvz: 0,
    facing: 0,
    elite,
    boss,
    // Partie de boss (tête d'Hydre, double de Thanatos) : pas de barre de vie, pas de butin
    part: type === 'hydraHead' || type === 'thanatosDouble',
    slot, // emplacement d'une tête d'Hydre autour du corps
    stats,
    hp: stats.hp,
    maxHp: stats.hp,
    roomId,
    alert: false, // a repéré le héros (ne l'oublie plus ensuite)
    mode: 'idle', // 'idle' | 'chase' | 'windup' | 'recover'
    timer: 0, // pas restants dans le mode courant
    shotCooldown: type === 'archer' ? ticks(0.6) + firstShotDelay : 0,
    aimX: 0, // direction figée pendant la préparation d'un coup / d'un tir
    aimZ: 0,
    hitFlash: 0, // pas restants de clignotement (pour le rendu)
  };
}

// Case de départ d'un héros supplémentaire : la plus proche du départ, praticable
function startSpot(dungeon, s, i) {
  const around = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let k = 0; k < around.length; k++) {
    const [dc, dr] = around[(k + i - 1) % around.length];
    if (isWalkable(tileAt(dungeon, s.c + dc, s.r + dr))) return { c: s.c + dc, r: s.r + dr };
  }
  return s;
}
