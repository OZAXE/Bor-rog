// Méta-progression façon Cyberpunk 2.0 : ATTRIBUTS + ARBRES DE TALENTS.
//
// - 4 attributs (Arès, Déméter, Hermès, Charon), du niveau 1 au niveau 10, montés
//   avec les Ombres. Chaque niveau gagné donne un petit bonus passif ET un point de talent.
// - Chaque attribut a son arbre : les talents s'ouvrent par paliers selon le niveau
//   de l'attribut (1, 4, 7, 10), en 2 chemins qui mènent à un talent ultime.
// - Il y a bien moins de points (36) qu'il n'en faut pour tout prendre (~70) : on construit un build.
//   Les talents se reprennent gratuitement ; les niveaux d'attributs restent acquis.
// Cet arbre est commun à toutes les classes ; chaque classe aura plus tard le sien en plus.
//
// Ce fichier ne décrit que les règles (noms, prix, valeurs). Les effets sont appliqués
// par la simulation à partir de state.players[i].meta = { attrs: { id: niveau }, talents: { id: rang } }.

export const ATTR_MAX = 10;
// Prix (en Ombres) pour passer du niveau L au niveau L+1 : ATTR_COSTS[L - 1]
export const ATTR_COSTS = [40, 60, 90, 125, 165, 215, 270, 330, 400];
// Niveau d'attribut requis par palier de talents
export const TIER_LEVELS = [1, 4, 7, 10];
// Points de talent par rang selon le palier : les talents du haut de l'arbre coûtent plus
// cher (36 points en tout : un arbre complet et le bas d'un deuxième)
export const TIER_COSTS = [1, 2, 3, 4];

// bonus(n) : bonus passif pour n niveaux gagnés (niveau - 1), affiché au Seuil
export const ATTRS = {
  ares: { name: 'Arès', theme: 'Force', bonus: (n) => `Coups ${n * 2} % plus rapides` },
  demeter: { name: 'Déméter', theme: 'Endurance', bonus: (n) => `+${Math.floor(n / 3)} PV maximum` },
  hermes: { name: 'Hermès', theme: 'Ruse', bonus: (n) => `+${(n * 1.5).toLocaleString('fr-FR')} % de vitesse` },
  charon: { name: 'Charon', theme: 'Fortune', bonus: (n) => `+${n * 2} % d'Ombres gagnées` },
};
export const ATTR_IDS = Object.keys(ATTRS);

// Effet chiffré des niveaux d'attributs (n = niveau - 1)
export const ATTR_EFFECT = {
  ares: 0.02, // cadence des coups, par niveau
  demeter: 1 / 3, // PV maximum par niveau (arrondi vers le bas : +1 tous les 3 niveaux)
  hermes: 0.015, // vitesse de marche, par niveau
  charon: 0.02, // Ombres gagnées, par niveau
};

