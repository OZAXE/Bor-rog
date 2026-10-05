import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { DEVICE } from './device.js';

// Crée le renderer WebGL avec des réglages pensés pour le mobile.
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // L'antialiasing coûte cher sur mobile, et le pixel ratio élevé compense déjà
    antialias: !DEVICE.isMobile,
    powerPreference: 'high-performance',
    stencil: false,
  });

  // Limite le pixel ratio : un écran x3 rendrait 9 fois plus de pixels qu'en x1
  const maxRatio = DEVICE.isMobile
    ? CONFIG.render.maxPixelRatioMobile
    : CONFIG.render.maxPixelRatioDesktop;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));

  // Pas d'ombres projetées (trop coûteux), on utilise une ombre "disque" sous le perso
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return renderer;
}

// Adapte la taille du rendu et la caméra à la fenêtre
export function bindResize(renderer, camera) {
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  // Sur mobile, la rotation de l'écran ne déclenche pas toujours "resize" tout de suite
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  return resize;
}
