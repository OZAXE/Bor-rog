// Classes du héros : identité (nom, description). Toutes sont jouables dès le départ :
// on les fait progresser au fil des parties (unlockBoss : null = aucune condition).
// Les chiffres de jeu sont dans SIM.classes (src/systems/simConfig.js).

import { SIM } from './simConfig.js';

export const CLASSES = {
  warrior: {
    name: 'Guerrier',
    weaponName: 'Épée et bouclier',
    text: 'Corps à corps, coups larges, robuste.',
    unlockBoss: null, // disponible dès le départ
  },
  huntress: {
    name: 'Chasseresse',
    weaponName: 'Arc',
    text: 'Tire de loin, rapide mais fragile.',
    unlockBoss: null,
  },
  mystic: {
    name: 'Mystique',
    weaponName: 'Bâton des âmes',
    text: 'Orbes lents qui explosent sur une zone.',
    unlockBoss: null,
  },
};
export const CLASS_IDS = Object.keys(CLASSES);

// Classe valide (sinon le Guerrier)
export function classOf(id) {
  return CLASSES[id] ? id : 'warrior';
}

// Réglages de jeu d'une classe : ceux du héros de base, complétés par ceux de la classe
export function classRules(id) {
  const c = SIM.classes[classOf(id)];
  return { ...c, attack: { ...SIM.player.attack, ...c.attack } };
}
