import * as THREE from 'three';

// Rendu du butin : oboles (pièces d'or qui tournent), potions (fioles rouges
// lumineuses) et coffres (le couvercle s'ouvre). LIT l'état, ne le modifie jamais.
// Oboles et potions : un InstancedMesh chacune (1 appel de dessin par type).

const MAX = 128;

export function createLootView(scene, gradientMap, haloTexture) {
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap });

  const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 12), toon(0xf2c96b), MAX);
  const flasks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), toon(0xd8333f), MAX);
  const necks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 6), toon(0xe9e2cf), MAX);
  const glows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: haloTexture,
      color: 0xff4a5a,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    MAX,
  );
  for (const m of [coins, flasks, necks, glows]) {
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
  }

  // Coffres : quelques objets par coffre (peu nombreux : 0 à 3 par étage)
  const chestGeo = {
    body: new THREE.BoxGeometry(0.7, 0.36, 0.46),
    lid: new THREE.BoxGeometry(0.72, 0.1, 0.48).translate(0, 0.05, 0.24),
    band: new THREE.BoxGeometry(0.74, 0.06, 0.06),
  };
  const chestMats = { wood: toon(0x5a3a22), gold: toon(0xe8c45a) };
  const ink = new THREE.MeshBasicMaterial({ color: 0x05080a, side: THREE.BackSide });
  const chestViews = new Map(); // id -> { group, lid, open }

  function chestView(c) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(chestGeo.body, chestMats.wood);
    body.position.y = 0.18;
    const outline = new THREE.Mesh(chestGeo.body, ink);
    outline.scale.set(1.08, 1.12, 1.12);
    body.add(outline);
    const band = new THREE.Mesh(chestGeo.band, chestMats.gold);
    band.position.set(0, 0.3, 0.21);
    const hinge = new THREE.Group(); // le couvercle pivote autour de l'arête arrière
    hinge.position.set(0, 0.36, -0.24);
    const lid = new THREE.Mesh(chestGeo.lid, chestMats.gold);
    hinge.add(lid);
    group.add(body, band, hinge);
    group.position.set(c.x, 0, c.z);
    group.rotation.y = Math.PI / 4; // face à la caméra
    scene.add(group);
    return { group, hinge, angle: c.opened ? 1.9 : 0 };
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

  return {
    update(state, time, dt) {
      let nc = 0;
      let nf = 0;
      for (const it of state.pickups) {
        if (it.kind === 'obol') {
          if (nc >= MAX) continue;
          // Pièce dressée qui tourne sur elle-même et flotte un peu
          q.setFromAxisAngle(up, time * 3 + it.id).multiply(tilt);
          p.set(it.x, 0.22 + Math.sin(time * 4 + it.id) * 0.04, it.z);
          const k = 0.9 + Math.min(it.amount, 3) * 0.1;
          coins.setMatrixAt(nc++, m4.compose(p, q, s.set(k, k, k)));
        } else {
          if (nf >= MAX) continue;
          const y = 0.2 + Math.sin(time * 3 + it.id) * 0.05;
          s.set(1, 1, 1);
          flasks.setMatrixAt(nf, m4.compose(p.set(it.x, y, it.z), q.identity(), s));
          necks.setMatrixAt(nf, m4.compose(p.set(it.x, y + 0.15, it.z), q, s));
          glows.setMatrixAt(nf, m4.compose(p.set(it.x, 0.02, it.z), q, s));
          nf++;
        }
      }
      s.set(1, 1, 1);
      coins.count = nc;
      flasks.count = nf;
      necks.count = nf;
      glows.count = nf;
      for (const m of [coins, flasks, necks, glows]) m.instanceMatrix.needsUpdate = true;
      glows.material.opacity = 0.35 + Math.sin(time * 4) * 0.1;

      // Coffres : création / suppression selon l'étage, ouverture animée
      const seen = new Set();
      for (const c of state.chests) {
        seen.add(c.id);
        let v = chestViews.get(c.id);
        if (!v) {
          v = chestView(c);
          chestViews.set(c.id, v);
        }
        const target = c.opened ? 1.9 : 0;
        v.angle += (target - v.angle) * Math.min(1, dt * 10);
        v.hinge.rotation.x = -v.angle;
      }
      for (const [id, v] of chestViews) {
        if (seen.has(id)) continue;
        scene.remove(v.group);
        chestViews.delete(id);
      }
    },
  };
}
