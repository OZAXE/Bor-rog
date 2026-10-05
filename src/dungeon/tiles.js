// Types de cases de la grille du donjon et petites fonctions d'accès.
// Une case = 1 m × 1 m. La case (c, r) couvre x ∈ [c, c+1] et z ∈ [r, r+1].

export const TILE = {
  VOID: 0, // roche pleine (hors donjon)
  FLOOR: 1, // sol praticable
  WALL: 2, // mur (bord d'une salle ou d'un couloir)
  PILLAR: 3, // pilier au milieu d'une salle
  STAIRS: 4, // escalier vers l'étage suivant (praticable)
};

// Case bloquante pour les déplacements ?
export function isSolid(tile) {
  return tile === TILE.VOID || tile === TILE.WALL || tile === TILE.PILLAR;
}

export function isWalkable(tile) {
  return tile === TILE.FLOOR || tile === TILE.STAIRS;
}

// Lecture d'une case ; hors de la carte = roche pleine
export function tileAt(dungeon, c, r) {
  if (c < 0 || r < 0 || c >= dungeon.width || r >= dungeon.height) return TILE.VOID;
  return dungeon.tiles[r * dungeon.width + c];
}
