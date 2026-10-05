// Constantes centrales du jeu : tout ce qui se règle se trouve ici.

export const CONFIG = {
  // Fréquence de la simulation : voir src/systems/simConfig.js (SIM.tickRate)

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

  // Aspect du donjon (la forme des étages est réglée dans src/dungeon/generate.js)
  dungeon: {
    wallHeight: 1.6, // murs "normaux"
    lowWallHeight: 0.35, // murs côté caméra, abaissés pour ne pas cacher le héros
    pillarHeight: 1.5,
    torchGlowRadius: 4.5, // rayon de la lueur "peinte" autour des torches (m)
    colors: {
      floor: 0x3a333f,
      wall: 0x6b5f55,
      pillar: 0x7a6e63,
      debris: 0x55504c,
      torchGlow: 0xb5712f,
      flame: 0xffb347,
      stairsRim: 0xffd27a,
    },
  },

  // Lumière qui accompagne le héros (la SEULE lumière ponctuelle de la scène)
  heroLight: {
    color: 0xffb36b,
    intensity: 16,
    distance: 9,
    height: 3.2, // assez haut pour ne pas "brûler" la tête du héros
  },

  // Contrôles
  controls: {
    joystickRadius: 50, // px : course max du joystick virtuel
    deadZone: 0.12, // zone morte au centre du joystick (fraction du rayon)
  },
};
