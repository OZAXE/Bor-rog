// Réglages d'AFFICHAGE et de CONTRÔLE. Les règles du jeu sont dans src/systems/simConfig.js.

export const CONFIG = {
  render: {
    // Un écran x3 rendrait 9 fois plus de pixels qu'en x1 : on plafonne
    maxPixelRatioMobile: 1.5,
    maxPixelRatioDesktop: 2,
    background: 0x05080a, // vide des enfers : noir bleuté
  },

  // Caméra isométrique (projection orthographique : pas de perspective, comme Hades)
  camera: {
    yaw: Math.PI / 4, // en diagonale : la caméra est au sud-est et regarde vers le nord-ouest
    pitch: 0.8, // inclinaison (radians, ~46°) : assez haut pour voir le sol entre les murs
    viewSize: 13, // hauteur de terrain visible à l'écran (m) en paysage
    minViewWidth: 9, // largeur minimale visible (m) en portrait
    distance: 30, // recul (n'influence pas la taille en orthographique, seulement le découpage)
  },

  // Aspect du donjon (la forme des étages est réglée dans src/dungeon/generate.js)
  dungeon: {
    wallHeight: 1.8, // murs du fond
    lowWallHeight: 0.42, // murs côté caméra, abaissés pour ne pas cacher le héros
    flameHeight: 1.2, // hauteur des flammes accrochées aux murs
    colors: {
      ink: 0x05080a,
      column: 0x5f7f7a,
      bronze: 0x3b2f1f,
      debris: 0x3d5355,
      flameOuter: 0x2fff86, // vert spectral
      flameInner: 0xd9ffe6,
      stairsRim: 0xf2c96b, // or
    },
  },

  // Éclairage : peu de lumières, contraste fort
  lights: {
    ambientSky: 0x7fa6b0,
    ambientGround: 0x0a1013,
    ambientIntensity: 1.0,
    keyColor: 0xcfe8ff, // lumière froide venant du haut
    keyIntensity: 0.55,
  },

  // Lumière qui accompagne le héros (la SEULE lumière ponctuelle de la scène)
  heroLight: {
    color: 0xffe2b0,
    intensity: 18,
    distance: 9,
    height: 3.2,
  },

  // Contrôles
  controls: {
    joystickRadius: 50, // px : course max du joystick virtuel
    deadZone: 0.12, // zone morte au centre du joystick (fraction du rayon)
  },
};
