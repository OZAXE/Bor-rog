// Détection du type d'appareil : une seule version du jeu, l'interface s'adapte.

// "pointer: coarse" = pointeur imprécis (doigt). Plus fiable que le user-agent.
const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const hasFinePointer = window.matchMedia?.('(any-pointer: fine)').matches ?? true;

export const DEVICE = {
  // Mobile si l'écran tactile est le pointeur principal
  isMobile: coarsePointer && hasTouch,
  hasTouch,
  hasFinePointer,
};
