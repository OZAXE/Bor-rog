// Réglages des RÈGLES du jeu (simulation). Séparés de src/config.js, qui contient
// les réglages d'affichage et de contrôle : un serveur multijoueur n'aura besoin que de ceux-ci.

export const SIM = {
  tickRate: 60, // pas de simulation par seconde
  stairsRadius: 0.45, // distance au centre de l'escalier pour descendre (m)

  player: {
    radius: 0.35, // rayon de collision (m) : passe à l'aise dans un couloir de 2 cases
    speed: 5.5, // vitesse de marche (m/s)
    acceleration: 45, // m/s² : pleine vitesse en ~0,12 s
    deceleration: 60, // m/s² : arrêt en ~0,09 s
  },
};
