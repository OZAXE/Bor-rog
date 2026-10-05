// Construction du maillage fixe d'un étage (sol + murs) en UN SEUL objet.
//
// Pourquoi un seul objet ? Sur mobile, ce qui coûte cher n'est pas tant le nombre
// de triangles que le nombre d'"appels de dessin" (un par objet). Ici, tout le
// décor fixe de l'étage = 1 appel, avec une seule texture (un "atlas" qui contient
// les dalles, la face des murs et le dessus des murs).
//
// Ce module ne dépend pas de Three.js : il produit de simples tableaux de nombres
// (positions, normales, coordonnées de texture, couleurs, indices). On peut donc
// le tester dans Node.
//
// La caméra est fixe, au sud-est, tournée vers le nord-ouest : on ne construit que
// les faces qu'elle peut voir (dessus, faces sud et est). Les faces nord et ouest
// ne sont jamais visibles : les omettre divise presque par deux le nombre de murs.

import { TILE, isLowWall, tileAt } from '../dungeon/tiles.js';

// Organisation de l'atlas : grille de 4 × 4 cases (cf. src/render/textures.js)
export const ATLAS = {
  size: 1024,
  grid: 4,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0], // dalle gravée (plus rare)
  ],
  wallFace: [0, 1],
  wallTop: [1, 1],
};

export const DEFAULT_MESH_OPTIONS = {
  tallHeight: 1.8, // hauteur des murs du fond
  lowHeight: 0.42, // hauteur des murs côté caméra
  glowRadius: 4.5, // rayon de la lueur des flammes (m)
  glowColor: [0.45, 1.25, 0.75], // vert spectral (multiplie la texture)
  glowStrength: 0.85,
  floorAO: 0.16, // assombrissement du sol au pied des murs (ombre de contact)
  wallBaseShade: 0.5, // luminosité du bas des murs (le haut vaut 1)
  debug: false, // conserve la liste des faces (pour les tests)
};

