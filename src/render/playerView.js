import * as THREE from 'three';

// Rendu du héros, style "cel shading" : ombrage en 3 paliers nets + contour d'encre
// (coque inversée : une copie un peu plus grosse, noire, dont on ne voit que l'arrière).
// Un modèle par classe, tout en code :
//   Guerrier    : tunique pourpre, couronne de laurier, épée de bronze, bouclier rond
//   Chasseresse : tenue vert sombre, capuche, arc et carquois
//   Mystique    : longue robe violette, capuche, bâton surmonté d'un orbe lumineux
// Lit la position interpolée, ne touche jamais à l'état du jeu.

const OUTLINE = 0.035; // épaisseur du contour (m)

export function createPlayerView(scene, gradientMap) {
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap });
  const ink = new THREE.MeshBasicMaterial({ color: 0x05080a, side: THREE.BackSide });

  // Ajoute une pièce (et son contour) à un groupe
  function part(group, geometry, material, x, y, z, outline = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (outline) {
      const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
      const size = box.getSize(new THREE.Vector3());
      const o = new THREE.Mesh(geometry, ink);
      o.scale.set(1 + (2 * OUTLINE) / size.x, 1 + (2 * OUTLINE) / size.y, 1 + (2 * OUTLINE) / size.z);
      mesh.add(o);
    }
    group.add(mesh);
    return mesh;
  }
  const skin = toon(0xe2b48c);

  // ---------- Guerrier ----------
  function warrior() {
    const g = new THREE.Group();
    const body = part(g, new THREE.CapsuleGeometry(0.25, 0.42, 3, 10), toon(0x8c1d2c), 0, 0.5, 0);
    const head = part(g, new THREE.SphereGeometry(0.17, 12, 10), skin, 0, 1.0, 0);
    const laurel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 14), toon(0xe8c45a));
    laurel.rotation.x = Math.PI / 2;
    laurel.position.y = 0.08;
    head.add(laurel);
    // Épée de bronze tenue devant : indique l'orientation
    part(g, new THREE.BoxGeometry(0.07, 0.07, 0.55), toon(0xd9b36a), 0.22, 0.55, 0.34);
    // Bouclier rond au bras gauche
    const shield = part(g, new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14), toon(0xb8862f), -0.3, 0.55, 0.08);
    shield.rotation.z = Math.PI / 2;
    shield.rotation.y = 0.35;
    return { g, body, head };
  }

  // ---------- Chasseresse ----------
  function huntress() {
    const g = new THREE.Group();
    const body = part(g, new THREE.CapsuleGeometry(0.22, 0.42, 3, 10), toon(0x2e5f45), 0, 0.5, 0);
    const head = part(g, new THREE.SphereGeometry(0.16, 12, 10), skin, 0, 1.0, 0);
    // Capuche : demi-sphère un peu plus grosse, ouverte vers l'avant
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, Math.PI * 0.75, Math.PI * 1.5), toon(0x1f4433));
    head.add(hood);
    // Arc : demi-anneau vertical tenu à gauche, corde tendue
    const bow = part(g, new THREE.TorusGeometry(0.34, 0.025, 6, 18, Math.PI), toon(0x7a4a24), -0.24, 0.62, 0.22);
    bow.rotation.y = Math.PI / 2;
    bow.rotation.z = -Math.PI / 2;
    part(g, new THREE.BoxGeometry(0.01, 0.68, 0.01), toon(0xe9e2cf), -0.24, 0.62, 0.22, false);
    // Carquois dans le dos, plumes dorées
    const quiver = part(g, new THREE.CylinderGeometry(0.07, 0.06, 0.4, 8), toon(0x5a3a22), 0.1, 0.72, -0.24);
    quiver.rotation.x = -0.35;
    part(g, new THREE.ConeGeometry(0.06, 0.1, 6), toon(0xf2c96b), 0.1, 0.97, -0.33, false);
    return { g, body, head };
  }

  // ---------- Mystique ----------
  let orbGlow = null;
  function mystic() {
    const g = new THREE.Group();
    // Longue robe : cône évasé jusqu'au sol
    const body = part(g, new THREE.ConeGeometry(0.33, 0.95, 12), toon(0x3b2a6b), 0, 0.48, 0);
    const head = part(g, new THREE.SphereGeometry(0.16, 12, 10), skin, 0, 1.03, 0);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 10), toon(0x2a1d4f));
    hood.position.y = 0.1;
    head.add(hood);
    // Bâton tenu à droite, orbe lumineux au sommet
    part(g, new THREE.CylinderGeometry(0.025, 0.03, 1.25, 6), toon(0x6b4a2a), 0.3, 0.68, 0.12);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xc9b6ff }),
    );
    orb.position.set(0.3, 1.36, 0.12);
    g.add(orb);
    orbGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    orbGlow.position.copy(orb.position);
    g.add(orbGlow);
    return { g, body, head };
  }

  const models = { warrior: warrior(), huntress: huntress(), mystic: mystic() };
  const root = new THREE.Group();
  for (const m of Object.values(models)) {
    m.baseBody = m.body.position.y;
    m.baseHead = m.head.position.y;
    root.add(m.g);
  }
  let current = null;
  function setClass(cls) {
    const id = models[cls] ? cls : 'warrior';
    if (id === current) return;
    current = id;
    for (const [k, m] of Object.entries(models)) m.g.visible = k === id;
  }
  setClass('warrior');

  // Ombre "disque" au sol (pas de shadow maps)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  scene.add(root);

  return {
    setClass,
    // x, z : position au sol ; facing : orientation ; speed : pour le petit rebond de marche
    // fx : { blink, dashing } — clignote quand il vient d'être touché, s'étire en esquivant
    update(x, z, facing, speed, time, fx = {}) {
      root.position.set(x, 0, z);
      root.rotation.y = facing;
      root.visible = !fx.blink || Math.floor(time * 20) % 2 === 0;
      root.scale.set(fx.dashing ? 0.8 : 1, 1, fx.dashing ? 1.35 : 1);
      const bob = speed > 0.2 ? Math.abs(Math.sin(time * 12)) * 0.06 : 0;
      const m = models[current];
      m.body.position.y = m.baseBody + bob;
      m.head.position.y = m.baseHead + bob;
      if (orbGlow) orbGlow.scale.setScalar(1 + Math.sin(time * 5) * 0.15);
      shadow.position.set(x, 0.015, z);
    },
  };
}
