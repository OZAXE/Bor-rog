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
    // aimFromMouse(x, y) : fournie par le rendu, convertit la position de la souris
    // à l'écran en direction de visée { x, y } dans le repère de l'intention (ou null)
    getIntent(aimFromMouse) {
      const t = touch ? touch.getMove() : { x: 0, y: 0 };
      // Le joystick est prioritaire s'il est utilisé
      const move = t.x !== 0 || t.y !== 0 ? t : kb.getMove();
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
