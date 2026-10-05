// Ambiance visuelle de chaque zone : palette de l'atlas (dessiné en code), teinte
// de la lueur des flammes, couleurs des objets et de l'éclairage.
// Purement visuel : la simulation ne connaît que l'identifiant de la zone.

import { PALETTE } from './textures.js';

export const ZONE_THEMES = {
  // Le Tartare : pierre froide bleu-vert, flammes vert spectral
  tartarus: {
    palette: PALETTE,
    glowColor: [0.45, 1.25, 0.75],
    background: 0x05080a,
    colors: { column: 0x5f7f7a, bronze: 0x3b2f1f, debris: 0x3d5355, flameOuter: 0x2fff86, flameInner: 0xd9ffe6 },
    lights: { sky: 0x7fa6b0, ground: 0x0a1013, ambient: 1.0, key: 0xcfe8ff, keyIntensity: 0.55, hero: 0xffe2b0 },
  },
  // L'Asphodèle : basalte noir, fissures de lave, braises orange
  asphodel: {
    palette: {
      ink: '#070303',
      floor: ['#3a2a26', '#33241f', '#40302a'],
      floorLight: 'rgba(255, 170, 110, 0.10)',
      wall: '#2c1c19',
      wallLight: '#4a2e26',
      frieze: '#c46a35',
      friezeBand: '#1c0d0a',
      top: '#5a3a30',
      engraving: 'rgba(255, 120, 40, 0.28)',
    },
    glowColor: [1.45, 0.8, 0.45],
    background: 0x0b0403,
    colors: { column: 0x6a4a40, bronze: 0x2a1a12, debris: 0x4a3530, flameOuter: 0xff7a2f, flameInner: 0xffe0b0 },
    lights: { sky: 0xc08a70, ground: 0x140806, ambient: 0.95, key: 0xffc9a0, keyIntensity: 0.55, hero: 0xffd2a0 },
  },
  // L'Élysée : marbre clair, or, lumière blanche
  elysium: {
    palette: {
      ink: '#3a3226',
      floor: ['#cfc6b2', '#c5bca8', '#d8d0be'],
      floorLight: 'rgba(255, 250, 230, 0.25)',
      wall: '#b3a990',
      wallLight: '#d6cdb6',
      frieze: '#c9a24a',
      friezeBand: '#8a7a58',
      top: '#e6dfcc',
      engraving: 'rgba(255, 215, 120, 0.35)',
    },
    glowColor: [1.2, 1.12, 0.85],
    background: 0x1d1a14,
    colors: { column: 0xe8e1cf, bronze: 0x8a6a2c, debris: 0xbdb39b, flameOuter: 0xffe9a8, flameInner: 0xffffff },
    lights: { sky: 0xfff4d8, ground: 0x3a3428, ambient: 0.75, key: 0xfff0d0, keyIntensity: 0.45, hero: 0xfff2d0 },
  },
};
