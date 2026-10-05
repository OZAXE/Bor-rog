// Bienfaits divins : améliorations choisies (1 parmi 3) à chaque descente d'escalier,
// cumulables pendant toute la partie. Chaque bienfait modifie une caractéristique
// du héros ; playerStats() calcule les valeurs effectives à partir des bienfaits
// possédés (l'état ne stocke que leur nombre, pas les valeurs dérivées).

import { SIM } from './simConfig.js';
import { metaValue, rankOf, attrValue } from '../meta/tree.js';
import { classRules } from './classes.js';

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
  const cls = classRules(p.cls);
  const atk = cls.attack; // réglages du coup de la classe
  const range = 1 + 0.2 * n('artemis') + m('reach'); // Allonge d'Artémis, Allonge
  const shot = cls.shot || null;
  // Sursaut : dégâts accrus quand la vie est basse
  const low = p.hp <= p.maxHp * 0.3 ? m('surge') : 0;
  // Rage d'Arès : cadence accrue juste après avoir vaincu un ennemi
  const rage = p.rage > 0 ? m('rage') : 0;
  // Instinct de chasse (Chasseresse) : vitesse et cadence après avoir vaincu un ennemi
  const hunt = p.hunt > 0 ? m('hunt') : 0;
  const sp = cls.special;
  return {
    weapon: cls.weapon, // 'sword', 'bow' ou 'orb'
    damage: (atk.damage + n('ares')) * (1 + m('blade') + low),
    speed: base.speed * cls.speed * (1 + 0.12 * n('hermes') + m('fleet') + a('hermes') + hunt),
    attackRange: atk.range * range,
    attackArc: atk.arc * (1 + m('cleave')),
    attackCooldown: atk.cooldown * 0.85 ** n('zeus') * (1 - m('swift')) * (1 - a('ares')) * (1 - rage) * (1 - hunt),
    knockback: atk.knockback,
    attackDuration: atk.duration,
    moveFactor: atk.moveFactor,
    autoAimRange: atk.autoAimRange * range,
    // Tirs (Chasseresse, Mystique) : portée, ennemis traversés, rayon d'explosion.
    // Fendoir élargit l'arc du Guerrier, rend les flèches perforantes, agrandit l'explosion.
    shotSpeed: shot ? shot.speed : 0,
    shotRange: shot ? shot.range * range : 0,
    shotRadius: shot ? shot.radius : 0,
    pierce: cls.weapon === 'bow' ? (shot.pierce || 0) + rankOf(p.meta, 'cleave') : 0,
    blast: shot && shot.blast ? shot.blast * (1 + m('cleave') + m('bigOrb')) : 0,
    // ---------- Talents de classe (étape 7c) ----------
    special: {
      ...sp,
      cooldown: sp.cooldown * (1 - m('whirlHaste') - m('quiver') - m('quickNova')),
      radius: sp.radius ? sp.radius * (1 + m('whirlSize')) : 0,
      count: sp.count ? sp.count + m('barrage') : 0,
      slow: sp.slow ? sp.slow + m('deepFreeze') : 0,
      echo: rankOf(p.meta, 'tempest') > 0 || rankOf(p.meta, 'echoVolley') > 0, // seconde frappe ou salve
    },
    parry: m('parry'), // chance de parer un coup
    poisonDps: m('venom'), // dégâts par seconde du poison (0 = pas de poison)
    poisonTime: 3 + m('linger'),
    marksman: m('marksman'), // bonus de dégâts au-delà de 5 m
    twinOrbs: m('twinOrbs'), // part des dégâts de chacun des deux orbes (0 = un seul orbe)
    shatter: m('shatter'), // bonus de dégâts sur les ennemis ralentis
    blastSlow: m('torrent'), // ralentissement infligé par les explosions d'orbe (s)
    chain: m('chain'), // chance qu'un ennemi tué par une explosion explose à son tour
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
