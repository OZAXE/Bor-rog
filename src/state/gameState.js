// État complet d'une partie : uniquement des données simples (nombres, textes,
// tableaux, objets), donc sérialisable en JSON. C'est ce qui permettra plus tard
// d'envoyer l'état par le réseau ou de sauvegarder une partie.

import { createRng } from '../core/rng.js';
import { generateFloor, generateBossFloor } from '../dungeon/generate.js';
import { bossOf } from '../dungeon/zones.js';
import { populateFloor } from '../dungeon/populate.js';
import { SIM, ticks } from '../systems/simConfig.js';
import { enemyStats } from '../systems/difficulty.js';
import { cleanRanks, metaValue, rankOf } from '../meta/tree.js';

export const STATE_VERSION = 6;

// options.enemies : false pour un donjon vide (tests d'exploration)
// options.dungeonParams : réglages du générateur d'étages (tests)
// options.meta : rangs de l'arbre des améliorations permanentes ({ id: rang }, cf. src/meta/tree.js)
export function createGameState(seed, options = {}) {
  // Améliorations permanentes apportées par le joueur (même graine + mêmes rangs = même partie)
  const meta = cleanRanks(options.meta);
  const maxHp = SIM.player.maxHp + metaValue(meta, 'vigor');
  const state = {
    version: STATE_VERSION,
    seed: String(seed),
    options: { enemies: options.enemies !== false, dungeonParams: options.dungeonParams || null },
    tick: 0, // nombre de pas de simulation écoulés (60 par seconde)
    status: 'playing', // 'playing', 'choosing' (écran de Charon), 'dead' ou 'victory'
    floorIndex: 0, // étage actuel (0 = premier)
    kills: 0,
    gold: metaValue(meta, 'purse'), // oboles (perdues à la fin de la partie)
    shadows: 0, // Ombres gagnées pendant la partie (gardées à la fin, cf. src/meta/profile.js)
    offer: null, // écran de Charon : { boons: [ids], rerolls } ou null
    // Générateur de la partie (combats, butin…).
    // La génération des étages a ses propres générateurs dérivés de la graine.
    rng: createRng(`${seed}/partie`),
    nextId: 1, // numéro du prochain ennemi ou projectile créé
    dungeon: null,
    player: {
      x: 0,
      z: 0,
      vx: 0, // vitesse (m/s)
      vz: 0,
      facing: 0, // orientation (radians, 0 = vers le sud, z croissant)
      hp: maxHp,
      maxHp,
      meta, // rangs de l'arbre permanent (lus par playerStats)
      defiance: rankOf(meta, 'defiance') > 0 ? 1 : 0, // relèvements restants (Défi de la Mort)
      // Compteurs en pas de simulation (0 = inactif)
      attackTimer: 0, // durée restante du coup en cours
      attackCooldown: 0,
      dashTimer: 0, // durée restante de l'esquive en cours
      dashCooldown: 0, // recharge de la prochaine esquive
      dashCharges: 1 + rankOf(meta, 'doubleDash'), // esquives disponibles
      dashX: 0, // direction de l'esquive
      dashZ: 0,
      dashHeld: false, // bouton d'esquive déjà enfoncé au pas précédent (une esquive par appui)
      invuln: 0, // invulnérabilité restante
      boons: {}, // bienfaits possédés : { id: nombre }
      killsSinceHeal: 0, // pour le Tribut d'Hadès
    },
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
  return state;
}

// Génère l'étage demandé, le peuple et place le joueur au départ
export function enterFloor(state, floorIndex) {
  state.floorIndex = floorIndex;
  const boss = bossOf(floorIndex);
  state.dungeon = boss
    ? generateBossFloor(state.seed, floorIndex, boss)
    : generateFloor(state.seed, floorIndex, state.options.dungeonParams || undefined);
  const s = state.dungeon.start;
  const p = state.player;
  p.x = s.c + 0.5;
  p.z = s.r + 0.5;
  p.vx = 0;
  p.vz = 0;
  p.dashTimer = 0;

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
  // Caractéristiques selon l'étage et le statut d'élite (cf. src/systems/difficulty.js)
  const stats = enemyStats(type, state.floorIndex, elite);
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
