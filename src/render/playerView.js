import * as THREE from 'three';

// Rendu du héros : corps en capsule, tête, épée qui montre l'orientation,
// et ombre "disque" au sol (pas de shadow maps).
// Lit la position interpolée, ne touche jamais à l'état du jeu.
export function createPlayerView(scene) {
  const root = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.42, 3, 8),
    new THREE.MeshLambertMaterial({ color: 0x3d6fb0 }),
  );
  body.position.y = 0.5;
  root.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xe8c9a0 }),
  );
  head.position.y = 1.0;
  root.add(head);

  // Épée tenue devant : indique dans quelle direction le héros regarde
  const sword = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, 0.5),
    new THREE.MeshLambertMaterial({ color: 0xd8dde3 }),
  );
  sword.position.set(0.2, 0.55, 0.32);
  root.add(sword);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  scene.add(shadow);

  scene.add(root);

  return {
    // x, z : position au sol ; facing : orientation ; speed : pour le petit rebond de marche
    update(x, z, facing, speed, time) {
      root.position.set(x, 0, z);
      root.rotation.y = facing;
      const bob = speed > 0.2 ? Math.abs(Math.sin(time * 12)) * 0.06 : 0;
      body.position.y = 0.5 + bob;
      head.position.y = 1.0 + bob;
      shadow.position.set(x, 0.012, z);
    },
  };
}
