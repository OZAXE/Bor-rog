// Courbe de difficulté : comment les ennemis se renforcent en descendant.
//
// Principe : chaque étage multiplie un peu les points de vie et la vitesse,
// ajoute des dégâts par paliers, et RACCOURCIT les préparations d'attaque
// (l'ennemi prévient toujours, mais laisse moins de temps pour réagir).
// Les élites, plus rares au début, sont plus résistants et frappent plus fort.
//
// Les valeurs effectives sont calculées UNE FOIS à la création de l'ennemi et
// rangées dans e.stats : l'IA lit e.stats, jamais directement la config. Ainsi,
// l'état reste autonome (sauvegarde, rejeu) et l'équilibrage tient ici.

import { SIM } from './simConfig.js';

export const DIFFICULTY = {
  hpPerFloor: 0.3, // +30 % de PV par étage
  damageEveryFloors: 4, // +1 dégât tous les 4 étages (tous les 3 créait un "mur" à l'étage 4)
  speedPerFloor: 0.04, // +4 % de vitesse par étage...
  maxSpeedBonus: 0.3, // ... plafonné à +30 %
  windupPerFloor: 0.05, // préparations 5 % plus courtes par étage...
  minWindup: 0.6, // ... mais jamais moins de 60 % de la durée de base
  cooldownPerFloor: 0.06, // archers : tirs 6 % plus fréquents par étage
  minCooldown: 0.55,
  elite: {
    baseChance: 0.03,
    chancePerFloor: 0.035,
    maxChance: 0.3,
    hpFactor: 2.2,
    damageBonus: 1,
    speedFactor: 1.1,
  },
};

// Multiplicateurs pour un étage donné (0 = premier étage)
export function floorScaling(floorIndex) {
  const f = Math.max(0, floorIndex);
  const d = DIFFICULTY;
  return {
    hp: 1 + d.hpPerFloor * f,
    damage: Math.floor(f / d.damageEveryFloors),
    speed: 1 + Math.min(d.maxSpeedBonus, d.speedPerFloor * f),
    windup: Math.max(d.minWindup, 1 - d.windupPerFloor * f),
    cooldown: Math.max(d.minCooldown, 1 - d.cooldownPerFloor * f),
    eliteChance: Math.min(d.elite.maxChance, d.elite.baseChance + d.elite.chancePerFloor * f),
  };
}

// Caractéristiques effectives d'un ennemi.
// players : nombre de joueurs (co-op : plus de PV, cf. SIM.coop)
export function enemyStats(type, floorIndex, elite = false, players = 1) {
  const base = SIM.enemies[type];
  const extra = Math.max(0, players - 1);
  // Un boss a des valeurs fixes (il n'apparaît qu'à son propre étage)
  if (base.boss) {
    const hp = extra ? Math.round(base.hp * (1 + extra * (SIM.bosses[type] ? SIM.coop.bossHp : SIM.coop.enemyHp))) : base.hp;
    return { hp, speed: base.speed, windup: 0, recover: 0 };
  }
  const k = floorScaling(floorIndex);
  const e = DIFFICULTY.elite;
  const hpMul = k.hp * (elite ? e.hpFactor : 1) * (1 + extra * SIM.coop.enemyHp);
  const dmgAdd = k.damage + (elite ? e.damageBonus : 0) + extra * SIM.coop.enemyDamage;
  const spdMul = k.speed * (elite ? e.speedFactor : 1);
  const stats = {
    hp: Math.max(1, Math.round(base.hp * hpMul)),
    speed: base.speed * spdMul,
    windup: base.windup * k.windup,
    recover: base.recover,
  };
  if (base.damage !== undefined) stats.damage = base.damage + dmgAdd;
  if (base.arrowDamage !== undefined) stats.arrowDamage = base.arrowDamage + dmgAdd;
  if (base.cooldown !== undefined) stats.cooldown = base.cooldown * k.cooldown;
  if (base.chargeSpeed !== undefined) stats.chargeSpeed = base.chargeSpeed * spdMul;
  return stats;
}
