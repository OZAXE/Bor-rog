import * as THREE from 'three';

// Caméra plongeante qui suit un point (le joueur).
// Elle ne tourne pas : en vue de dessus, une orientation fixe aide le joueur
// à se repérer, et "haut de l'écran" veut toujours dire la même chose.
export function createTopDownCamera(settings) {
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.5, 100);

  // Décalage caméra -> cible, calculé une fois à partir de l'angle et de la distance
  const offset = new THREE.Vector3(
    Math.sin(settings.yaw) * Math.cos(settings.pitch),
    Math.sin(settings.pitch),
    Math.cos(settings.yaw) * Math.cos(settings.pitch),
  ).multiplyScalar(settings.distance);

  return {
    camera,
    // Place la caméra au-dessus de la cible (x, z au sol)
    follow(x, z) {
      camera.position.set(x + offset.x, offset.y, z + offset.z);
      camera.lookAt(x, 0, z);
    },
  };
}
