// Arbre des améliorations permanentes (méta-progression du roguelite).
// Entre deux parties, le joueur dépense ses Ombres pour acheter des rangs.
// Un nœud ne s'achète que si le nœud dont il dépend ("requires") a au moins 1 rang.
// Cet arbre est commun à toutes les classes ; chaque classe aura plus tard le sien en plus.
//
// Ce fichier ne décrit que l'arbre (noms, prix, valeurs). Les effets sont appliqués
// par la simulation (src/systems/boons.js, player.js, descent.js) à partir des rangs
// que le joueur apporte en début de partie : state.player.meta = { id: rang }.

export const BRANCHES = [
  { id: 'ares', name: 'Arès', theme: 'Force' },
  { id: 'demeter', name: 'Déméter', theme: 'Endurance' },
  { id: 'hermes', name: 'Hermès', theme: 'Ruse' },
  { id: 'charon', name: 'Charon', theme: 'Fortune' },
];

// costs[k] = prix du rang k+1 ; per = valeur ajoutée par rang
export const TREE = {
  // ---------- Arès : force ----------
  blade: {
    branch: 'ares',
    name: 'Lame trempée',
    text: (per) => `+${per} dégât${per > 1 ? 's' : ''} par coup`,
    per: 1,
    costs: [60], // un seul rang : les dégâts de base valent 1, +1 les double déjà
    requires: null,
  },
  swift: {
    branch: 'ares',
    name: 'Bras infatigable',
    text: (per) => `Coups ${Math.round(per * 100)} % plus rapides`,
    per: 0.08,
    costs: [40, 100],
    requires: 'blade',
  },
  crit: {
    branch: 'ares',
    name: 'Coup du destin',
    text: (per) => `${Math.round(per * 100)} % de chance d'infliger des dégâts doublés`,
    per: 0.1,
    costs: [80, 180],
    requires: 'swift',
  },

  // ---------- Déméter : endurance ----------
  vigor: {
    branch: 'demeter',
    name: 'Sève d\'Asphodèle',
    text: (per) => `+${per} PV maximum`,
    per: 2,
    costs: [20, 45, 80],
    requires: null,
  },
  roots: {
    branch: 'demeter',
    name: 'Racines nourricières',
    text: (per) => `Soigne ${per} PV en arrivant à chaque nouvel étage`,
    per: 2,
    costs: [40, 90],
    requires: 'vigor',
  },
  defiance: {
    branch: 'demeter',
    name: 'Défi de la Mort',
    text: (per) => `Une fois par partie, tu te relèves avec ${Math.round(per * 100)} % de tes PV`,
    per: 0.25, // 25 % au rang 1, 50 % au rang 2
    costs: [150, 300],
    requires: 'roots',
  },

  // ---------- Hermès : ruse ----------
  fleet: {
    branch: 'hermes',
    name: 'Sandales ailées',
    text: (per) => `+${Math.round(per * 100)} % de vitesse de marche`,
    per: 0.05,
    costs: [20, 50],
    requires: null,
  },
  doubleDash: {
    branch: 'hermes',
    name: 'Second souffle',
    text: () => 'Deux esquives enchaînables',
    per: 1,
    costs: [100],
    requires: 'fleet',
  },
  reflect: {
    branch: 'hermes',
    name: 'Bouclier du vent',
    text: () => 'Esquiver une flèche ou un crachat le renvoie sur les ennemis',
    per: 1,
    costs: [150],
    requires: 'doubleDash',
  },

  // ---------- Charon : fortune ----------
  purse: {
    branch: 'charon',
    name: 'Bourse du passeur',
    text: (per) => `+${per} oboles au départ`,
    per: 15,
    costs: [15, 30, 50],
    requires: null,
  },
  tithe: {
    branch: 'charon',
    name: 'Dîme des ombres',
    text: (per) => `+${Math.round(per * 100)} % d'Ombres gagnées`,
    per: 0.1,
    costs: [40, 80, 140],
    requires: 'purse',
  },
  choice4: {
    branch: 'charon',
    name: 'Faveur des dieux',
    text: () => 'Charon propose 4 bienfaits au lieu de 3',
    per: 1,
    costs: [120],
    requires: 'purse',
  },
  freeReroll: {
    branch: 'charon',
    name: 'Ami du passeur',
    text: () => 'Une relance gratuite des bienfaits à chaque étage',
    per: 1,
    costs: [100],
    requires: 'choice4',
  },
};

export const NODE_IDS = Object.keys(TREE);

// Rang possédé (0 si absent)
export function rankOf(ranks, id) {
  return (ranks && ranks[id]) || 0;
}

// Valeur totale d'un nœud selon son rang (ex. Lame trempée rang 2 -> +2 dégâts)
export function metaValue(ranks, id) {
  return rankOf(ranks, id) * TREE[id].per;
}

// Ne garde que des rangs valides (nœuds connus, entiers, plafonnés).
// Sert à la fois pour une sauvegarde abîmée et pour l'entrée de la simulation.
export function cleanRanks(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of NODE_IDS) {
    const r = raw[id];
    if (Number.isInteger(r) && r > 0) out[id] = Math.min(r, TREE[id].costs.length);
  }
  return out;
}