// Talents. tier : palier (0 à 3) ; lane : chemin (0 = gauche, 1 = droite, 0.5 = ultime au centre)
// ranks : rangs possibles (prix d'un rang : TIER_COSTS du palier) ; per : valeur par rang
// requires : il faut au moins 1 rang dans UN de ces talents (le parent dans l'arbre)
export const TALENTS = {
  // ---------- Arès : force ----------
  swift: { attr: 'ares', tier: 0, lane: 0, name: 'Bras infatigable', per: 0.06, ranks: 3, requires: [],
    text: (v) => `Coups ${pct(v)} plus rapides` },
  reach: { attr: 'ares', tier: 0, lane: 1, name: 'Allonge', per: 0.1, ranks: 2, requires: [],
    text: (v) => `+${pct(v)} de portée des coups et des tirs` },
  // En pourcentage : les dégâts de base valent 1, un "+1" les doublerait d'un coup
  blade: { attr: 'ares', tier: 1, lane: 0, name: 'Lame trempée', per: 0.25, ranks: 2, requires: ['swift'],
    text: (v) => `+${pct(v)} de dégâts` },
  crit: { attr: 'ares', tier: 1, lane: 1, name: 'Coup du destin', per: 0.1, ranks: 2, requires: ['reach'],
    text: (v) => `${pct(v)} de chance d'infliger des dégâts doublés` },
  cleave: { attr: 'ares', tier: 2, lane: 0, name: 'Fendoir', per: 0.25, ranks: 2, requires: ['blade'],
    // Selon la classe : arc de l'épée, explosion de l'orbe, flèches qui traversent
    text: (v) => `Coups et explosions ${pct(v)} plus larges ; flèches : traversent ${Math.round(v / 0.25)} ennemi${v > 0.25 ? 's' : ''}` },
  execute: { attr: 'ares', tier: 2, lane: 1, name: 'Exécution', per: 0.2, ranks: 1, requires: ['crit'],
    text: (v) => `Dégâts doublés sur un ennemi sous ${pct(v)} de ses PV` },
  rage: { attr: 'ares', tier: 3, lane: 0.5, name: "Rage d'Arès", per: 0.2, ranks: 1, requires: ['cleave', 'execute'],
    text: (v) => `Chaque ennemi vaincu : coups ${pct(v)} plus rapides pendant 3 s` },

  // ---------- Déméter : endurance ----------
  vigor: { attr: 'demeter', tier: 0, lane: 0, name: "Sève d'Asphodèle", per: 2, ranks: 2, requires: [],
    text: (v) => `+${v} PV maximum` },
  bark: { attr: 'demeter', tier: 0, lane: 1, name: 'Écorce', per: 0.1, ranks: 2, requires: [],
    text: (v) => `Invulnérable ${sec(v)} de plus après un coup reçu` },
  roots: { attr: 'demeter', tier: 1, lane: 0, name: 'Racines nourricières', per: 1, ranks: 1, requires: ['vigor'],
    text: (v) => `Soigne ${v} PV en arrivant à chaque nouvel étage` },
  elixir: { attr: 'demeter', tier: 1, lane: 1, name: 'Élixir', per: 0.34, ranks: 1, requires: ['bark'],
    text: (v) => `Potions ${pct(v)} plus efficaces` },
  harvest: { attr: 'demeter', tier: 2, lane: 0, name: 'Moisson', per: 2, ranks: 1, requires: ['roots'],
    text: (v) => `Chaque boss vaincu : +${v} PV maximum (et soigne ${v} PV)` },
  surge: { attr: 'demeter', tier: 2, lane: 1, name: 'Sursaut', per: 0.5, ranks: 1, requires: ['elixir'],
    text: (v) => `+${pct(v)} de dégâts quand il te reste moins de 30 % de PV` },
  defiance: { attr: 'demeter', tier: 3, lane: 0.5, name: 'Défi de la Mort', per: 0.2, ranks: 1, requires: ['harvest', 'surge'],
    text: (v) => `Une fois par partie, tu te relèves avec ${pct(v)} de tes PV` },

  // ---------- Hermès : ruse ----------
  fleet: { attr: 'hermes', tier: 0, lane: 0, name: 'Sandales ailées', per: 0.05, ranks: 2, requires: [],
    text: (v) => `+${pct(v)} de vitesse de marche` },
  lightstep: { attr: 'hermes', tier: 0, lane: 1, name: 'Pas léger', per: 0.1, ranks: 2, requires: [],
    text: (v) => `Esquive rechargée ${pct(v)} plus vite` },
  doubleDash: { attr: 'hermes', tier: 1, lane: 0, name: 'Second souffle', per: 1, ranks: 1, requires: ['fleet'],
    text: () => 'Deux esquives enchaînables' },
  momentum: { attr: 'hermes', tier: 1, lane: 1, name: 'Élan', per: 1, ranks: 2, requires: ['lightstep'],
    text: (v) => `Le premier coup après une esquive inflige +${v} dégât${v > 1 ? 's' : ''}` },
  reflect: { attr: 'hermes', tier: 2, lane: 0, name: 'Bouclier du vent', per: 1, ranks: 1, requires: ['doubleDash'],
    text: () => 'Esquiver une flèche ou un crachat le renvoie sur les ennemis' },
  phantom: { attr: 'hermes', tier: 2, lane: 1, name: 'Ombre fugace', per: 0.08, ranks: 2, requires: ['momentum'],
    text: (v) => `Esquive invulnérable ${sec(v)} de plus` },
  bladeDance: { attr: 'hermes', tier: 3, lane: 0.5, name: 'Danse des lames', per: 1, ranks: 1, requires: ['reflect', 'phantom'],
    text: () => "L'esquive frappe les ennemis traversés" },

  // ---------- Charon : fortune ----------
  purse: { attr: 'charon', tier: 0, lane: 0, name: 'Bourse du passeur', per: 15, ranks: 3, requires: [],
    text: (v) => `+${v} oboles au départ` },
  eye: { attr: 'charon', tier: 0, lane: 1, name: 'Œil du passeur', per: 0.3, ranks: 2, requires: [],
    text: (v) => `Coffres et récompenses de salle : +${pct(v)} d'oboles` },
  tithe: { attr: 'charon', tier: 1, lane: 0, name: 'Dîme des ombres', per: 0.1, ranks: 3, requires: ['purse'],
    text: (v) => `+${pct(v)} d'Ombres gagnées` },
  haggle: { attr: 'charon', tier: 1, lane: 1, name: 'Marchandage', per: 0.25, ranks: 2, requires: ['eye'],
    text: (v) => `Soin et relance chez Charon ${pct(v)} moins chers` },
  choice4: { attr: 'charon', tier: 2, lane: 0, name: 'Faveur des dieux', per: 1, ranks: 1, requires: ['tithe'],
    text: () => 'Charon propose 4 bienfaits au lieu de 3' },
  freeReroll: { attr: 'charon', tier: 2, lane: 1, name: 'Ami du passeur', per: 1, ranks: 1, requires: ['haggle'],
    text: () => 'Une relance gratuite des bienfaits à chaque étage' },
  pact: { attr: 'charon', tier: 3, lane: 0.5, name: 'Pacte de Charon', per: 1, ranks: 1, requires: ['choice4', 'freeReroll'],
    text: () => 'Chaque partie commence par le choix d\'un bienfait' },
};

