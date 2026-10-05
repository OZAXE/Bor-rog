// Bienfaits divins : améliorations choisies (1 parmi 3) à chaque descente d'escalier,
// cumulables pendant toute la partie. Chaque bienfait modifie une caractéristique
// du héros ; playerStats() calcule les valeurs effectives à partir des bienfaits
// possédés (l'état ne stocke que leur nombre, pas les valeurs dérivées).

import { SIM } from './simConfig.js';

export const BOONS = {
  ares: {
    name: "Force d'Arès",
    text: '+1 dégât par coup',
    max: 3,
  },
  demeter: {
    name: 'Vigueur de Déméter',
    text: '+3 PV maximum (et soigne 3 PV)',
    max: 5,
    onTake(p) {
      p.maxHp += 3;
      p.hp = Math.min(p.maxHp, p.hp + 3);
    },
  },
  hermes: {
    name: "Célérité d'Hermès",
    text: '+12 % de vitesse de marche',
    max: 3,
  },
  artemis: {
    name: "Allonge d'Artémis",
    text: '+20 % de portée des coups',
    max: 3,
  },
  zeus: {
    name: 'Fureur de Zeus',
    text: 'Coups 15 % plus rapides',
    max: 3,
  },
  nyx: {
    name: 'Voile de Nyx',
    text: 'Esquive rechargée 25 % plus vite',
    max: 2,
  },
  athena: {
    name: "Égide d'Athéna",
    text: 'Invulnérable 0,5 s de plus après un coup reçu',
    max: 2,
  },
  hades: {
    name: "Tribut d'Hadès",
    text: '+1 PV tous les 4 ennemis vaincus',
    max: 2,
  },
};

export const BOON_IDS = Object.keys(BOONS);

// Caractéristiques effectives du héros, bienfaits compris
export function playerStats(p) {
  const n = (id) => p.boons[id] || 0;
  const base = SIM.player;
  return {
    damage: base.attack.damage + n('ares'),
    speed: base.speed * (1 + 0.12 * n('hermes')),
    attackRange: base.attack.range * (1 + 0.2 * n('artemis')),
    attackCooldown: base.attack.cooldown * 0.85 ** n('zeus'),
    dashCooldown: base.dash.cooldown * 0.75 ** n('nyx'),
    hurtInvuln: base.hurtInvuln + 0.5 * n('athena'),
    // Tribut d'Hadès : 1 PV tous les "killsPerHeal" ennemis (0 = inactif)
    killsPerHeal: n('hades') ? Math.max(2, 5 - n('hades')) : 0,
  };
}

// Bienfaits encore disponibles (pas au maximum)
export function availableBoons(p) {
  return BOON_IDS.filter((id) => (p.boons[id] || 0) < BOONS[id].max);
}

export function takeBoon(p, id) {
  p.boons[id] = (p.boons[id] || 0) + 1;
  if (BOONS[id].onTake) BOONS[id].onTake(p);
}
