import * as THREE from 'three';
import { SIM } from '../systems/simConfig.js';

// Rendu des ennemis et des flèches. LIT l'état, ne le modifie jamais.
//
// L'Ombre : spectre violet sombre aux yeux verts, flotte au-dessus du sol.
// Le Squelette archer : os clairs, arc de bronze.
// Pendant la préparation d'une attaque, un marquage rouge au sol montre la zone
// du coup (Ombre) ou la trajectoire de la flèche (archer) : c'est ce qui rend le
// combat lisible et "juste".

const OUTLINE = 0.03;
const INK = 0x05080a;

export function createEnemyViews(scene, gradientMap, cameraQuat) {
  const views = new Map(); // id -> vue
  const ink = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

  // Géométries partagées par tous les ennemis
  const geo = {
    shadeBody: new THREE.ConeGeometry(0.34, 0.95, 10, 1, true).translate(0, 0.48, 0),
    shadeHead: new THREE.SphereGeometry(0.2, 10, 8),
    eye: new THREE.SphereGeometry(0.045, 6, 4),
    boneBody: new THREE.CapsuleGeometry(0.16, 0.42, 3, 8),
    skull: new THREE.SphereGeometry(0.17, 10, 8),
    bow: new THREE.TorusGeometry(0.3, 0.025, 4, 12, Math.PI),
    shadow: new THREE.CircleGeometry(0.34, 14),
    // Zone du coup de l'Ombre : secteur d'anneau à plat
    strike: new THREE.RingGeometry(
      0.3,
      SIM.enemies.shade.strikeRange,
      16,
      1,
      -Math.PI / 2 - SIM.enemies.shade.strikeArc / 2,
      SIM.enemies.shade.strikeArc,
    ).rotateX(-Math.PI / 2),
    // Trajectoire de la flèche : bande étroite partant de l'archer vers +z (orientée ensuite)
    aimLine: new THREE.PlaneGeometry(0.08, 7).rotateX(-Math.PI / 2).translate(0, 0, 3.5),
    hpBack: new THREE.PlaneGeometry(0.7, 0.09),
    hpFill: new THREE.PlaneGeometry(0.7, 0.09).translate(0.35, 0, 0),
  };
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x5dffa0 });
  const warnMat = () =>
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const hpBackMat = new THREE.MeshBasicMaterial({ color: 0x1a0a0c, depthTest: false });

  // Ajoute une pièce avec son contour d'encre
  function part(parent, geometry, material, x, y, z, outline = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (outline) {
      const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
      const size = box.getSize(new THREE.Vector3());
      const o = new THREE.Mesh(geometry, ink);
      o.scale.set(1 + (2 * OUTLINE) / size.x, 1 + (2 * OUTLINE) / size.y, 1 + (2 * OUTLINE) / size.z);
      mesh.add(o);
    }
    parent.add(mesh);
    return mesh;
  }

  function createView(e) {
    const root = new THREE.Group();
    const body = new THREE.Group(); // tourne avec l'ennemi
    root.add(body);
    // Matériaux propres à chaque ennemi : on peut le faire clignoter seul quand il est touché
    const mats = [];
    const toon = (color) => {
      const m = new THREE.MeshToonMaterial({ color, gradientMap });
      m.userData.base = new THREE.Color(color);
      mats.push(m);
      return m;
    };
    if (e.type === 'shade') {
      const robe = toon(0x3b2559);
      robe.side = THREE.DoubleSide;
      part(body, geo.shadeBody, robe, 0, 0, 0);
      part(body, geo.shadeHead, toon(0x2a1a40), 0, 1.0, 0);
      part(body, geo.eye, eyeMat, -0.07, 1.03, 0.16, false);
      part(body, geo.eye, eyeMat, 0.07, 1.03, 0.16, false);
    } else {
      part(body, geo.boneBody, toon(0xd9d0b8), 0, 0.45, 0);
      part(body, geo.skull, toon(0xe8e0c8), 0, 0.92, 0);
      part(body, geo.eye, eyeMat, -0.06, 0.94, 0.14, false);
      part(body, geo.eye, eyeMat, 0.06, 0.94, 0.14, false);
      const bow = part(body, geo.bow, toon(0x7a5a2e), 0, 0.6, 0.28);
      bow.rotation.set(0, 0, Math.PI / 2);
    }
    const shadow = new THREE.Mesh(geo.shadow, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.014;
    root.add(shadow);

    // Marquage d'attaque (invisible hors préparation)
    const warn = new THREE.Mesh(e.type === 'shade' ? geo.strike : geo.aimLine, warnMat());
    warn.position.y = 0.03;
    root.add(warn);

    // Barre de vie au-dessus de la tête (affichée seulement une fois blessé)
    const hp = new THREE.Group();
    hp.quaternion.copy(cameraQuat);
    hp.position.y = 1.45;
    const back = new THREE.Mesh(geo.hpBack, hpBackMat);
    back.renderOrder = 10;
    const fill = new THREE.Mesh(geo.hpFill, new THREE.MeshBasicMaterial({ color: 0xd8333f, depthTest: false }));
    fill.position.x = -0.35;
    fill.renderOrder = 11;
    hp.add(back, fill);
    hp.visible = false;
    root.add(hp);

    scene.add(root);
    return { root, body, mats, warn, hp, fill, type: e.type };
  }

  const white = new THREE.Color(0xffffff);

  return {
    // positions : Map id -> { x, z } interpolées par main.js
    update(enemies, positions, time) {
      const alive = new Set();
      for (const e of enemies) {
        alive.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = createView(e);
          views.set(e.id, v);
        }
        const pos = positions.get(e.id) || e;
        v.root.position.set(pos.x, 0, pos.z);
        v.body.rotation.y = e.facing;
        // L'Ombre flotte ; le squelette sautille un peu en marchant
        v.body.position.y = e.type === 'shade' ? 0.12 + Math.sin(time * 3 + e.id) * 0.05 : 0;

        // Clignotement blanc quand il est touché
        const flash = e.hitFlash > 0 ? 0.85 : 0;
        for (const m of v.mats) m.color.copy(m.userData.base).lerp(white, flash);

        // Préparation : le marquage rouge s'intensifie jusqu'au coup
        if (e.mode === 'windup') {
          const total = SIM.enemies[e.type].windup * SIM.tickRate;
          const k = 1 - e.timer / total;
          v.warn.visible = true;
          v.warn.material.opacity = 0.15 + 0.5 * k;
          v.warn.rotation.y = Math.atan2(e.aimX, e.aimZ);
          if (e.type === 'shade') v.body.scale.setScalar(1 + 0.12 * k); // se gonfle avant de frapper
        } else {
          v.warn.visible = false;
          v.body.scale.setScalar(1);
        }

        v.hp.visible = e.hp < e.maxHp;
        v.fill.scale.x = Math.max(0.001, e.hp / e.maxHp);
      }
      // Ennemis disparus (vaincus ou changement d'étage) : on retire leur vue
      for (const [id, v] of views) {
        if (alive.has(id)) continue;
        scene.remove(v.root);
        v.mats.forEach((m) => m.dispose());
        v.warn.material.dispose();
        v.fill.material.dispose();
        views.delete(id);
      }
    },
  };
}

// Flèches : un seul InstancedMesh pour toutes (1 appel de dessin)
export function createProjectileView(scene) {
  const max = 64;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.55),
    new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    max,
  );
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  return {
    // lag : fraction du pas pas encore écoulée (interpolation vers l'arrière)
    update(projectiles, lag, step) {
      mesh.count = Math.min(projectiles.length, max);
      for (let i = 0; i < mesh.count; i++) {
        const a = projectiles[i];
        q.setFromAxisAngle(up, Math.atan2(a.vx, a.vz));
        p.set(a.x - a.vx * step * lag, 0.75, a.z - a.vz * step * lag);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
