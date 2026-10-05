import { DEVICE } from '../core/device.js';
import { CONFIG } from '../config.js';
import { createKeyboardMouse } from './keyboardMouse.js';
import { createTouchControls } from './touch.js';

// Rassemble toutes les sources d'entrée en un seul objet "intention" pour la simulation.
// Le reste du jeu ne sait pas si on joue au clavier, à la souris ou au doigt.
export function createInput() {
  // Le clavier reste actif même sur tablette (clavier Bluetooth, PC tactile…)
  const kb = createKeyboardMouse();
  const touch = DEVICE.isMobile ? createTouchControls(CONFIG.controls) : null;

  return {
    // L'intention est exprimée dans le repère du MONDE (indépendant de la caméra),
    // pour que la simulation, et plus tard le serveur, n'aient pas à connaître la vue.
    // screenToWorld(x, y) : convertit une direction écran en direction monde
    // aimFromMouse(x, y) : convertit la position de la souris en direction de visée (ou null)
    getIntent(screenToWorld, aimFromMouse) {
      const t = touch ? touch.getMove() : { x: 0, y: 0 };
      // Le joystick est prioritaire s'il est utilisé
      const screenMove = t.x !== 0 || t.y !== 0 ? t : kb.getMove();
      const move = screenToWorld(screenMove.x, screenMove.y);
      // Sur mobile, on ignore la souris : certains navigateurs émettent des événements
      // "souris" après un toucher, qui figeraient l'orientation du héros
      const mouse = touch ? null : kb.getMouse();
      const aim = mouse ? aimFromMouse(mouse.x, mouse.y) : null;
      return {
        moveX: move.x,
        moveY: move.y,
        aimX: aim ? aim.x : 0,
        aimY: aim ? aim.y : 0,
        attack: false, // étape 3
        dash: false, // étape 3
      };
    },
  };
}
