import * as THREE from 'three';
import { SIM } from '../systems/simConfig.js';

// Rendu des ennemis et des flèches. LIT l'état, ne le modifie jamais.
//
// L'Ombre : spectre violet sombre aux yeux verts, flotte au-dessus du sol.
// Le Squelette archer : os clairs, arc de bronze.
// La Furie : silhouette pourpre aux ailes déployées ; annonce sa charge par une
// large bande rouge au sol.
// Les élites : plus grands, cerclés d'une aura dorée au sol.
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
    // Trajectoire de la charge de la Furie : bande large, de la longueur de la charge
    chargeLine: new THREE.PlaneGeometry(0.75, SIM.enemies.fury.chargeDistance)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, SIM.enemies.fury.chargeDistance / 2),
    furyBody: new THREE.ConeGeometry(0.26, 0.8, 8).translate(0, 0.45, 0),
    wing: new THREE.PlaneGeometry(0.55, 0.32).translate(0.3, 0, 0),
    aura: new THREE.RingGeometry(0.42, 0.56, 24).rotateX(-Math.PI / 2),
    // ---------- Cerbère ----------
    dogTorso: new THREE.CapsuleGeometry(0.48, 0.75, 4, 10).rotateX(Math.PI / 2), // corps allongé
    dogBelly: new THREE.SphereGeometry(0.5, 10, 8),
    dogLeg: new THREE.BoxGeometry(0.22, 0.6, 0.22),
    dogHead: new THREE.SphereGeometry(0.3, 10, 8),
    dogSnout: new THREE.BoxGeometry(0.2, 0.18, 0.3),
    collar: new THREE.TorusGeometry(0.62, 0.07, 6, 16),
    spike: new THREE.ConeGeometry(0.06, 0.2, 5),
    bossCharge: new THREE.PlaneGeometry(1.7, SIM.bosses.cerberus.charge.maxDistance)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, SIM.bosses.cerberus.charge.maxDistance / 2),
    bossBite: new THREE.RingGeometry(
      0.5,
      SIM.bosses.cerberus.bite.range,
      18,
      1,
      -Math.PI / 2 - SIM.bosses.cerberus.bite.arc / 2,
      SIM.bosses.cerberus.bite.arc,
    ).rotateX(-Math.PI / 2),
    breathCone: (offset) =>
      new THREE.RingGeometry(
        0.6,
        SIM.bosses.cerberus.breath.range,
        14,
        1,
        -Math.PI / 2 - SIM.bosses.cerberus.breath.coneArc / 2 - offset,
        SIM.bosses.cerberus.breath.coneArc,
      ).rotateX(-Math.PI / 2),
    howlRing: new THREE.RingGeometry(1.0, 1.25, 32).rotateX(-Math.PI / 2),
    // ---------- Hydre ----------
    coil: new THREE.TorusGeometry(0.85, 0.32, 8, 18).rotateX(Math.PI / 2),
    lavaPool: new THREE.CircleGeometry(1.9, 28).rotateX(-Math.PI / 2),
    neck: new THREE.CylinderGeometry(0.16, 0.24, 1.1, 8).translate(0, 0.55, 0),
    serpentHead: new THREE.BoxGeometry(0.34, 0.24, 0.5),
    jaw: new THREE.BoxGeometry(0.3, 0.08, 0.42),
    spitLine: (offset) =>
      new THREE.PlaneGeometry(0.1, 6)
        .translate(0, 3, 0)
        .rotateX(Math.PI / 2) // +y du plan -> +z du monde : la ligne part DEVANT la tête
        .rotateY(offset),
    headBite: new THREE.RingGeometry(
      0.3,
      SIM.bosses.hydra.bite.range,
      14,
      1,
      -Math.PI / 2 - SIM.bosses.hydra.bite.arc / 2,
      SIM.bosses.hydra.bite.arc,
    ).rotateX(-Math.PI / 2),
    // ---------- Thanatos ----------
    robe: new THREE.ConeGeometry(0.42, 1.4, 10, 1, true).translate(0, 0.7, 0),
    hood: new THREE.SphereGeometry(0.22, 10, 8),
    scytheHandle: new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6),
    scytheBlade: new THREE.TorusGeometry(0.45, 0.04, 4, 12, Math.PI * 0.75),
    reapDisc: new THREE.CircleGeometry(SIM.bosses.thanatos.reap.radius, 36).rotateX(-Math.PI / 2),
    reapEdge: new THREE.RingGeometry(SIM.bosses.thanatos.reap.radius - 0.08, SIM.bosses.thanatos.reap.radius, 40).rotateX(-Math.PI / 2),
    slash: new THREE.RingGeometry(
      0.3,
      SIM.bosses.thanatos.blink.slashRange,
      16,
      1,
      -Math.PI / 2 - SIM.bosses.thanatos.blink.slashArc / 2,
      SIM.bosses.thanatos.blink.slashArc,
    ).rotateX(-Math.PI / 2),
    blinkMark: new THREE.RingGeometry(0.35, 0.55, 20).rotateX(-Math.PI / 2),
    hpBack: new THREE.PlaneGeometry(0.7, 0.09),
    hpFill: new THREE.PlaneGeometry(0.7, 0.09).translate(0.35, 0, 0),
  };
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x5dffa0 });
  const warnMat = () =>
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const hpBackMat = new THREE.MeshBasicMaterial({ color: 0x1a0a0c, depthTest: false });
  const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.75 });
  const lavaEyeMat = new THREE.MeshBasicMaterial({ color: 0xffb03a });
  const whiteEyeMat = new THREE.MeshBasicMaterial({ color: 0xe8f0ff });
  const frost = new THREE.Color(0x9fd8ff); // givre de la Nova
  const venomTint = new THREE.Color(0x6bff5a); // poison de la Chasseresse
  const auraMat = new THREE.MeshBasicMaterial({
    color: 0xf2c96b,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

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

  // Modèle de Cerbère : corps massif, quatre pattes, trois têtes, collier à pointes
  function buildCerberus(body, toon) {
    const fur = toon(0x3d3238);
    const torso = part(body, geo.dogTorso, fur, 0, 0.85, -0.1);
    torso.rotation.x = -0.12;
    // Poitrail plus massif à l'avant
    part(body, geo.dogBelly, fur, 0, 0.95, 0.35, false);
    for (const [x, z] of [[-0.35, 0.45], [0.35, 0.45], [-0.35, -0.6], [0.35, -0.6]]) part(body, geo.dogLeg, fur, x, 0.3, z);
    const heads = [];
    for (const x of [-0.42, 0, 0.42]) {
      const head = part(body, geo.dogHead, fur, x, 1.3 + (x === 0 ? 0.12 : 0), 0.75);
      part(head, geo.dogSnout, fur, 0, -0.05, 0.3, false);
      part(head, geo.eye, eyeMat, -0.1, 0.07, 0.24, false);
      part(head, geo.eye, eyeMat, 0.1, 0.07, 0.24, false);
      heads.push(head);
    }
    const collarMat = toon(0x8a6a2c);
    const collar = part(body, geo.collar, collarMat, 0, 1.1, 0.5, false);
    collar.rotation.x = Math.PI / 2 - 0.3;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const sp = new THREE.Mesh(geo.spike, collarMat);
      sp.position.set(Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0);
      sp.rotation.z = a - Math.PI / 2;
      collar.add(sp);
    }
    body.userData.heads = heads;
  }

  // Hydre : corps lové sur un lac de lave
  function buildHydra(body, toon) {
    const scales = toon(0x4a1f1a);
    const pool = new THREE.Mesh(geo.lavaPool, lavaMat);
    pool.position.y = 0.02;
    body.add(pool);
    for (let k = 0; k < 3; k++) {
      const c = part(body, geo.coil, scales, 0, 0.3 + k * 0.42, 0, k === 2);
      c.scale.setScalar(1 - k * 0.22);
    }
    part(body, geo.dogBelly, scales, 0, 1.5, 0, true).scale.set(0.8, 0.7, 0.8);
  }

  // Tête d'Hydre : long cou dressé, tête de serpent, mâchoire
  function buildHydraHead(body, toon) {
    const scales = toon(0x5a2a20);
    part(body, geo.neck, scales, 0, 0, 0);
    const head = part(body, geo.serpentHead, scales, 0, 1.15, 0.12);
    part(head, geo.jaw, toon(0x7a3a28), 0, -0.14, 0.04, false);
    part(head, geo.eye, lavaEyeMat, -0.1, 0.08, 0.18, false);
    part(head, geo.eye, lavaEyeMat, 0.1, 0.08, 0.18, false);
  }

  // Thanatos : grande silhouette en robe noire, capuche, ailes sombres, faux
  function buildThanatos(body, toon) {
    const robeMat = toon(0x1c1a24);
    robeMat.side = THREE.DoubleSide;
    part(body, geo.robe, robeMat, 0, 0, 0);
    part(body, geo.hood, toon(0x2a2632), 0, 1.5, 0);
    part(body, geo.eye, whiteEyeMat, -0.07, 1.5, 0.17, false);
    part(body, geo.eye, whiteEyeMat, 0.07, 1.5, 0.17, false);
    const wingMat = toon(0x15131c);
    wingMat.side = THREE.DoubleSide;
    const left = part(body, geo.wing, wingMat, 0.15, 1.2, -0.12, false);
    const right = part(body, geo.wing, wingMat, -0.15, 1.2, -0.12, false);
    left.scale.setScalar(1.6);
    right.scale.setScalar(1.6);
    right.rotation.y = Math.PI;
    body.userData.wings = [left, right];
    const scythe = new THREE.Group();
    scythe.position.set(0.45, 0.9, 0.15);
    scythe.add(new THREE.Mesh(geo.scytheHandle, toon(0x3a2c1c)));
    const blade = new THREE.Mesh(geo.scytheBlade, toon(0xc8ccd4));
    blade.position.y = 0.85;
    blade.rotation.z = Math.PI * 0.6;
    scythe.add(blade);
    body.add(scythe);
  }

  // Marquages d'attaque par type (un par attaque, un seul visible à la fois)
  function makeWarns(type) {
    const reapMats = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo.reapDisc, warnMat()), new THREE.Mesh(geo.reapEdge, warnMat()));
      return g;
    };
    if (type === 'cerberus') {
      const breath = new THREE.Group();
      for (const a of SIM.bosses.cerberus.breath.angles) breath.add(new THREE.Mesh(geo.breathCone(a), warnMat()));
      const howlMat = warnMat();
      howlMat.color.set(0x2fff86);
      return {
        charge: new THREE.Mesh(geo.bossCharge, warnMat()),
        bite: new THREE.Mesh(geo.bossBite, warnMat()),
        breath,
        howl: new THREE.Mesh(geo.howlRing, howlMat),
      };
    }
    if (type === 'hydraHead') {
      const spit = new THREE.Group();
      const sp = SIM.bosses.hydra.spit;
      for (let k = 0; k < sp.count; k++) spit.add(new THREE.Mesh(geo.spitLine((k - (sp.count - 1) / 2) * sp.spread), warnMat()));
      return { spit, bite: new THREE.Mesh(geo.headBite, warnMat()) };
    }
    if (type === 'thanatos') return { reap: reapMats(), slash: new THREE.Mesh(geo.slash, warnMat()) };
    if (type === 'thanatosDouble') return { reap: reapMats() };
    return {}; // le corps de l'Hydre n'attaque pas lui-même
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
    } else if (e.type === 'cerberus') {
      buildCerberus(body, toon);
    } else if (e.type === 'hydra') {
      buildHydra(body, toon);
    } else if (e.type === 'hydraHead') {
      buildHydraHead(body, toon);
    } else if (e.type === 'thanatos' || e.type === 'thanatosDouble') {
      buildThanatos(body, toon);
    } else if (e.type === 'fury') {
      part(body, geo.furyBody, toon(0x8c1d3c), 0, 0.1, 0);
      part(body, geo.shadeHead, toon(0x5a1028), 0, 1.0, 0);
      part(body, geo.eye, eyeMat, -0.07, 1.03, 0.16, false);
      part(body, geo.eye, eyeMat, 0.07, 1.03, 0.16, false);
      const wingMat = toon(0x3a0a18);
      wingMat.side = THREE.DoubleSide;
      const left = part(body, geo.wing, wingMat, 0.12, 0.85, -0.05, false);
      const right = part(body, geo.wing, wingMat, -0.12, 0.85, -0.05, false);
      right.rotation.y = Math.PI;
      body.userData.wings = [left, right];
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
    // Indice pour démasquer les doubles : seul le vrai Thanatos projette une ombre
    if (e.type !== 'thanatosDouble' && e.type !== 'hydra') root.add(shadow);

    // Thanatos : marque au sol là où il va réapparaître (indépendante de sa position)
    let blinkMark = null;
    if (e.type === 'thanatos') {
      const m = warnMat();
      m.color.set(0xb9c8ff);
      blinkMark = new THREE.Mesh(geo.blinkMark, m);
      blinkMark.visible = false;
      scene.add(blinkMark);
    }

    // Élite : plus grande, aura dorée au sol, teinte légèrement dorée
    if (e.elite) {
      body.scale.setScalar(1.22);
      const aura = new THREE.Mesh(geo.aura, auraMat);
      aura.position.y = 0.025;
      root.add(aura);
      for (const m of mats) m.userData.base.lerp(new THREE.Color(0xf2c96b), 0.25);
    }

    // Marquage d'attaque (invisible hors préparation)
    let warn;
    let bossWarns = null;
    if (e.boss || e.part) {
      // Plusieurs attaques : un marquage par attaque, un seul visible à la fois
      const g = new THREE.Group();
      bossWarns = makeWarns(e.type);
      for (const m of Object.values(bossWarns)) {
        m.visible = false;
        g.add(m);
      }
      warn = g;
    } else {
      const warnGeo = e.type === 'shade' ? geo.strike : e.type === 'fury' ? geo.chargeLine : geo.aimLine;
      warn = new THREE.Mesh(warnGeo, warnMat());
    }
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
    if (e.boss) hp.visible = false; // la vie du boss s'affiche en haut de l'écran
    return { root, body, mats, warn, bossWarns, blinkMark, hp, fill, type: e.type, boss: e.boss, scale: e.elite ? 1.22 : 1 };
  }

  const white = new THREE.Color(0xffffff);
  const spectral = new THREE.Color(0x2fff86);

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
        // L'Ombre et la Furie flottent ; le squelette reste au sol
        const grounded = e.type === 'archer' || e.type === 'cerberus' || e.type === 'hydra' || e.type === 'hydraHead';
        v.body.position.y = grounded ? 0 : 0.12 + Math.sin(time * 3 + e.id) * 0.05;
        // Thanatos téléporté : invisible, une marque montre où il va surgir
        v.body.visible = !e.untargetable;
        if (v.blinkMark) {
          v.blinkMark.visible = e.mode === 'vanish';
          if (v.blinkMark.visible) {
            v.blinkMark.position.set(e.blinkX, 0.035, e.blinkZ);
            v.blinkMark.scale.setScalar(1 + Math.sin(time * 12) * 0.12);
            v.blinkMark.material.opacity = 0.5 + 0.4 * (1 - e.timer / (e.windupTotal || 1));
          }
        }
        if (v.body.userData.wings) {
          // Battement d'ailes, frénétique pendant la charge
          const speed = e.mode === 'charge' ? 30 : 9;
          const flap = Math.sin(time * speed + e.id) * 0.5;
          v.body.userData.wings[0].rotation.y = flap;
          v.body.userData.wings[1].rotation.y = Math.PI - flap;
        }

        // Clignotement blanc quand il est touché ; teinte de givre quand la Nova le ralentit
        const flash = e.hitFlash > 0 ? 0.85 : 0;
        for (const m of v.mats) {
          m.color.copy(m.userData.base).lerp(white, flash);
          if (!flash && e.slow > 0) m.color.lerp(frost, 0.45);
          else if (!flash && e.poison > 0) m.color.lerp(venomTint, 0.35);
        }

        // Boss : le marquage de l'attaque annoncée, de plus en plus net jusqu'au coup
        if (v.bossWarns) {
          for (const [kind, m] of Object.entries(v.bossWarns)) m.visible = e.mode === 'windup' && e.attack === kind;
          if (e.mode === 'windup') {
            const k = 1 - e.timer / (e.windupTotal || 1);
            v.warn.rotation.y = Math.atan2(e.aimX, e.aimZ);
            v.warn.traverse((o) => {
              if (o.material && o.material.opacity !== undefined && o.isMesh) o.material.opacity = 0.15 + 0.55 * k;
            });
            if (e.attack === 'howl') v.bossWarns.howl.scale.setScalar(1 + k * 2.5);
            // Faux de Thanatos : le disque se "remplit" depuis le centre
            if (e.attack === 'reap') v.bossWarns.reap.children[0].scale.setScalar(Math.max(0.05, k));
          }
          // Sonné (après une charge contre un mur) : il titube
          v.body.rotation.z = e.mode === 'recover' && e.stunned ? Math.sin(time * 7) * 0.12 : 0;
          // Touché : éclair blanc. Invulnérable (hurlement) : voile vert spectral
          for (const m of v.mats) {
            m.color.copy(m.userData.base);
            if (e.hitFlash > 0) m.color.lerp(white, 0.6);
            else if (e.invulnerable) m.color.lerp(spectral, 0.35);
          }
          // Les têtes d'Hydre ont leur petite barre ; les boss ont la leur en haut de l'écran
          v.hp.visible = e.type === 'hydraHead' && e.hp < e.maxHp;
          v.fill.scale.x = Math.max(0.001, e.hp / e.maxHp);
          continue;
        }

        // Préparation : le marquage rouge s'intensifie jusqu'au coup
        if (e.mode === 'windup') {
          const total = SIM.enemies[e.type].windup * SIM.tickRate;
          const k = 1 - e.timer / total;
          v.warn.visible = true;
          v.warn.material.opacity = 0.15 + 0.5 * k;
          v.warn.rotation.y = Math.atan2(e.aimX, e.aimZ);
          if (e.type === 'shade') v.body.scale.setScalar(v.scale * (1 + 0.12 * k)); // se gonfle avant de frapper
        } else {
          v.warn.visible = false;
          v.body.scale.setScalar(v.scale);
        }
        // Furie étourdie (après sa charge) : elle penche, sonnée
        v.body.rotation.z = e.type === 'fury' && e.mode === 'recover' ? Math.sin(time * 6) * 0.25 : 0;

        v.hp.visible = e.hp < e.maxHp;
        v.fill.scale.x = Math.max(0.001, e.hp / e.maxHp);
      }
      // Ennemis disparus (vaincus ou changement d'étage) : on retire leur vue et on
      // libère les matériaux qui lui sont propres (les géométries sont partagées)
      for (const [id, v] of views) {
        if (alive.has(id)) continue;
        scene.remove(v.root);
        v.mats.forEach((m) => m.dispose());
        v.warn.traverse((o) => {
          if (o.isMesh) o.material.dispose();
        });
        v.fill.material.dispose();
        if (v.blinkMark) {
          scene.remove(v.blinkMark);
          v.blinkMark.material.dispose();
        }
        views.delete(id);
      }
    },
  };
}

