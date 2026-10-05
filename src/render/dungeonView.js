import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { TILE, tileAt } from '../dungeon/tiles.js';
import { hasOpenNorth } from '../dungeon/generate.js';

// Rendu d'un étage. LIT les données du donjon, ne les modifie jamais.
//
// Pour le mobile : chaque famille d'objets (sol, murs, piliers, torches…) est un
// seul InstancedMesh, donc un seul appel de dessin quel que soit le nombre de cases.
//
// Murs "face caméra" : la caméra regarde vers le nord (z négatif). Un mur qui a du
// sol juste au nord de lui se trouve ENTRE la caméra et ce sol : il cacherait le héros.
// Ces murs-là sont dessinés bas (CONFIG.dungeon.lowWallHeight), comme dans
// beaucoup de jeux en vue isométrique.
//
// Éclairage des torches : pas de vraies lumières (trop coûteuses sur mobile), on
// "peint" une lueur chaude dans la couleur des cases proches des torches.

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scale = new THREE.Vector3(1, 1, 1);
const pos = new THREE.Vector3();
const color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export function createDungeonView(scene, dungeon) {
  const cfg = CONFIG.dungeon;
  const group = new THREE.Group();
  scene.add(group);

  const torches = dungeon.decor.filter((d) => d.kind === 'torch');
  // Intensité de la lueur des torches en un point (0..1).
  // La lumière part du pied du mur, côté salle (z = r + 1).
  const glowAt = (x, z) => {
    let g = 0;
    for (const t of torches) {
      const dx = x - (t.c + 0.5);
      const dz = z - (t.r + 1.3);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < cfg.torchGlowRadius) g += (1 - d / cfg.torchGlowRadius) ** 2;
    }
    return Math.min(g, 1);
  };

  // ---------- Classement des cases ----------
  const floors = [];
  const tallWalls = [];
  const lowWalls = [];
  const pillars = [];
  for (let r = 0; r < dungeon.height; r++) {
    for (let c = 0; c < dungeon.width; c++) {
      const t = tileAt(dungeon, c, r);
      if (t === TILE.FLOOR || t === TILE.PILLAR) floors.push({ c, r });
      if (t === TILE.PILLAR) pillars.push({ c, r });
      if (t === TILE.WALL) (hasOpenNorth(dungeon, c, r) ? lowWalls : tallWalls).push({ c, r });
    }
  }

  // ---------- Sol ----------
  const warm = new THREE.Color(cfg.colors.torchGlow);
  const floorMesh = instanced(new THREE.BoxGeometry(1, 0.1, 1), floors.length);
  floors.forEach((f, i) => {
    place(floorMesh, i, f.c + 0.5, -0.05, f.r + 0.5);
    // Dalles légèrement différentes (bruit stable dérivé de la position)
    color.set(cfg.colors.floor).offsetHSL(0, 0, (hash2(f.c, f.r) - 0.5) * 0.04);
    color.lerp(warm, glowAt(f.c + 0.5, f.r + 0.5) * 0.55);
    floorMesh.setColorAt(i, color);
  });
  group.add(floorMesh);

  // ---------- Murs ----------
  const wallColor = (c, r) => {
    color.set(cfg.colors.wall).offsetHSL(0, 0, (hash2(c * 3, r * 7) - 0.5) * 0.05);
    return color.lerp(warm, glowAt(c + 0.5, r + 0.5) * 0.35);
  };
  const tallMesh = instanced(new THREE.BoxGeometry(1, cfg.wallHeight, 1), tallWalls.length);
  tallWalls.forEach((w, i) => {
    place(tallMesh, i, w.c + 0.5, cfg.wallHeight / 2, w.r + 0.5);
    tallMesh.setColorAt(i, wallColor(w.c, w.r));
  });
  group.add(tallMesh);

  const lowMesh = instanced(new THREE.BoxGeometry(1, cfg.lowWallHeight, 1), lowWalls.length);
  lowWalls.forEach((w, i) => {
    place(lowMesh, i, w.c + 0.5, cfg.lowWallHeight / 2, w.r + 0.5);
    lowMesh.setColorAt(i, wallColor(w.c, w.r));
  });
  group.add(lowMesh);

  // ---------- Piliers ----------
  const pillarMesh = instanced(
    new THREE.CylinderGeometry(0.34, 0.4, cfg.pillarHeight, 8),
    pillars.length,
  );
  pillars.forEach((p, i) => {
    place(pillarMesh, i, p.c + 0.5, cfg.pillarHeight / 2, p.r + 0.5);
    pillarMesh.setColorAt(i, color.set(cfg.colors.pillar));
  });
  group.add(pillarMesh);

  // ---------- Torches : support + flamme (couleur pure, sans calcul de lumière) ----------
  const bracketMesh = instanced(new THREE.BoxGeometry(0.12, 0.3, 0.12), torches.length);
  const flameMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.11, 0),
    new THREE.MeshBasicMaterial({ color: cfg.colors.flame }),
    Math.max(torches.length, 1),
  );
  flameMesh.count = torches.length;
  torches.forEach((t, i) => {
    // Accrochée à la face sud du mur (côté caméra) : z = r + 1
    place(bracketMesh, i, t.c + 0.5, 1.05, t.r + 1.06);
    bracketMesh.setColorAt(i, color.set(0x2b2420));
    place(flameMesh, i, t.c + 0.5, 1.3, t.r + 1.08);
  });
  group.add(bracketMesh, flameMesh);

  // ---------- Débris ----------
  const debris = dungeon.decor.filter((d) => d.kind === 'debris');
  const debrisMesh = instanced(new THREE.BoxGeometry(0.22, 0.08, 0.14), debris.length);
  debris.forEach((d, i) => {
    quat.setFromAxisAngle(UP, d.angle);
    pos.set(d.x, 0.04, d.z);
    debrisMesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
    debrisMesh.setColorAt(i, color.set(cfg.colors.debris));
  });
  quat.identity();
  group.add(debrisMesh);

  // ---------- Escalier : trou sombre + 3 marches qui descendent ----------
  // Pas de dalle sur la case de l'escalier : on voit dans le trou. Le fond noir
  // est posé SOUS les marches, sinon il les cacherait.
  const stairs = new THREE.Group();
  const hole = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.02, 1),
    new THREE.MeshBasicMaterial({ color: 0x050407 }),
  );
  hole.position.y = -0.55;
  stairs.add(hole);
  const stepMat = new THREE.MeshLambertMaterial({ color: cfg.colors.wall });
  const stepGeo = new THREE.BoxGeometry(0.9, 0.06, 0.24);
  for (let k = 0; k < 3; k++) {
    const step = new THREE.Mesh(stepGeo, stepMat);
    step.position.set(0, -0.1 - k * 0.14, 0.33 - k * 0.24);
    stairs.add(step);
  }
  // Liseré lumineux autour du trou pour le repérer de loin
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.72, 4, 1, Math.PI / 4),
    new THREE.MeshBasicMaterial({ color: cfg.colors.stairsRim, transparent: true, opacity: 0.7 }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  stairs.add(rim);
  stairs.position.set(dungeon.stairs.c + 0.5, 0, dungeon.stairs.r + 0.5);
  group.add(stairs);

  return {
    // Animation purement visuelle (aucune règle du jeu ici)
    update(time) {
      // Les flammes "dansent" un peu ; chaque torche a son propre rythme
      for (let i = 0; i < torches.length; i++) {
        const t = torches[i];
        const s = 1 + Math.sin(time * 9 + i * 1.7) * 0.15 + Math.sin(time * 13.3 + i) * 0.08;
        pos.set(t.c + 0.5, 1.3 + (s - 1) * 0.1, t.r + 1.08);
        flameMesh.setMatrixAt(i, matrix.compose(pos, quat, scale.set(1, s * 1.3, 1)));
      }
      scale.set(1, 1, 1);
      flameMesh.instanceMatrix.needsUpdate = true;
      rim.material.opacity = 0.45 + Math.sin(time * 3) * 0.25;
    },
    // Libère la mémoire GPU quand on change d'étage
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}

function instanced(geometry, count) {
  // Un InstancedMesh ne peut pas avoir 0 instance : on en réserve 1 et on n'en affiche aucune
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial(), Math.max(count, 1));
  mesh.count = count;
  return mesh;
}

function place(mesh, i, x, y, z) {
  matrix.makeTranslation(x, y, z);
  mesh.setMatrixAt(i, matrix);
}

// Pseudo-hasard visuel stable à partir d'une position (n'influence pas le jeu)
function hash2(a, b) {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
