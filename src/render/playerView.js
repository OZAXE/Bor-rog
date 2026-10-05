import * as THREE from 'three';

// Rendu du héros, style "cel shading" : ombrage en 3 paliers nets + contour d'encre
// (coque inversée : une copie un peu plus grosse, noire, dont on ne voit que l'arrière).
// Tunique pourpre et couronne de laurier dorée, pour l'ambiance des enfers grecs.
// Lit la position interpolée, ne touche jamais à l'état du jeu.

const OUTLINE = 0.035; // épaisseur du contour (m)

export function createPlayerView(scene, gradientMap) {
  const root = new THREE.Group();
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap });
  const ink = new THREE.MeshBasicMaterial({ color: 0x05080a, side: THREE.BackSide });

  // Ajoute une pièce et son contour
  function part(geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    const size = box.getSize(new THREE.Vector3());
    const outline = new THREE.Mesh(geometry, ink);
    outline.scale.set(1 + (2 * OUTLINE) / size.x, 1 + (2 * OUTLINE) / size.y, 1 + (2 * OUTLINE) / size.z);
    mesh.add(outline);
    root.add(mesh);
    return mesh;
  }

  const body = part(new THREE.CapsuleGeometry(0.25, 0.42, 3, 10), toon(0x8c1d2c), 0, 0.5, 0);
  const head = part(new THREE.SphereGeometry(0.17, 12, 10), toon(0xe2b48c), 0, 1.0, 0);
  // Couronne de laurier
  const laurel = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.035, 6, 14),
    new THREE.MeshToonMaterial({ color: 0xe8c45a, gradientMap }),
  );
  laurel.rotation.x = Math.PI / 2;
  laurel.position.y = 0.08;
  head.add(laurel);
  // Épée de bronze tenue devant : indique l'orientation
  part(new THREE.BoxGeometry(0.07, 0.07, 0.55), toon(0xd9b36a), 0.22, 0.55, 0.34);

  // Ombre "disque" au sol (pas de shadow maps)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  scene.add(root);

  return {
    // x, z : position au sol ; facing : orientation ; speed : pour le petit rebond de marche
    // fx : { blink, dashing } — clignote quand il vient d'être touché, s'étire en esquivant
    update(x, z, facing, speed, time, fx = {}) {
      root.position.set(x, 0, z);
      root.rotation.y = facing;
      root.visible = !fx.blink || Math.floor(time * 20) % 2 === 0;
      root.scale.set(fx.dashing ? 0.8 : 1, 1, fx.dashing ? 1.35 : 1);
      const bob = speed > 0.2 ? Math.abs(Math.sin(time * 12)) * 0.06 : 0;
      body.position.y = 0.5 + bob;
      head.position.y = 1.0 + bob;
      shadow.position.set(x, 0.015, z);
    },
  };
}
