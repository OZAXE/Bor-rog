import * as THREE from 'three';
import { ATLAS } from './dungeonMesh.js';
import { createRng, nextFloat, nextRange, nextInt } from '../core/rng.js';

// Textures dessinées par le code (aucun fichier image) sur des <canvas>.
//
// Ambiance "enfers grecs" : pierre froide bleu-vert, joints sombres comme un trait
// d'encre, frise grecque (méandre) en haut des murs, lueurs vert spectral.
// Le hasard utilisé ici ne sert qu'au dessin ; il passe quand même par notre
// générateur à graine fixe pour que le jeu ait toujours exactement le même aspect.

export const PALETTE = {
  ink: '#05080a', // traits et joints : presque noir
  floor: ['#2f4a4f', '#2b4448', '#33504f'], // dalles : ardoise bleu-vert
  floorLight: 'rgba(170, 230, 220, 0.10)', // reflet sur l'arête des dalles
  wall: '#24363a', // blocs des murs
  wallLight: '#3a5357',
  frieze: '#6f9a8e', // méandre : bronze vert-de-gris
  friezeBand: '#162427',
  top: '#4a6662', // dessus des murs
  engraving: 'rgba(120, 255, 190, 0.16)', // gravure lumineuse des dalles rares
};

const CELL = ATLAS.size / ATLAS.grid;

// Palette en cours de dessin (chaque zone a la sienne, cf. src/render/zoneThemes.js)
let P = PALETTE;

export function createAtlasTexture(palette = PALETTE) {
  P = palette;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS.size;
  const g = canvas.getContext('2d');
  const rng = createRng('atlas-enfers');

  ATLAS.floor.forEach((cell, i) => drawFloor(g, cellOrigin(cell), rng, i));
  drawWallFace(g, cellOrigin(ATLAS.wallFace), rng);
  drawWallTop(g, cellOrigin(ATLAS.wallTop), rng);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Halo lumineux rond (dégradé radial), utilisé en mélange additif pour simuler
// la lueur des flammes sans le coûteux effet "bloom"
export function createHaloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Rampe d'éclairage "cel shading" (3 paliers nets) pour les personnages
export function createToonGradient() {
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Dessin des cases de l'atlas
// ---------------------------------------------------------------------------

function cellOrigin([col, row]) {
  return { x: col * CELL, y: row * CELL };
}

// Dalle : 2 × 2 carreaux biseautés, joints d'encre, grain et fissures
function drawFloor(g, o, rng, variant) {
  g.save();
  g.translate(o.x, o.y);
  g.fillStyle = P.ink;
  g.fillRect(0, 0, CELL, CELL);

  const half = CELL / 2;
  const joint = 5;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const x = tx * half + joint / 2;
      const y = ty * half + joint / 2;
      const s = half - joint;
      g.fillStyle = P.floor[(variant + tx + ty * 2) % P.floor.length];
      g.fillRect(x, y, s, s);
      // Biseau : arête claire en haut à gauche, sombre en bas à droite
      g.fillStyle = P.floorLight;
      g.fillRect(x, y, s, 3);
      g.fillRect(x, y, 3, s);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, y + s - 3, s, 3);
      g.fillRect(x + s - 3, y, 3, s);
    }
  }

  speckle(g, rng, 900, 0.07);

  // Fissures : quelques traits brisés
  const cracks = variant === 3 ? 0 : nextInt(rng, 0, 2);
  for (let k = 0; k < cracks; k++) {
    g.strokeStyle = 'rgba(5, 8, 10, 0.75)';
    g.lineWidth = 1.5;
    g.beginPath();
    let x = nextRange(rng, 20, CELL - 20);
    let y = nextRange(rng, 20, CELL - 20);
    g.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += nextRange(rng, -22, 22);
      y += nextRange(rng, -22, 22);
      g.lineTo(x, y);
    }
    g.stroke();
  }

  // Variante rare : rosace gravée qui luit faiblement
  if (variant === 3) {
    g.strokeStyle = P.engraving;
    g.lineWidth = 3;
    const c = CELL / 2;
    g.beginPath();
    g.arc(c, c, CELL * 0.3, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(c, c, CELL * 0.17, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * CELL * 0.17, c + Math.sin(a) * CELL * 0.17);
      g.lineTo(c + Math.cos(a) * CELL * 0.3, c + Math.sin(a) * CELL * 0.3);
      g.stroke();
    }
  }
  g.restore();
}

