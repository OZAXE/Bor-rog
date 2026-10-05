// Structure d'une partie : 3 zones de 3 étages. Le 3e étage de chaque zone est un
// étage de boss ; vaincre le boss de la dernière zone, c'est la victoire.

export const FLOORS_PER_ZONE = 3;

export const ZONES = [
  { id: 'tartarus', name: 'Le Tartare', boss: 'cerberus' },
  { id: 'asphodel', name: "L'Asphodèle", boss: 'hydra' },
  { id: 'elysium', name: "L'Élysée", boss: 'thanatos' },
];

// Boss déjà jouables (les autres arrivent à l'étape 5b-2 : en attendant, leur
// étage reste un étage normal)
export const IMPLEMENTED_BOSSES = new Set(['cerberus']);

export function zoneIndexOf(floorIndex) {
  return Math.min(ZONES.length - 1, Math.floor(floorIndex / FLOORS_PER_ZONE));
}

export function zoneOf(floorIndex) {
  return ZONES[zoneIndexOf(floorIndex)];
}

// Identifiant du boss de cet étage, ou null si c'est un étage normal
export function bossOf(floorIndex) {
  if (floorIndex % FLOORS_PER_ZONE !== FLOORS_PER_ZONE - 1) return null;
  if (floorIndex >= ZONES.length * FLOORS_PER_ZONE) return null;
  const boss = zoneOf(floorIndex).boss;
  return IMPLEMENTED_BOSSES.has(boss) ? boss : null;
}
