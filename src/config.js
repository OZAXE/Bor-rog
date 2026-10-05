// Constantes centrales du jeu : tout ce qui se règle se trouve ici.

export const CONFIG = {
  // Fréquence de la simulation (pas fixe)
  tickRate: 60,

  render: {
    // Un écran x3 rendrait 9 fois plus de pixels qu'en x1 : on plafonne
    maxPixelRatioMobile: 1.5,
    maxPixelRatioDesktop: 2,
    background: 0x0d0b10, // noir légèrement violacé : le "vide" autour du donjon
  },

  camera: {
    fov: 45,
    // Caméra plongeante : distance au joueur et angle par rapport au sol
    distance: 14,
    pitch: 0.95, // radians (~55°) : assez haut pour voir la salle, assez bas pour le relief
    yaw: 0, // la caméra regarde toujours dans la même direction (pas de rotation)
  },

  dungeon: {
    tileSize: 1, // une case de la grille = 1 m
    wallHeight: 1.6, // murs "normaux"
  },
};
