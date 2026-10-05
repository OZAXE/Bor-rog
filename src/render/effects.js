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
          // Coup du destin : gerbe dorée et petit tremblement en plus
          if (ev.crit) burst(ev.x, 0.8, ev.z, 14, 0xf2c96b, 3.5, 0.4);
          shake = Math.max(shake, ev.crit ? 0.14 : 0.06);
          break;
        case 'defiance':
          // Défi de la Mort : le héros se relève dans une explosion d'âme
          burst(ev.x, 0.8, ev.z, 50, 0x2fff86, 5, 1.1);
          burst(ev.x, 1.2, ev.z, 24, 0xf2c96b, 3, 0.9);
          shake = Math.max(shake, 0.3);
          break;
        case 'reflect':
          burst(ev.x, 0.75, ev.z, 10, 0x9fe8ff, 2, 0.3);
          break;
        case 'enemyDied':
          burst(ev.x, 0.6, ev.z, 26, ev.enemyType === 'shade' ? 0x8a5cff : ev.enemyType === 'fury' ? 0xd8333f : 0xe8e0c8, 3.5, 0.6);
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
        case 'breath': {
          // Trois jets de flammes vertes dans les directions des cônes
          for (const a of SIM.bosses.cerberus.breath.angles) {
            const f = ev.facing + a;
            for (let k = 1; k <= 4; k++) burst(ev.x + Math.sin(f) * k * 1.2, 0.8, ev.z + Math.cos(f) * k * 1.2, 4, 0x2fff86, 1.2, 0.45);
          }
          shake = Math.max(shake, 0.1);
          break;
        }
        case 'howl':
          burst(ev.x, 1.2, ev.z, 40, 0x2fff86, 5, 0.9);
          shake = Math.max(shake, 0.3);
          break;
        case 'headSevered':
          burst(ev.x, 1, ev.z, 18, 0xff7a2f, 2.5, 0.6);
          break;
        case 'cauterize':
          burst(ev.x, 0.4, ev.z, 12, 0xffd27a, 1.5, 0.6);
          break;
        case 'headRegrow':
          burst(ev.x, 0.8, ev.z, 14, 0x8a2a20, 1.5, 0.5);
          break;
        case 'hazardStart':
          if (ev.kind === 'soul') {
            burst(ev.x, 0.4, ev.z, 16, 0xb9c8ff, 2.5, 0.5);
            shake = Math.max(shake, 0.08);
          } else burst(ev.x, 0.2, ev.z, 10, 0xff7a1a, 1.5, 0.6);
          break;
        case 'reap':
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            burst(ev.x + Math.cos(a) * ev.r, 0.6, ev.z + Math.sin(a) * ev.r, 2, 0xd9e2ff, 0.8, 0.35);
          }
          shake = Math.max(shake, 0.12);
          break;
        case 'vanish':
        case 'appear':
          burst(ev.x, 1, ev.z, 20, 0x5a5470, 2, 0.6);
          break;
        case 'dispel':
          burst(ev.x, 1, ev.z, 24, 0xb9c8ff, 2.5, 0.6);
          break;
        case 'summon':
          burst(ev.x, 0.5, ev.z, 14, 0x8a5cff, 2, 0.6);
          break;
        case 'bossDefeated':
          burst(ev.x, 1, ev.z, 60, 0xf2c96b, 6, 1.2);
          burst(ev.x, 1, ev.z, 40, 0x2fff86, 4, 1.4);
          shake = Math.max(shake, 0.35);
          break;
        case 'crash':
          // Furie qui percute un mur : gerbe de poussière et petit tremblement
          burst(ev.x, 0.6, ev.z, 14, 0xb9a98c, 2.5, 0.5);
          shake = Math.max(shake, 0.18);
          break;
        case 'pickup':
          burst(ev.x, 0.4, ev.z, ev.kind === 'obol' ? 4 : 10, ev.kind === 'obol' ? 0xf2c96b : 0xff5a6a, 1.2, 0.35);
          break;
        case 'chestOpened':
          burst(ev.x, 0.5, ev.z, 24, 0xf2c96b, 2.5, 0.7);
          shake = Math.max(shake, 0.05);
          break;
        case 'heal':
          burst(ev.x, 1.1, ev.z, 8, 0x5dffa0, 1, 0.5);
          break;
        case 'roomCleared':
          // Les grilles se dissipent en étincelles vertes
          for (const d of ev.doors) burst(d.c + 0.5, 0.8, d.r + 0.5, 4, 0x2fff86, 1.5, 0.7);
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
        const pt = particles[i];
        pt.life -= dt;
        if (pt.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        pt.vy -= 9 * dt;
        pt.x += pt.vx * dt;
        pt.y = Math.max(0.05, pt.y + pt.vy * dt);
        pt.z += pt.vz * dt;
      }
      for (const pt of particles) {
        const k = pt.life / pt.max;
        pMesh.setMatrixAt(n, matrix.compose(pos.set(pt.x, pt.y, pt.z), quat, scl.setScalar(0.4 + k)));
        pMesh.setColorAt(n, color.setRGB(pt.r * k, pt.g * k, pt.b * k));
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
