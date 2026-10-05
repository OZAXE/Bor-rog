import * as THREE from 'three';

// Zones dangereuses au sol (lave de l'Hydre, impacts d'âmes de Thanatos).
// Annonce : cercle rouge (lave) ou bleu pâle (âmes) qui s'intensifie.
// Effet : disque de lave orange qui ondule. LIT state.hazards, ne le modifie jamais.

const MAX = 32;

export function createHazardView(scene, haloTexture) {
  const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  const mk = (geo, color, additive) =>
    new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        map: additive ? haloTexture : null,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
      MAX,
    );
  const warnLava = mk(ringGeo, 0xff3b3b, false);
  const warnSoul = mk(ringGeo, 0xb9c8ff, false);
  const fillWarn = mk(discGeo, 0xff3b3b, false);
  const lava = mk(discGeo, 0xff7a1a, false);
  const lavaGlow = mk(discGeo, 0xffa040, true);
  const meshes = [warnLava, warnSoul, fillWarn, lava, lavaGlow];
  for (const m of meshes) {
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
  }
  fillWarn.material.opacity = 0.18;
  const mat = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  return {
    update(state, time) {
      const n = { warnLava: 0, warnSoul: 0, fillWarn: 0, lava: 0 };
      for (const h of state.hazards) {
        if (h.warn > 0) {
          const target = h.kind === 'soul' ? warnSoul : warnLava;
          const key = h.kind === 'soul' ? 'warnSoul' : 'warnLava';
          if (n[key] >= MAX) continue;
          target.setMatrixAt(n[key]++, mat.compose(p.set(h.x, 0.04, h.z), q, s.set(h.r, 1, h.r)));
          // Intérieur qui se remplit à mesure que l'impact approche
          if (n.fillWarn < MAX) fillWarn.setMatrixAt(n.fillWarn++, mat.compose(p.set(h.x, 0.035, h.z), q, s.set(h.r * 0.95, 1, h.r * 0.95)));
        } else if (h.kind === 'lava' && n.lava < MAX) {
          const w = 1 + Math.sin(time * 6 + h.id) * 0.04;
          lava.setMatrixAt(n.lava, mat.compose(p.set(h.x, 0.03, h.z), q, s.set(h.r * w, 1, h.r * w)));
          lavaGlow.setMatrixAt(n.lava++, mat.compose(p.set(h.x, 0.05, h.z), q, s.set(h.r * 1.5, 1, h.r * 1.5)));
        }
      }
      warnLava.count = n.warnLava;
      warnSoul.count = n.warnSoul;
      fillWarn.count = n.fillWarn;
      lava.count = n.lava;
      lavaGlow.count = n.lava;
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
      warnLava.material.opacity = 0.55 + Math.sin(time * 10) * 0.2;
      warnSoul.material.opacity = 0.55 + Math.sin(time * 10) * 0.2;
    },
  };
}
