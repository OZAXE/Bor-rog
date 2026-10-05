// L'"intention" : ce que le joueur VEUT faire pendant un pas de simulation.
// C'est la seule chose que les contrôles (clavier, souris, tactile) transmettent
// à la simulation. En multijoueur, c'est aussi ce que chaque client enverra au serveur.
//
// Repère du MONDE, indépendant de la caméra : moveX > 0 = vers l'est (x croissant),
// moveY > 0 = vers le nord (z décroissant). Ce sont les contrôles qui convertissent
// "haut de l'écran" en direction du monde selon l'angle de la caméra.
// aim = direction visée (même repère), nulle si le joueur ne vise pas (mobile).

export const EMPTY_INTENT = Object.freeze({
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  attack: false,
  dash: false,
  choice: -1, // écran de Charon : bienfait choisi (0 à 3), -1 = aucun
  shop: '', // écran de Charon : 'heal' ou 'reroll' (achat), '' = rien
});

// Nettoie une intention venue de l'extérieur (contrôles, ou réseau plus tard) :
// valeurs manquantes ou invalides -> 0, déplacement limité à une longueur de 1
// (pour qu'aller en diagonale ne soit pas plus rapide)
export function sanitizeIntent(raw) {
  const i = raw || EMPTY_INTENT;
  let moveX = finite(i.moveX);
  let moveY = finite(i.moveY);
  const len = Math.hypot(moveX, moveY);
  if (len > 1) {
    moveX /= len;
    moveY /= len;
  }
  return {
    moveX,
    moveY,
    aimX: finite(i.aimX),
    aimY: finite(i.aimY),
    attack: i.attack === true,
    dash: i.dash === true,
    choice: Number.isInteger(i.choice) && i.choice >= 0 && i.choice < 4 ? i.choice : -1,
    shop: i.shop === 'heal' || i.shop === 'reroll' ? i.shop : '',
  };
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
