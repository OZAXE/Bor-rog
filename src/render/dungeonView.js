import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { TILE, tileAt } from '../dungeon/tiles.js';
import { buildDungeonMesh, torchLightOrigin } from './dungeonMesh.js';

// Rendu d'un étage. LIT les données du donjon, ne les modifie jamais.
//
// Budget d'appels de dessin (ce qui coûte cher sur mobile), quel que soit l'étage :
//   1 décor fixe (sol + murs, une seule texture)   2 colonnes (+ contour d'encre)
//   2 coupelles des flammes   2 flammes (cœur + enveloppe)   2 halos (air + sol)
//   1 débris   ~6 escalier
// Les flammes n'éclairent pas vraiment : leur lueur est "peinte" dans les couleurs
// du décor (cf. dungeonMesh.js) et simulée par des halos en mélange additif.

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scale = new THREE.Vector3(1, 1, 1);
const pos = new THREE.Vector3();
const color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const FLOOR_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

// shared : ressources réutilisées d'un étage à l'autre (textures, matériaux)
// cameraQuat : orientation fixe de la caméra, pour tourner les halos face à elle
export function createDungeonView(scene, dungeon, shared, cameraQuat) {
  const cfg = CONFIG.dungeon;
  const group = new THREE.Group();
  scene.add(group);
  const owned = []; // géométries créées pour cet étage (libérées au changement d'étage)

  // ---------- Décor fixe : un seul maillage ----------
  const m = buildDungeonMesh(dungeon, {
    tallHeight: cfg.wallHeight,
    lowHeight: cfg.lowWallHeight,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  geo.computeBoundingSphere();
  owned.push(geo);
  group.add(new THREE.Mesh(geo, shared.decorMaterial));

  // ---------- Colonnes antiques (+ contour d'encre par "coque inversée") ----------
  const pillars = [];
  for (let r = 0; r < dungeon.height; r++) {
    for (let c = 0; c < dungeon.width; c++) {
      if (tileAt(dungeon, c, r) === TILE.PILLAR) pillars.push({ c, r });
    }
  }
  const columnMesh = instanced(shared.columnGeometry, shared.columnMaterial, pillars.length);
  const columnOutline = instanced(shared.columnOutlineGeometry, shared.inkMaterial, pillars.length);
  pillars.forEach((p, i) => {
    place(columnMesh, i, p.c + 0.5, 0, p.r + 0.5);
    place(columnOutline, i, p.c + 0.5, 0, p.r + 0.5);
  });
  group.add(columnMesh, columnOutline);

  // ---------- Flammes spectrales ----------
  const torches = dungeon.decor.filter((d) => d.kind === 'torch');
  const flameSpots = torches.map((t) => {
    const out = 0.16; // décollement du mur
    return t.face === 'east'
      ? { x: t.c + 1 + out, z: t.r + 0.5 }
      : { x: t.c + 0.5, z: t.r + 1 + out };
  });
  const y = cfg.flameHeight;
  const cupMesh = instanced(shared.cupGeometry, shared.bronzeMaterial, torches.length);
  const flameOuter = instanced(shared.flameGeometry, shared.flameOuterMaterial, torches.length);
  const flameInner = instanced(shared.flameGeometry, shared.flameInnerMaterial, torches.length);
  const haloAir = instanced(shared.haloGeometry, shared.haloMaterial, torches.length);
  const haloFloor = instanced(shared.haloGeometry, shared.haloFloorMaterial, torches.length);
  flameSpots.forEach((s, i) => {
    place(cupMesh, i, s.x, y - 0.08, s.z);
    // Halo vertical tourné vers la caméra (elle ne tourne jamais : on l'oriente une fois)
    haloAir.setMatrixAt(i, matrix.compose(pos.set(s.x, y + 0.15, s.z), cameraQuat, scale.set(1.5, 1.5, 1)));
    const o = torchLightOrigin(torches[i]);
    haloFloor.setMatrixAt(i, matrix.compose(pos.set(o.x, 0.02, o.z), FLOOR_QUAT, scale.set(3.4, 3.4, 1)));
    scale.set(1, 1, 1);
  });
  group.add(cupMesh, flameOuter, flameInner, haloAir, haloFloor);

  // ---------- Débris (morceaux de colonnes et de pierre) ----------
  const debris = dungeon.decor.filter((d) => d.kind === 'debris');
  const debrisMesh = instanced(shared.debrisGeometry, shared.debrisMaterial, debris.length);
  debris.forEach((d, i) => {
    quat.setFromAxisAngle(UP, d.angle);
    const s = 0.7 + (d.angle % 1) * 0.6;
    debrisMesh.setMatrixAt(i, matrix.compose(pos.set(d.x, 0.05 * s, d.z), quat, scale.set(s, s, s)));
    debrisMesh.setColorAt(i, color.set(CONFIG.dungeon.colors.debris).offsetHSL(0, 0, (d.angle % 0.5) * 0.08));
  });
  scale.set(1, 1, 1);
  quat.identity();
  group.add(debrisMesh);

  // ---------- Escalier : trou + marches + liseré doré ----------
  const stairs = new THREE.Group();
  const hole = new THREE.Mesh(shared.unitBox, shared.voidMaterial);
  hole.scale.set(1, 0.02, 1);
  hole.position.y = -0.6;
  stairs.add(hole);
  for (let k = 0; k < 3; k++) {
    const step = new THREE.Mesh(shared.unitBox, shared.stepMaterial);
    step.scale.set(0.9, 0.08, 0.26);
    // Les marches descendent vers le nord-ouest (on les voit depuis la caméra)
    step.position.set(0, -0.12 - k * 0.15, 0.32 - k * 0.26);
    stairs.add(step);
  }
  const rim = new THREE.Mesh(shared.rimGeometry, shared.rimMaterial);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  stairs.add(rim);
  const stairsHalo = new THREE.Mesh(shared.haloGeometry, shared.stairsHaloMaterial);
  stairsHalo.quaternion.copy(FLOOR_QUAT);
  stairsHalo.scale.set(2.6, 2.6, 1);
  stairsHalo.position.y = 0.03;
  stairs.add(stairsHalo);
  stairs.position.set(dungeon.stairs.c + 0.5, 0, dungeon.stairs.r + 0.5);
  group.add(stairs);

  return {
    // Animation purement visuelle (aucune règle du jeu ici)
    update(time) {
      // Chaque flamme danse à son propre rythme
      for (let i = 0; i < flameSpots.length; i++) {
        const s = flameSpots[i];
        const k = 1 + Math.sin(time * 9 + i * 1.7) * 0.14 + Math.sin(time * 14.3 + i) * 0.07;
        pos.set(s.x, y + 0.12 * k, s.z);
        quat.setFromAxisAngle(UP, time * 2 + i);
        flameOuter.setMatrixAt(i, matrix.compose(pos, quat, scale.set(1, 1.7 * k, 1)));
        flameInner.setMatrixAt(i, matrix.compose(pos, quat, scale.set(0.55, 1.2 * k, 0.55)));
      }
      quat.identity();
      scale.set(1, 1, 1);
      flameOuter.instanceMatrix.needsUpdate = true;
      flameInner.instanceMatrix.needsUpdate = true;
      shared.haloMaterial.opacity = 0.55 + Math.sin(time * 7.1) * 0.06;
      shared.rimMaterial.opacity = 0.55 + Math.sin(time * 3) * 0.25;
    },
    // Libère la mémoire graphique propre à cet étage (les ressources partagées restent)
    dispose() {
      scene.remove(group);
      for (const g of owned) g.dispose();
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
      });
    },
  };
}

