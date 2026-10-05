import * as THREE from 'three';

// Grilles des salles verrouillées : barreaux de bronze + voile vert spectral.
// Elles surgissent du sol au verrouillage et y replongent quand la salle est purifiée.
// LIT state.lock, ne modifie jamais l'état.

const BARS_PER_DOOR = 4;
const MAX_DOORS = 48;
const HEIGHT = 1.5;
const RISE = 0.22; // durée de la montée / descente (s)

export function createGateView(scene, haloTexture) {
  const bars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.07, HEIGHT, 0.07),
    new THREE.MeshLambertMaterial({ color: 0x8a6a2c }),
    MAX_DOORS * (BARS_PER_DOOR + 1),
  );
  const veil = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, HEIGHT),
    new THREE.MeshBasicMaterial({
      map: haloTexture,
      color: 0x2fff86,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    MAX_DOORS,
  );
  bars.count = 0;
  veil.count = 0;
  bars.frustumCulled = false;
  veil.frustumCulled = false;
  scene.add(bars, veil);

  let doors = []; // passages affichés
  let lockedRoom = null;
  let progress = 0; // 0 = sous le sol, 1 = dressées
  let target = 0;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  // Traverse du haut : un barreau couché (rotation d'un quart de tour), long de 1 m
  const topBar = new THREE.Vector3(1, 1 / HEIGHT, 1);
  const LIE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const lying = new THREE.Quaternion();

  function layout() {
    const y = (progress - 1) * HEIGHT + HEIGHT / 2;
    let b = 0;
    doors.slice(0, MAX_DOORS).forEach((d, i) => {
      const cx = d.c + 0.5;
      const cz = d.r + 0.5;
      // axis 'x' : la grille s'étend le long de x (passage nord ou sud de la salle)
      q.setFromAxisAngle(up, d.axis === 'x' ? 0 : Math.PI / 2);
      for (let k = 0; k < BARS_PER_DOOR; k++) {
        const off = -0.375 + k * 0.25;
        p.set(d.axis === 'x' ? cx + off : cx, y, d.axis === 'x' ? cz : cz + off);
        bars.setMatrixAt(b++, m.compose(p, q, s));
      }
      // Traverse du haut (barre couchée)
      p.set(cx, y + HEIGHT / 2 - 0.05, cz);
      lying.copy(LIE).premultiply(q);
      bars.setMatrixAt(b++, m.compose(p, lying, topBar));
      veil.setMatrixAt(i, m.compose(p.set(cx, y, cz), q, s));
    });
    bars.count = b;
    veil.count = Math.min(doors.length, MAX_DOORS);
    bars.instanceMatrix.needsUpdate = true;
    veil.instanceMatrix.needsUpdate = true;
  }

  return {
    update(state, dt, time) {
      const lock = state.lock;
      if (lock && lock.roomId !== lockedRoom) {
        // Nouveau verrou : on prend ses passages et on fait monter les grilles
        lockedRoom = lock.roomId;
        doors = lock.doors;
        progress = 0;
        target = 1;
      } else if (!lock && lockedRoom !== null) {
        // Salle purifiée : les grilles redescendent (on garde les passages le temps de l'animation)
        lockedRoom = null;
        target = 0;
      }
      const before = progress;
      progress = target > progress ? Math.min(1, progress + dt / RISE) : Math.max(0, progress - dt / RISE);
      if (progress === 0 && target === 0) {
        bars.count = 0;
        veil.count = 0;
        return;
      }
      if (progress !== before || progress > 0) layout();
      veil.material.opacity = 0.28 + Math.sin(time * 5) * 0.08;
    },
    // Changement d'étage ou nouvelle partie : on efface tout sans animation
    reset() {
      doors = [];
      lockedRoom = null;
      progress = 0;
      target = 0;
      bars.count = 0;
      veil.count = 0;
    },
  };
}