export function buildDungeonMesh(dungeon, options = {}) {
  const o = { ...DEFAULT_MESH_OPTIONS, ...options };
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const faces = o.debug ? [] : null;
  const stats = { floorQuads: 0, wallTops: 0, wallFaces: 0 };

  const torches = dungeon.decor.filter((d) => d.kind === 'torch').map(torchLightOrigin);

  // Intensité de lueur (0..1) en un point du sol
  const glowAt = (x, z) => {
    let g = 0;
    for (const t of torches) {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < o.glowRadius) g += (1 - d / o.glowRadius) ** 2;
    }
    return Math.min(g, 1);
  };
  // Couleur de sommet = ombrage × teinte de la lueur
  const tint = (shade, x, z) => {
    const g = glowAt(x, z) * o.glowStrength;
    return [
      shade * (1 + (o.glowColor[0] - 1) * g),
      shade * (1 + (o.glowColor[1] - 1) * g),
      shade * (1 + (o.glowColor[2] - 1) * g),
    ];
  };

  const height = (c, r) => {
    if (tileAt(dungeon, c, r) !== TILE.WALL) return 0;
    return isLowWall(dungeon, c, r) ? o.lowHeight : o.tallHeight;
  };
  const isBlocker = (c, r) => {
    const t = tileAt(dungeon, c, r);
    return t === TILE.WALL || t === TILE.PILLAR;
  };

  // Ajoute un quadrilatère (p0 bas-gauche, p1 bas-droite, p2 haut-droite, p3 haut-gauche,
  // vus de face), avec ses coordonnées de texture (u0..u1, vBottom..vTop) et 4 couleurs
  function quad(p, n, uv, cols) {
    const base = positions.length / 3;
    for (let k = 0; k < 4; k++) {
      positions.push(p[k][0], p[k][1], p[k][2]);
      normals.push(n[0], n[1], n[2]);
      colors.push(cols[k][0], cols[k][1], cols[k][2]);
    }
    const [u0, u1, vb0, vb1, vt1, vt0] = uv;
    uvs.push(u0, vb0, u1, vb1, u1, vt1, u0, vt0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  for (let r = 0; r < dungeon.height; r++) {
    for (let c = 0; c < dungeon.width; c++) {
      const t = tileAt(dungeon, c, r);

      // ---------- Sol (aussi sous les piliers ; pas sous l'escalier : c'est un trou) ----------
      if (t === TILE.FLOOR || t === TILE.PILLAR) {
        const cell = cellRect(ATLAS.floor[floorVariant(c, r)]);
        // Ombre de contact : chaque coin est d'autant plus sombre qu'il touche de murs
        const cornerShade = (x, z) => {
          let n = 0;
          for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
            if (isBlocker(x + dc, z + dr)) n++;
          }
          return 1 - o.floorAO * n;
        };
        const corners = [
          [c, 0, r + 1],
          [c + 1, 0, r + 1],
          [c + 1, 0, r],
          [c, 0, r],
        ];
        quad(
          corners,
          [0, 1, 0],
          [cell.u0, cell.u1, cell.v0, cell.v0, cell.v1, cell.v1],
          corners.map(([x, , z]) => tint(cornerShade(x, z), x, z)),
        );
        stats.floorQuads++;
        if (faces) faces.push({ kind: 'floor', c, r });
      }

      if (t !== TILE.WALL) continue;
      const h = height(c, r);

      // ---------- Dessus du mur ----------
      const top = cellRect(ATLAS.wallTop);
      const topCorners = [
        [c, h, r + 1],
        [c + 1, h, r + 1],
        [c + 1, h, r],
        [c, h, r],
      ];
      quad(
        topCorners,
        [0, 1, 0],
        [top.u0, top.u1, top.v0, top.v0, top.v1, top.v1],
        topCorners.map(([x, , z]) => tint(1, x, z)),
      );
      stats.wallTops++;

      // ---------- Faces sud (+z) et est (+x), seulement là où le voisin est plus bas ----------
      const face = cellRect(ATLAS.wallFace);
      // La texture est calée sur le HAUT du mur : un mur bas montre la frise du haut
      const vAt = (y) => face.v1 - ((h - y) / o.tallHeight) * (face.v1 - face.v0);
      const shadeAt = (y) => o.wallBaseShade + (1 - o.wallBaseShade) * (y / o.tallHeight);

      const southH = height(c, r + 1);
      if (southH < h) {
        const z = r + 1;
        const p = [
          [c, southH, z],
          [c + 1, southH, z],
          [c + 1, h, z],
          [c, h, z],
        ];
        quad(
          p,
          [0, 0, 1],
          [face.u0, face.u1, vAt(southH), vAt(southH), vAt(h), vAt(h)],
          p.map(([x, y]) => tint(shadeAt(y), x, z + 0.5)),
        );
        stats.wallFaces++;
        if (faces) faces.push({ kind: 'south', c, r, y0: southH, y1: h });
      }

      const eastH = height(c + 1, r);
      if (eastH < h) {
        const x = c + 1;
        const p = [
          [x, eastH, r + 1],
          [x, eastH, r],
          [x, h, r],
          [x, h, r + 1],
        ];
        quad(
          p,
          [1, 0, 0],
          [face.u0, face.u1, vAt(eastH), vAt(eastH), vAt(h), vAt(h)],
          p.map(([px, y, pz]) => tint(shadeAt(y), px + 0.5, pz)),
        );
        stats.wallFaces++;
        if (faces) faces.push({ kind: 'east', c, r, y0: eastH, y1: h });
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    stats,
    faces,
  };
}

// Point d'où part la lumière d'une flamme : un peu devant la face du mur
export function torchLightOrigin(t) {
  return t.face === 'east' ? { x: t.c + 1.3, z: t.r + 0.5 } : { x: t.c + 0.5, z: t.r + 1.3 };
}

// Rectangle de texture d'une case de l'atlas. Petite marge intérieure pour que le
// filtrage de la carte graphique ne "bave" pas sur la case voisine.
export function cellRect([col, row]) {
  const n = ATLAS.grid;
  const pad = 3 / ATLAS.size;
  return {
    u0: col / n + pad,
    u1: (col + 1) / n - pad,
    v1: 1 - row / n - pad, // haut de la case (la texture est retournée à l'affichage)
    v0: 1 - (row + 1) / n + pad,
  };
}

// Choix stable d'une variante de dalle selon la position (la dalle gravée est rare)
export function floorVariant(c, r) {
  const v = hash2(c, r);
  if (v < 0.04) return 3;
  return Math.floor(hash2(c * 7 + 3, r * 13 + 1) * 3);
}

// Pseudo-hasard visuel stable à partir d'une position (n'influence pas le jeu)
export function hash2(a, b) {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