// ---------- Arbres de classe (étape 7c) ----------
// Même principe, mais propres à une classe (`cls`). Leurs paliers s'ouvrent avec la
// progression totale : la somme des niveaux gagnés dans tous les attributs (0 à 36).
export const CLASS_TIER_LEVELS = [0, 9, 18, 27];
const CLASS_TALENTS = {
  // ---------- Guerrier ----------
  parry: { cls: 'warrior', tier: 0, lane: 0, name: 'Parade', per: 0.1, ranks: 2, requires: [],
    text: (v) => `${pct(v)} de chance de parer un coup (aucun dégât)` },
  whirlHaste: { cls: 'warrior', tier: 0, lane: 1, name: 'Élan du cyclone', per: 0.15, ranks: 2, requires: [],
    text: (v) => `Tourbillon rechargé ${pct(v)} plus vite` },
  riposte: { cls: 'warrior', tier: 1, lane: 0, name: 'Riposte', per: 1, ranks: 1, requires: ['parry'],
    text: () => 'Après une parade, le coup suivant inflige des dégâts doublés' },
  whirlSize: { cls: 'warrior', tier: 1, lane: 1, name: 'Grand cyclone', per: 0.2, ranks: 2, requires: ['whirlHaste'],
    text: (v) => `Tourbillon ${pct(v)} plus large` },
  bulwark: { cls: 'warrior', tier: 2, lane: 0, name: 'Rempart', per: 3, ranks: 1, requires: ['riposte'],
    text: (v) => `+${v} PV maximum` },
  tempest: { cls: 'warrior', tier: 2, lane: 1, name: 'Tempête', per: 1, ranks: 1, requires: ['whirlSize'],
    text: () => 'Le Tourbillon frappe une seconde fois juste après' },
  titan: { cls: 'warrior', tier: 3, lane: 0.5, name: 'Colère des Titans', per: 1, ranks: 1, requires: ['bulwark', 'tempest'],
    text: () => 'Chaque ennemi vaincu recharge le Tourbillon de 1 s' },

  // ---------- Chasseresse ----------
  venom: { cls: 'huntress', tier: 0, lane: 0, name: 'Flèches empoisonnées', per: 0.6, ranks: 2, requires: [],
    text: (v) => `Le poison inflige ${num(v)} dégât par seconde pendant 3 s` },
  quiver: { cls: 'huntress', tier: 0, lane: 1, name: 'Carquois léger', per: 0.15, ranks: 2, requires: [],
    text: (v) => `Volée rechargée ${pct(v)} plus vite` },
  linger: { cls: 'huntress', tier: 1, lane: 0, name: 'Venin tenace', per: 2, ranks: 1, requires: ['venom'],
    text: (v) => `Le poison dure ${v} s de plus` },
  barrage: { cls: 'huntress', tier: 1, lane: 1, name: 'Volée nourrie', per: 2, ranks: 2, requires: ['quiver'],
    text: (v) => `+${v} flèches à la Volée` },
  marksman: { cls: 'huntress', tier: 2, lane: 0, name: 'Tir précis', per: 0.4, ranks: 1, requires: ['linger'],
    text: (v) => `+${pct(v)} de dégâts sur une cible à plus de 5 m` },
  echoVolley: { cls: 'huntress', tier: 2, lane: 1, name: 'Seconde salve', per: 1, ranks: 1, requires: ['barrage'],
    text: () => 'La Volée tire une seconde salve juste après' },
  hunt: { cls: 'huntress', tier: 3, lane: 0.5, name: 'Instinct de chasse', per: 0.25, ranks: 1, requires: ['marksman', 'echoVolley'],
    text: (v) => `Chaque ennemi vaincu : +${pct(v)} de vitesse et de cadence pendant 3 s` },

  // ---------- Mystique ----------
  bigOrb: { cls: 'mystic', tier: 0, lane: 0, name: 'Orbe ample', per: 0.15, ranks: 2, requires: [],
    text: (v) => `Explosion des orbes ${pct(v)} plus large` },
  deepFreeze: { cls: 'mystic', tier: 0, lane: 1, name: 'Givre profond', per: 1.5, ranks: 2, requires: [],
    text: (v) => `La Nova ralentit ${sec(v)} de plus` },
  chain: { cls: 'mystic', tier: 1, lane: 0, name: 'Réaction en chaîne', per: 0.35, ranks: 2, requires: ['bigOrb'],
    text: (v) => `${pct(v)} de chance qu'un ennemi tué par une explosion explose à son tour` },
  quickNova: { cls: 'mystic', tier: 1, lane: 1, name: 'Nova vive', per: 0.15, ranks: 2, requires: ['deepFreeze'],
    text: (v) => `Nova rechargée ${pct(v)} plus vite` },
  twinOrbs: { cls: 'mystic', tier: 2, lane: 0, name: 'Orbes jumeaux', per: 0.8, ranks: 1, requires: ['chain'],
    text: (v) => `Lance deux orbes (${pct(v)} des dégâts chacun)` },
  shatter: { cls: 'mystic', tier: 2, lane: 1, name: 'Bris de glace', per: 0.75, ranks: 1, requires: ['quickNova'],
    text: (v) => `+${pct(v)} de dégâts sur les ennemis ralentis` },
  torrent: { cls: 'mystic', tier: 3, lane: 0.5, name: "Torrent d'âmes", per: 1.5, ranks: 1, requires: ['twinOrbs', 'shatter'],
    text: (v) => `Les explosions d'orbe ralentissent ${sec(v)}` },
};
for (const [id, t] of Object.entries(CLASS_TALENTS)) TALENTS[id] = { attr: null, ...t };

