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
  },

  // Peuplement des étages
  spawn: {
    basePerRoom: 2, // ennemis par salle de combat au premier étage
    perFloor: 1, // ennemis supplémentaires par salle à chaque étage
    perArea: 45, // +1 ennemi par tranche de 45 cases de surface de salle
    maxPerRoom: 8,
    archerChance: 0.25, // proportion d'archers au premier étage
    archerChancePerFloor: 0.07,
    maxArcherChance: 0.5,
    safeDistance: 4, // aucun ennemi à moins de 4 cases du départ
  },
};

// Convertit une durée en secondes en nombre de pas de simulation
export function ticks(seconds) {
  return Math.round(seconds * SIM.tickRate);
}