// Face de mur : frise grecque en haut (c'est la partie visible des murs bas),
// puis assises de blocs de pierre décalées
function drawWallFace(g, o, rng) {
  g.save();
  g.translate(o.x, o.y);
  g.fillStyle = P.ink;
  g.fillRect(0, 0, CELL, CELL);

  // La face fait 1,8 m de haut pour 1 m de large : la case est étirée verticalement
  // à l'affichage, donc on dessine des blocs "écrasés" qui reprendront leurs proportions.
  const bandH = CELL * 0.2;
  // Frise : bandeau sombre + méandre clair
  g.fillStyle = P.friezeBand;
  g.fillRect(0, 0, CELL, bandH);
  g.fillStyle = P.frieze;
  g.fillRect(0, 2, CELL, 3);
  g.fillRect(0, bandH - 5, CELL, 3);
  drawMeander(g, 0, 9, CELL, bandH - 18, 4);

  // Blocs de pierre
  const rows = 5;
  const rowH = (CELL - bandH) / rows;
  for (let k = 0; k < rows; k++) {
    const y = bandH + k * rowH;
    const offset = k % 2 === 0 ? 0 : CELL / 4;
    for (let x = -CELL / 2 + offset; x < CELL; x += CELL / 2) {
      g.fillStyle = k % 2 ? P.wall : '#22333a';
      g.fillRect(x + 2, y + 2, CELL / 2 - 4, rowH - 4);
      g.fillStyle = 'rgba(160, 220, 210, 0.08)';
      g.fillRect(x + 2, y + 2, CELL / 2 - 4, 2);
    }
  }
  speckle(g, rng, 700, 0.08);
  g.restore();
}

// Dessus de mur : dalle claire cernée d'un trait d'encre (lisibilité des contours)
function drawWallTop(g, o, rng) {
  g.save();
  g.translate(o.x, o.y);
  g.fillStyle = P.ink;
  g.fillRect(0, 0, CELL, CELL);
  g.fillStyle = P.top;
  g.fillRect(6, 6, CELL - 12, CELL - 12);
  g.fillStyle = 'rgba(200, 255, 240, 0.10)';
  g.fillRect(6, 6, CELL - 12, 4);
  speckle(g, rng, 500, 0.08);
  g.restore();
}

// Méandre grec (motif "à la grecque") répété sur la largeur
function drawMeander(g, x0, y0, width, h, units) {
  const u = width / units;
  g.strokeStyle = P.frieze;
  g.lineWidth = Math.max(2, h * 0.11);
  g.lineCap = 'square';
  for (let k = 0; k < units; k++) {
    const x = x0 + k * u;
    g.beginPath();
    g.moveTo(x, y0 + h);
    g.lineTo(x, y0);
    g.lineTo(x + u * 0.75, y0);
    g.lineTo(x + u * 0.75, y0 + h * 0.75);
    g.lineTo(x + u * 0.3, y0 + h * 0.75);
    g.lineTo(x + u * 0.3, y0 + h * 0.35);
    g.lineTo(x + u * 0.5, y0 + h * 0.35);
    g.stroke();
    g.beginPath();
    g.moveTo(x, y0 + h);
    g.lineTo(x + u, y0 + h);
    g.stroke();
  }
}

// Grain de la pierre : petits points clairs et sombres
function speckle(g, rng, count, alpha) {
  for (let k = 0; k < count; k++) {
    const light = nextFloat(rng) < 0.5;
    g.fillStyle = light ? `rgba(200,240,230,${alpha})` : `rgba(0,0,0,${alpha * 1.6})`;
    const s = nextFloat(rng) < 0.85 ? 1.5 : 3;
    g.fillRect(nextFloat(rng) * CELL, nextFloat(rng) * CELL, s, s);
  }
}
