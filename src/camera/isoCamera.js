import * as THREE from 'three';

// Caméra isométrique : projection orthographique (les objets ne rapetissent pas
// avec la distance, comme dans Hades), placée en diagonale au sud-est du héros.
// Elle ne tourne jamais : seule sa position suit le héros.
export function createIsoCamera(settings) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, settings.distance * 2.5);

  // Décalage caméra -> cible
  const offset = new THREE.Vector3(
    Math.sin(settings.yaw) * Math.cos(settings.pitch),
    Math.sin(settings.pitch),
    Math.cos(settings.yaw) * Math.cos(settings.pitch),
  ).multiplyScalar(settings.distance);

  // Axes de l'écran projetés au sol (dans le repère x, z du monde)
  // "droite de l'écran" et "haut de l'écran"
  const right = { x: Math.cos(settings.yaw), z: -Math.sin(settings.yaw) };
  const up = { x: -Math.sin(settings.yaw), z: -Math.cos(settings.yaw) };

  const api = {
    camera,
    // Adapte le cadrage au format de l'écran
    resize(width, height) {
      const aspect = width / height;
      let h = settings.viewSize;
      // En portrait, on garantit une largeur minimale de terrain visible
      if (h * aspect < settings.minViewWidth) h = settings.minViewWidth / aspect;
      camera.top = h / 2;
      camera.bottom = -h / 2;
      camera.left = (-h * aspect) / 2;
      camera.right = (h * aspect) / 2;
      camera.updateProjectionMatrix();
    },
    // Place la caméra pour viser le point (x, z) au sol
    follow(x, z) {
      camera.position.set(x + offset.x, offset.y, z + offset.z);
      camera.lookAt(x, 0, z);
    },
    // Convertit une direction "écran" (x à droite, y en haut) en direction du MONDE
    // au format de l'intention (moveX vers +x, moveY vers le nord = z négatif)
    screenToWorld(sx, sy) {
      const wx = sx * right.x + sy * up.x;
      const wz = sx * right.z + sy * up.z;
      return { x: wx, y: -wz };
    },
  };
  api.follow(0, 0);
  return api;
}