// Ressources communes à tous les étages : créées une seule fois
export function createDungeonResources(textures) {
  const cfg = CONFIG.dungeon;
  const col = cfg.colors;

  // Colonne : base + fût cannelé (12 faces) + chapiteau
  const base = new THREE.BoxGeometry(0.8, 0.16, 0.8).translate(0, 0.08, 0);
  const shaft = new THREE.CylinderGeometry(0.27, 0.31, cfg.wallHeight - 0.32, 12).translate(
    0,
    0.16 + (cfg.wallHeight - 0.32) / 2,
    0,
  );
  const capital = new THREE.BoxGeometry(0.78, 0.16, 0.78).translate(0, cfg.wallHeight - 0.08, 0);
  const columnGeometry = mergeGeometries([base, shaft, capital]);
  const columnOutlineGeometry = columnGeometry.clone().scale(1.09, 1.03, 1.09);

  const flameMat = (c, opacity) =>
    new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  const haloMat = (c, opacity) =>
    new THREE.MeshBasicMaterial({
      map: textures.halo,
      color: c,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

  return {
    decorMaterial: new THREE.MeshLambertMaterial({ map: textures.atlas, vertexColors: true }),
    columnGeometry,
    columnOutlineGeometry,
    columnMaterial: new THREE.MeshLambertMaterial({ color: col.column }),
    // Contour d'encre : on dessine l'arrière d'une copie un peu plus grosse, en noir
    inkMaterial: new THREE.MeshBasicMaterial({ color: col.ink, side: THREE.BackSide }),
    cupGeometry: new THREE.CylinderGeometry(0.17, 0.07, 0.14, 8),
    bronzeMaterial: new THREE.MeshLambertMaterial({ color: col.bronze }),
    flameGeometry: new THREE.OctahedronGeometry(0.13, 0),
    flameOuterMaterial: flameMat(col.flameOuter, 0.85),
    flameInnerMaterial: flameMat(col.flameInner, 1),
    haloGeometry: new THREE.PlaneGeometry(1, 1),
    haloMaterial: haloMat(col.flameOuter, 0.55),
    haloFloorMaterial: haloMat(col.flameOuter, 0.22),
    stairsHaloMaterial: haloMat(col.stairsRim, 0.35),
    debrisGeometry: new THREE.BoxGeometry(0.24, 0.1, 0.16),
    debrisMaterial: new THREE.MeshLambertMaterial(),
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    voidMaterial: new THREE.MeshBasicMaterial({ color: 0x020304 }),
    stepMaterial: new THREE.MeshLambertMaterial({ color: col.column }),
    rimGeometry: new THREE.RingGeometry(0.62, 0.72, 4, 1, Math.PI / 4),
    rimMaterial: new THREE.MeshBasicMaterial({ color: col.stairsRim, transparent: true, opacity: 0.7 }),
  };
}

function instanced(geometry, material, count) {
  // Un InstancedMesh ne peut pas avoir 0 instance : on en réserve 1 et on n'en affiche aucune
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
  mesh.count = count;
  return mesh;
}

function place(mesh, i, x, y, z) {
  matrix.makeTranslation(x, y, z);
  mesh.setMatrixAt(i, matrix);
}
