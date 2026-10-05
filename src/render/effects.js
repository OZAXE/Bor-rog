import * as THREE from 'three';
import { SIM } from '../systems/simConfig.js';

// Effets visuels déclenchés par les événements de la simulation (coups, morts…).
// Purement décoratifs : ils n'influencent jamais la partie. Ici, Math.random est
// donc permis (deux joueurs peuvent voir des étincelles différentes, sans conséquence).

const MAX_PARTICLES = 220;

export function createEffects(scene, haloTexture) {
  // ---------- Arc de coup (croissant blanc, comme dans Hades) ----------
  const a = SIM.player.attack;
  const swingGeo = new THREE.RingGeometry(0.45, a.range, 24, 1, -Math.PI / 2 - a.arc / 2, a.arc).rotateX(-Math.PI / 2);
  const swingMat = new THREE.MeshBasicMaterial({
    color: 0xf4fff8,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const swing = new THREE.Mesh(swingGeo, swingMat);
  swing.position.y = 0.55;
  swing.visible = false;
  scene.add(swing);
  let swingLife = 0;
  const swingDuration = a.duration + 0.06;

  // ---------- Particules (un seul InstancedMesh) ----------
  const particles = [];
  const pMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.07, 0),
    new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    MAX_PARTICLES,
  );
  pMesh.count = 0;
  pMesh.frustumCulled = false;
  // Couleurs par instance (initialisées pour que three.js crée le tampon)
  for (let i = 0; i < MAX_PARTICLES; i++) pMesh.setColorAt(i, new THREE.Color(1, 1, 1));
  scene.add(pMesh);

  // ---------- Halo d'esquive au sol ----------
  const puffMat = new THREE.MeshBasicMaterial({
    map: haloTexture,
    color: 0x9fe8ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const puff = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), puffMat);
  puff.position.y = 0.03;
  scene.add(puff);
  let puffLife = 0;

  let shake = 0; // intensité du tremblement d'écran (m)
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  function burst(x, y, z, count, hex, speed, life) {
    color.set(hex);
    for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      particles.push({
        x,
        y,
        z,
        vx: Math.cos(ang) * sp,
        vy: 1.5 + Math.random() * 2.5,
        vz: Math.sin(ang) * sp,
        life,
        max: life,
        r: color.r,
        g: color.g,
        b: color.b,
      });
    }
  }

  return {
    // Réagit aux événements d'un pas de simulation
    handle(ev) {
      switch (ev.type) {
        case 'swing':
          swing.position.x = ev.x;
          swing.position.z = ev.z;
          swing.rotation.y = ev.facing;
          swingLife = swingDuration;
          break;
        case 'hit':
          burst(ev.x, 0.6, ev.z, 8, 0xffffff, 3, 0.25);
          shake = Math.max(shake, 0.06);
          break;
        case 'enemyDied':
          burst(ev.x, 0.6, ev.z, 26, ev.enemyType === 'shade' ? 0x8a5cff : 0xe8e0c8, 3.5, 0.6);
          burst(ev.x, 0.6, ev.z, 12, 0x2fff86, 2, 0.8);
          shake = Math.max(shake, 0.1);
          break;
        case 'playerHurt':
          burst(ev.x, 0.7, ev.z, 14, 0xff3344, 3, 0.4);
          shake = Math.max(shake, 0.22);
          break;
        case 'arrowBreak':
          burst(ev.x, 0.7, ev.z, 5, 0xffd27a, 1.5, 0.2);
          break;
        case 'dash':
          puff.position.x = ev.x;
          puff.position.z = ev.z;
          puffLife = 0.3;
          break;
        default:
      }
    },

    update(dt) {
      // Arc de coup : apparaît plein puis s'efface
      if (swingLife > 0) {
        swingLife -= dt;
        swing.visible = true;
        swingMat.opacity = Math.max(0, swingLife / swingDuration) * 0.9;
        swing.scale.setScalar(1 + (1 - swingLife / swingDuration) * 0.12);
      } else swing.visible = false;

      if (puffLife > 0) {
        puffLife -= dt;
        puffMat.opacity = Math.max(0, puffLife / 0.3) * 0.6;
      } else puffMat.opacity = 0;

      // Particules : gravité simple, rétrécissent en mourant
      let n = 0;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.vy -= 9 * dt;
        p.x += p.vx * dt;
        p.y = Math.max(0.05, p.y + p.vy * dt);
        p.z += p.vz * dt;
      }
      for (const p of particles) {
        const k = p.life / p.max;
        pMesh.setMatrixAt(n, matrix.compose(pos.set(p.x, p.y, p.z), quat, scl.setScalar(0.4 + k)));
        pMesh.setColorAt(n, color.setRGB(p.r * k, p.g * k, p.b * k));
        n++;
      }
      pMesh.count = n;
      pMesh.instanceMatrix.needsUpdate = true;
      if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;

      shake = Math.max(0, shake - dt * 0.8);
    },

    // Décalage de caméra pour le tremblement d'écran
    shakeOffset() {
      if (shake <= 0) return { x: 0, z: 0 };
      return { x: (Math.random() - 0.5) * 2 * shake, z: (Math.random() - 0.5) * 2 * shake };
    },
  };
}
