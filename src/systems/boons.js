// Bienfaits divins : améliorations choisies (1 parmi 3) à chaque descente d'escalier,
// cumulables pendant toute la partie. Chaque bienfait modifie une caractéristique
// du héros ; playerStats() calcule les valeurs effectives à partir des bienfaits
// possédés (l'état ne stocke que leur nombre, pas les valeurs dérivées).

import { SIM } from './simConfig.js';
import { metaValue, rankOf, attrValue } from '../meta/tree.js';

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

// Caractéristiques effectives du héros : bienfaits de la partie + attributs et talents
// permanents (p.meta, cf. src/meta/tree.js)
export function playerStats(p) {
  const n = (id) => p.boons[id] || 0;
  const m = (id) => metaValue(p.meta, id);
  const a = (id) => attrValue(p.meta, id);
  const base = SIM.player;
  // Sursaut : +1 dégât quand la vie est basse
  const low = p.hp <= p.maxHp * 0.3 ? m('surge') : 0;
  // Rage d'Arès : cadence accrue juste après avoir vaincu un ennemi
  const rage = p.rage > 0 ? m('rage') : 0;
  return {
    damage: base.attack.damage + n('ares') + m('blade') + low,
    speed: base.speed * (1 + 0.12 * n('hermes') + m('fleet') + a('hermes')),
    attackRange: base.attack.range * (1 + 0.2 * n('artemis') + m('reach')),
    attackArc: base.attack.arc * (1 + m('cleave')),
    attackCooldown: base.attack.cooldown * 0.85 ** n('zeus') * (1 - m('swift')) * (1 - a('ares')) * (1 - rage),
    critChance: m('crit'), // chance de dégâts doublés
    executeBelow: m('execute'), // dégâts doublés sous cette part de PV (0 = inactif)
    momentum: m('momentum'), // dégâts en plus sur le premier coup après une esquive
    dashCharges: 1 + rankOf(p.meta, 'doubleDash'),
    reflect: rankOf(p.meta, 'reflect') > 0, // l'esquive renvoie les projectiles
    bladeDance: rankOf(p.meta, 'bladeDance') > 0, // l'esquive frappe les ennemis traversés
    dashCooldown: base.dash.cooldown * 0.75 ** n('nyx') * (1 - m('lightstep')),
    dashInvuln: base.dash.invuln + m('phantom'),
    hurtInvuln: base.hurtInvuln + 0.5 * n('athena') + m('bark'),
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
