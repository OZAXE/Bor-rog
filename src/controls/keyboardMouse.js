// Contrôles PC : clavier pour se déplacer, souris pour viser.
//
// On utilise event.code (touche PHYSIQUE) et non event.key (caractère tapé) :
// "KeyW" est le Z en AZERTY et le W en QWERTY, donc ZQSD et WASD marchent sans réglage.

const KEYS = {
  up: ['KeyW', 'ArrowUp'], // Z en AZERTY
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], // Q en AZERTY
  right: ['KeyD', 'ArrowRight'],
};

export function createKeyboardMouse() {
  const pressed = new Set();
  // Position de la souris dans la fenêtre ; null tant qu'elle n'a pas bougé
  // (sur une tablette avec clavier, on ne vise donc pas un point fantôme)
  let mouse = null;

  const is = (action) => KEYS[action].some((code) => pressed.has(code));

  window.addEventListener('keydown', (e) => {
    pressed.add(e.code);
    // Empêche le défilement de la page avec espace / flèches
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => pressed.delete(e.code));
  // Si la fenêtre perd le focus, on relâche tout (sinon le héros continue d'avancer)
  window.addEventListener('blur', () => pressed.clear());

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY };
  });

  return {
    // Vecteur de déplacement (-1..1), y > 0 = vers le haut de l'écran
    getMove() {
      return {
        x: (is('right') ? 1 : 0) - (is('left') ? 1 : 0),
        y: (is('up') ? 1 : 0) - (is('down') ? 1 : 0),
      };
    },
    getMouse() {
      return mouse;
    },
  };
}
