// Boucle à pas fixe : la simulation avance toujours par pas de 1/60 s,
// quelle que soit la fréquence de l'écran (30, 60, 120 Hz…).
//
// Pourquoi ? Avec un pas variable, le résultat d'une partie dépendrait de
// l'ordinateur (un PC rapide et un téléphone lent ne verraient pas la même
// chose). Avec un pas fixe, la simulation est déterministe : même graine +
// mêmes intentions = même partie, partout.
//
// Le rendu, lui, affiche une position interpolée entre les deux derniers pas
// (coefficient "alpha") pour rester fluide sur les écrans rapides.
// Ce module ne dépend ni de Three.js ni du navigateur : il est testable dans Node.

export function createFixedStep(step, maxStepsPerFrame = 5) {
  let accumulator = 0;

  return {
    step,
    // dt : temps réel écoulé depuis la dernière image (secondes)
    // onTick : appelée une fois par pas de simulation
    // Renvoie alpha (0..1) : la fraction du pas suivant déjà écoulée
    advance(dt, onTick) {
      // Après un onglet en arrière-plan, dt peut valoir plusieurs secondes :
      // on plafonne pour éviter une "spirale" de rattrapage qui gèle le jeu
      accumulator += Math.min(Math.max(dt, 0), step * maxStepsPerFrame);
      while (accumulator >= step) {
        onTick();
        accumulator -= step;
      }
      return accumulator / step;
    },
    reset() {
      accumulator = 0;
    },
  };
}
