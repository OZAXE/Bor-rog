import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Salle de démonstration TEMPORAIRE (étape 1, socle).
// Elle sert à valider la chaîne de rendu, l'éclairage et l'angle de caméra.
// Elle sera remplacée à l'étape 2 par le rendu du donjon généré par graine
// (src/render/dungeonView.js), qui lira l'état du jeu.

const ROOM = [
  '###########',
  '#.........#',
  '#.........#',
  '#...#.#...#',
  '#.........#',
  '#...#.#...#',
  '#.........#',
  '#.........#',
  '#####.#####',
];

export function createPreviewRoom(scene) {
  const size = CONFIG.dungeon.tileSize;
  const h = CONFIG.dungeon.wallHeight;
  const rows = ROOM.length;
  const cols = ROOM[0].length;
  // Centre de la salle en (0, 0)
  const ox = -((cols - 1) * size) / 2;
  const oz = -((rows - 1) * size) / 2;

  const floors = [];
  const walls = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = { x: ox + c * size, z: oz + r * size, r, c };
      (ROOM[r][c] === '#' ? walls : floors).push(cell);
    }
  }

  // Une seule géométrie + InstancedMesh : 1 appel de dessin pour tout le sol,
  // 1 pour tous les murs, quel que soit le nombre de cases
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  const floorMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(size, 0.1, size),
    new THREE.MeshLambertMaterial(),
    floors.length,
  );
  floors.forEach((f, i) => {
    matrix.makeTranslation(f.x, -0.05, f.z);
    floorMesh.setMatrixAt(i, matrix);
    // Damier discret pour lire la grille sans texture
    color.set((f.r + f.c) % 2 ? 0x3b3440 : 0x433b48);
    floorMesh.setColorAt(i, color);
  });
  scene.add(floorMesh);

  const wallMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(size, h, size),
    new THREE.MeshLambertMaterial(),
    walls.length,
  );
  walls.forEach((w, i) => {
    matrix.makeTranslation(w.x, h / 2, w.z);
    wallMesh.setMatrixAt(i, matrix);
    color.set(0x6b5f55).offsetHSL(0, 0, ((w.r * 7 + w.c * 13) % 5) * 0.01);
    wallMesh.setColorAt(i, color);
  });
  scene.add(wallMesh);

  // Personnage provisoire : une capsule et une ombre "disque" (pas de shadow maps)
  const hero = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.6, 3, 8),
    new THREE.MeshLambertMaterial({ color: 0x4f86c6 }),
  );
  hero.position.y = 0.6;
  scene.add(hero);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.38, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  scene.add(shadow);

  // Éclairage peu coûteux : lumière d'ambiance + une directionnelle douce
  // + UNE seule lumière ponctuelle chaude (la "torche" du héros)
  scene.add(new THREE.HemisphereLight(0x8a7fa0, 0x1a1418, 0.9));
  const sun = new THREE.DirectionalLight(0xffe2b8, 0.6);
  sun.position.set(-4, 10, 6);
  scene.add(sun);
  const torch = new THREE.PointLight(0xffa64d, 18, 9, 1.6);
  torch.position.set(0, 2.2, 0);
  scene.add(torch);

  return {
    // Animation purement visuelle (aucune règle du jeu ici)
    update(time) {
      hero.position.y = 0.6 + Math.sin(time * 2) * 0.04;
      torch.intensity = 18 + Math.sin(time * 11) * 1.2 + Math.sin(time * 7.3) * 0.8;
    },
  };
}
