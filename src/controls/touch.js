// Contrôles mobiles : joystick virtuel qui apparaît sous le pouce, sur la partie
// gauche de l'écran. La partie droite est réservée aux boutons d'action (étape 3).
// Les Pointer Events gèrent le multitouch : chaque doigt a son pointerId.

export function createTouchControls(settings) {
  const ui = document.getElementById('touch-ui');
  const zone = document.getElementById('joystick-zone');
  const base = document.getElementById('joystick-base');
  const knob = document.getElementById('joystick-knob');
  const radius = settings.joystickRadius;

  ui.hidden = false;

  const move = { x: 0, y: 0 };
  let joyId = null;
  let cx = 0;
  let cy = 0;

  zone.addEventListener('pointerdown', (e) => {
    if (joyId !== null) return;
    joyId = e.pointerId;
    // Capture du doigt : la zone continue de recevoir ses mouvements même s'il en sort
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* doigt déjà relevé : sans gravité */
    }
    cx = e.clientX;
    cy = e.clientY;
    base.style.left = `${cx}px`;
    base.style.top = `${cy}px`;
    base.classList.add('active');
    knob.style.transform = 'translate(0px, 0px)';
  });

  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Petite zone morte au centre pour éviter les dérives
    const k = len / radius < settings.deadZone ? 0 : 1;
    move.x = (dx / radius) * k;
    move.y = (-dy / radius) * k; // vers le haut de l'écran = y positif
  });

  const end = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    move.x = 0;
    move.y = 0;
    base.classList.remove('active');
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  return {
    getMove() {
      return { x: move.x, y: move.y };
    },
  };
}
