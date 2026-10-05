// Réglages des RÈGLES du jeu (simulation). Séparés de src/config.js, qui contient
// les réglages d'affichage et de contrôle : un serveur multijoueur n'aura besoin que de ceux-ci.
//
// Les durées sont en secondes ici ; la simulation les convertit en nombre de pas
// (ticks, 60 par seconde) avec ticks() : compter des pas entiers évite toute
// dérive d'arrondi et garde la partie parfaitement reproductible.

export const SIM = {
  tickRate: 60, // pas de simulation par seconde
  stairsRadius: 0.45, // distance au centre de l'escalier pour descendre (m)

  player: {
    radius: 0.35, // rayon de collision (m) : passe à l'aise dans un couloir de 2 cases
    speed: 5.5, // vitesse de marche (m/s)
    acceleration: 45, // m/s² : pleine vitesse en ~0,12 s
    deceleration: 60, // m/s² : arrêt en ~0,09 s
    maxHp: 10,
    hurtInvuln: 0.8, // invulnérabilité après un coup reçu (s) : évite de mourir d'un enchaînement

    attack: {
      range: 1.6, // portée de l'arc de coup, depuis le centre du héros (m)
      arc: 2.1, // ouverture de l'arc (radians, ~120°)
      damage: 1,
      duration: 0.18, // durée de l'animation de coup (s), pendant laquelle on marche moins vite
      cooldown: 0.32, // délai mini entre deux coups (s)
      moveFactor: 0.45, // vitesse de marche pendant le coup (fraction)
      knockback: 7, // vitesse de recul donnée à l'ennemi touché (m/s)
      autoAimRange: 4, // sans visée (mobile) : vise l'ennemi le plus proche dans ce rayon (m)
    },

    dash: {
      speed: 15, // m/s
      duration: 0.17, // s → ~2,5 m parcourus
      cooldown: 0.55, // s, compté à partir du début de l'esquive
      invuln: 0.22, // s d'invulnérabilité (un peu plus que l'esquive elle-même)
    },
  },

  enemies: {
    knockbackDecay: 30, // freinage du recul (m/s²)

    // L'Ombre : fonce sur le héros, s'arrête, PRÉVIENT (marquage au sol), puis frappe
    shade: {
      radius: 0.33,
      hp: 3,
      speed: 3.3,
      aggroRange: 7.5, // distance de repérage (il faut aussi une ligne de vue)
      attackRange: 1.15, // distance à laquelle elle commence à préparer son coup
      windup: 0.5, // préparation (s) : la fenêtre pour esquiver
      strikeRange: 1.45, // portée du coup au moment où il part
      strikeArc: 1.9, // ouverture du coup (radians)
      damage: 2,
      lunge: 5, // petit bond en avant en frappant (m/s)
      recover: 0.7, // temps mort après le coup (s) : la fenêtre pour riposter
    },

    // Le Squelette archer : garde ses distances et tire
    archer: {
      radius: 0.3,
      hp: 2,
      speed: 2.6,
      aggroRange: 9,
      preferMin: 3.5, // trop près : il recule
      preferMax: 6.5, // trop loin : il s'approche
      windup: 0.6, // visée (s) : ligne affichée, la direction est figée au début
      cooldown: 1.9, // délai entre deux tirs (s)
      recover: 0.3,
      arrowSpeed: 8.5, // m/s
      arrowDamage: 1,
      arrowRange: 12, // distance max parcourue par une flèche (m)
    },

    fury: {
      radius: 0.32,
      hp: 3,
      speed: 2.4, // approche lente...
      aggroRange: 9,
      chargeRange: 6.5, // distance à laquelle elle annonce sa charge
      windup: 0.75, // annonce (s) : la bande rouge montre la trajectoire
      chargeSpeed: 13, // ... charge très rapide (m/s)
      chargeDistance: 7.5, // longueur max de la charge (m)
      damage: 2,
      recover: 0.8, // étourdie après la charge (s)
      wallStun: 1.6, // étourdie plus longtemps si elle percute un mur (s)
    },
  },

  // ---------- Boss ----------
  // Leurs valeurs ne dépendent pas de l'étage (chaque boss a son étage fixe).
  bosses: {
    // Cerbère : charges (s'écrase contre murs et colonnes), triple souffle en cônes,
    // morsure de près ; à 50 % de vie, il hurle, appelle des Ombres et charge deux fois.
    cerberus: {
      name: 'Cerbère, gardien des Enfers',
      radius: 0.85,
      hp: 150,
      speed: 2.8,
      pause: [0.45, 0.9], // temps de marche entre deux attaques (s)
      keepDistance: 4.5, // pendant la pause, il ne s'approche que si le héros est plus loin
      charge: { windup: 0.9, speed: 14, maxDistance: 15, damage: 3, recover: 0.7, wallStun: 2.0 },
      breath: { windup: 0.8, range: 5.5, coneArc: 0.5, angles: [-0.8, 0, 0.8], damage: 3, recover: 0.6 },
      bite: { trigger: 2.3, windup: 0.45, range: 2.4, arc: 1.75, damage: 2, recover: 0.5 },
      phase2: { at: 0.5, howl: 1.4, adds: 4, chainWindup: 0.6 },
      reward: { obols: [28, 40], potions: 1 },
    },

    // L'Hydre de Lerne : un corps immobile entouré de têtes. Chaque tête tranchée
    // repousse, sauf si l'on frappe le corps pendant qu'elle est tranchée (moignon
    // cautérisé). À 50 % : flaques de lave annoncées et une tête de plus.
    hydra: {
      name: 'L\'Hydre de Lerne',
      radius: 1.1,
      hp: 300,
      speed: 0,
      heads: 4,
      headRing: 2.7, // distance des têtes au corps (m)
      regrow: 6, // repousse d'une tête tranchée (s)
      headCooldown: [1.25, 2.0], // pause d'une tête entre deux attaques (s)
      spit: { windup: 0.7, count: 3, spread: 0.32, speed: 7, damage: 1, range: 11 },
      bite: { trigger: 3.4, windup: 0.6, range: 3.2, arc: 1.1, damage: 2 },
      phase2: { at: 0.5, extraHeads: 1, poolEvery: [3.5, 5.0], poolRadius: 1.3, poolWarn: 1.0, poolLife: 2.0, poolDamage: 1 },
      reward: { obols: [35, 50], potions: 1 },
    },

    // Thanatos, la Mort (boss final) : faux circulaire, téléportation derrière le
    // héros, pluie d'âmes ; à 50 % deux doubles illusoires, à 25 % il s'accélère.
    thanatos: {
      name: 'Thanatos, la Mort',
      radius: 0.5,
      hp: 520,
      speed: 3.6,
      pause: [0.35, 0.7],
      keepDistance: 3.5,
      reap: { windup: 0.85, radius: 3.0, damage: 3, recover: 0.5 },
      blink: { vanish: 0.55, behind: 1.6, slashWindup: 0.4, slashRange: 2.1, slashArc: 2.0, damage: 3, recover: 0.4 },
      rain: { count: 6, spread: 3.2, radius: 1.15, warn: 1.0, damage: 2, recover: 0.6 },
      phase2: { at: 0.5, doubles: 2, doubleHp: 1, resummon: 10 },
      phase3: { at: 0.25, speed: 1.3, windup: 0.75 },
      reward: { obols: [0, 0], potions: 0 },
    },
  },

  // Peuplement des étages
  spawn: {
    basePerRoom: 2, // ennemis par salle de combat au premier étage
    perFloor: 1, // ennemis supplémentaires par salle à chaque étage
    perArea: 45, // +1 ennemi par tranche de 45 cases de surface de salle
    maxPerRoom: 8,
    archerChance: 0.25, // proportion d'archers au premier étage
    archerChancePerFloor: 0.03,
    maxArcherChance: 0.35, // plafonds archers + Furies : il reste toujours au moins 35 % d'Ombres
    safeDistance: 4, // aucun ennemi à moins de 4 cases du départ
    furyFromFloor: 2, // les Furies apparaissent à partir du 3e étage (index 2)...
    furyChance: 0.18, // ... avec cette proportion
    furyChancePerFloor: 0.03,
    maxFuryChance: 0.3,
  },
};