// Flèches : un seul InstancedMesh pour toutes (1 appel de dessin)
export function createProjectileView(scene, haloTexture) {
  const max = 64;
  // Flèches et venin : bâtonnets colorés par instance
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.55),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    max,
  );
  mesh.count = 0;
  mesh.frustumCulled = false;
  for (let i = 0; i < max; i++) mesh.setColorAt(i, new THREE.Color(0xffffff));
  scene.add(mesh);
  // Orbes de la Mystique : cœur clair + halo additif
  const orbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xd9ccff }), max);
  const glows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({
      map: haloTexture,
      color: 0x8a5cff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    max,
  );
  for (const o of [orbs, glows]) {
    o.count = 0;
    o.frustumCulled = false;
    scene.add(o);
  }
  const arrowColor = new THREE.Color(0xffd27a);
  const venomColor = new THREE.Color(0xff7a2f);
  const reflectedColor = new THREE.Color(0x9fe8ff); // renvoyé par le Bouclier du vent
  const heroColor = new THREE.Color(0xeafff2); // flèche de la Chasseresse
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  return {
    // lag : fraction du pas pas encore écoulée (interpolation vers l'arrière)
    // camQuat : orientation de la caméra (les halos lui font face)
    update(projectiles, lag, step, camQuat, time = 0) {
      let n = 0;
      let o = 0;
      for (const a of projectiles) {
        p.set(a.x - a.vx * step * lag, 0.75, a.z - a.vz * step * lag);
        if (a.kind === 'orb') {
          if (o >= max) continue;
          const k = 1 + Math.sin(time * 18 + a.id) * 0.12;
          orbs.setMatrixAt(o, m.compose(p, q.identity(), s.set(k, k, k)));
          glows.setMatrixAt(o, m.compose(p, camQuat || q, s.set(k, k, 1)));
          o++;
          continue;
        }
        if (n >= max) continue;
        q.setFromAxisAngle(up, Math.atan2(a.vx, a.vz));
        mesh.setMatrixAt(n, m.compose(p, q, s.set(1, 1, 1)));
        const c = a.reflected ? reflectedColor : a.friendly ? heroColor : a.kind === 'venom' ? venomColor : arrowColor;
        mesh.setColorAt(n, c);
        n++;
      }
      s.set(1, 1, 1);
      mesh.count = n;
      orbs.count = o;
      glows.count = o;
      for (const x of [mesh, orbs, glows]) x.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