export const TALENT_IDS = Object.keys(TALENTS);

function pct(v) {
  return `${Math.round(v * 100)} %`;
}
function num(v) {
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}
function sec(v) {
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} s`;
}

// ---------- Lecture des améliorations d'un joueur (meta = { attrs, talents, cls }) ----------

// Rang d'un talent (0 si absent)
export function rankOf(meta, id) {
  return (meta && meta.talents && meta.talents[id]) || 0;
}

// Valeur totale d'un talent selon son rang (ex. Sève rang 2 -> +4 PV)
export function metaValue(meta, id) {
  return rankOf(meta, id) * TALENTS[id].per;
}

// Niveau d'un attribut (1 par défaut)
export function attrLevel(meta, id) {
  return (meta && meta.attrs && meta.attrs[id]) || 1;
}

// Effet des niveaux gagnés dans un attribut (ex. Arès niveau 6 -> 0,10 de cadence)
export function attrValue(meta, id) {
  return (attrLevel(meta, id) - 1) * ATTR_EFFECT[id];
}

// ---------- Validation (sauvegarde abîmée, code trafiqué, entrée de la simulation) ----------

export function cleanAttrs(raw) {
  const out = {};
  for (const id of ATTR_IDS) {
    const v = raw && raw[id];
    out[id] = Number.isInteger(v) ? Math.min(Math.max(v, 1), ATTR_MAX) : 1;
  }
  return out;
}

// Prix d'un rang de talent, en points
export function talentCost(id) {
  return TIER_COSTS[TALENTS[id].tier];
}

// Points dépensés dans les talents
export function pointsSpent(meta) {
  return TALENT_IDS.reduce((s, k) => s + rankOf(meta, k) * talentCost(k), 0);
}

// Points de talent gagnés : un par niveau d'attribut au-delà du premier
export function talentPoints(attrs) {
  return ATTR_IDS.reduce((sum, id) => sum + (attrs[id] || 1) - 1, 0);
}

// Pourquoi un rang de talent ne peut pas être pris ('' = il peut l'être)
export function talentBlocker(meta, id) {
  const t = TALENTS[id];
  if (!t) return 'inconnu';
  if (rankOf(meta, id) >= t.ranks) return 'maximum';
  if (t.cls) {
    // Talent de classe : seulement pour cette classe, palier selon la progression totale
    if (t.cls !== ((meta && meta.cls) || 'warrior')) return 'classe';
    if (talentPoints(meta.attrs) < CLASS_TIER_LEVELS[t.tier]) return 'palier';
  } else if (attrLevel(meta, t.attr) < TIER_LEVELS[t.tier]) return 'palier';
  if (t.requires.length && !t.requires.some((r) => rankOf(meta, r) > 0)) return 'verrouillé';
  if (pointsSpent(meta) + talentCost(id) > talentPoints(meta.attrs)) return 'pas de point';
  return '';
}

// Nettoie un jeu d'améliorations : attributs bornés, puis talents rejoués un par un
// dans l'ordre des paliers selon les règles. Un talent impossible (palier, parent,
// points insuffisants) est simplement ignoré : le résultat est toujours un build valide.
export function cleanMeta(raw) {
  // cls : classe du héros (les talents de classe n'existent que pour elle)
  const cls = raw && ['warrior', 'huntress', 'mystic'].includes(raw.cls) ? raw.cls : 'warrior';
  const meta = { attrs: cleanAttrs(raw && raw.attrs), talents: {}, cls };
  const want = (raw && raw.talents) || {};
  const order = [...TALENT_IDS].sort((a, b) => TALENTS[a].tier - TALENTS[b].tier);
  for (const id of order) {
    const n = want[id];
    if (!Number.isInteger(n) || n <= 0) continue;
    for (let k = 0; k < n && !talentBlocker(meta, id); k++) meta.talents[id] = rankOf(meta, id) + 1;
  }
  return meta;
}