// Butin et économie (oboles = la monnaie que l'on payait au passeur Charon)
SIM.loot = {
  pickupRadius: 0.55, // distance de ramassage (m)
  magnetRadius: 2.2, // les oboles sont attirées vers le héros dans ce rayon (m)
  magnetSpeed: 7, // m/s
  potionHeal: 3,
  // Ce que lâche un ennemi vaincu
  enemyObolChance: 0.55,
  enemyObols: [1, 3],
  enemyPotionChance: 0.07,
  // Récompense au centre d'une salle purifiée
  roomObols: [4, 9],
  roomPotionChance: 0.3,
  // Coffre d'une salle au trésor
  chestObols: [12, 22],
  chestPotionChance: 0.7,
  // Chez Charon, entre deux étages
  healCost: 15,
  healAmount: 4,
  rerollCost: 8, // puis +4 à chaque relance sur le même écran
  rerollCostStep: 4,
  boonChoices: 3,
};

// Les boss sont aussi des "ennemis" pour les collisions et la séparation
for (const [id, b] of Object.entries(SIM.bosses)) {
  SIM.enemies[id] = { radius: b.radius, hp: b.hp, speed: b.speed, aggroRange: 0, windup: 0, recover: 0, boss: true };
}
// Parties de boss : têtes de l'Hydre (fixes) et doubles de Thanatos (illusions)
SIM.enemies.hydraHead = { radius: 0.45, hp: 10, speed: 0, aggroRange: 0, windup: 0, recover: 0, boss: true };
SIM.enemies.thanatosDouble = { radius: 0.5, hp: 1, speed: 3.6, aggroRange: 0, windup: 0, recover: 0, boss: true };

// Convertit une durée en secondes en nombre de pas de simulation
export function ticks(seconds) {
  return Math.round(seconds * SIM.tickRate);
}
