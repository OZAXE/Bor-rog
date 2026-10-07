// Le Seuil : écran entre deux parties, façon arbres de talents de Cyberpunk 2.0.
// On y monte ses attributs avec les Ombres (chaque niveau = 1 point de talent) et
// on dépense ses points dans l'arbre de chaque attribut. Un onglet par attribut,
// un arbre dessiné (nœuds + liens). Les règles sont dans src/meta/ (tree.js, profile.js).

import { ATTRS, ATTR_IDS, ATTR_MAX, TALENTS, TALENT_IDS, TIER_LEVELS, CLASS_TIER_LEVELS, attrLevel, rankOf, talentBlocker, talentCost, talentPoints } from '../meta/tree.js';
import { buyLevel, levelCost, levelBlocker, learn, freePoints, spentPoints, resetTalents, investedShadows, characterLevel } from '../meta/profile.js';
import { encodeProfile, decodeProfile } from '../meta/transfer.js';
import { classUnlocked, selectClass } from '../meta/profile.js';
import { CLASSES, CLASS_IDS } from '../systems/classes.js';

const BOSS_NAMES = { cerberus: 'Cerbère', hydra: "l'Hydre", thanatos: 'Thanatos' };

const SVG = 'http://www.w3.org/2000/svg';

// profile : conteneur { current } du profil (modifié ici, puis sauvegardé via onChange)
// onChange() : appelé après chaque achat ou remise à zéro
// onDescend(sameSeed) : lance une nouvelle partie (sameSeed = rejouer la même graine)
export function createThreshold({ root, profile, onChange, onDescend }) {
  const el = (sel) => root.querySelector(sel);
  const tiersEl = el('.tiers');
  const links = el('.links');
  let current = 'ares'; // onglet affiché

  // ---------- Classes ----------
  const classCards = new Map();
  for (const id of CLASS_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `class-card class-${id}`;
    b.addEventListener('click', () => {
      if (selectClass(profile.current, id)) {
        onChange();
        render();
      }
    });
    el('.classes').appendChild(b);
    classCards.set(id, b);
  }

  // ---------- Onglets ----------
  const tabs = new Map();
  // 4 onglets d'attributs + 1 onglet pour l'arbre de la classe choisie
  for (const id of [...ATTR_IDS, 'class']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tab tab-${id}`;
    b.addEventListener('click', () => {
      current = id;
      render();
    });
    el('.tabs').appendChild(b);
    tabs.set(id, b);
  }

  // ---------- Nœuds de talents (tous créés une fois ; seuls ceux de l'onglet sont affichés) ----------
  const nodes = new Map();
  for (const id of TALENT_IDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'node';
    btn.addEventListener('click', () => {
      if (learn(profile.current, id)) {
        onChange();
        render();
      }
    });
    nodes.set(id, btn);
  }

  el('.btn-level').addEventListener('click', () => {
    if (buyLevel(profile.current, current)) {
      onChange();
      render();
    }
  });

  el('.btn-descend').addEventListener('click', () => onDescend(false));
  el('.btn-same-seed').addEventListener('click', () => onDescend(true));
  el('.btn-refund').addEventListener('click', () => {
    if (!spentPoints(profile.current)) return;
    if (!window.confirm('Reprendre tous tes points de talent ? Tes niveaux d\'attributs restent acquis.')) return;
    resetTalents(profile.current);
    onChange();
    render();
  });

  // ---------- Code d'export / d'import ----------
  const transfer = el('.transfer');
  const area = transfer.querySelector('textarea');
  const msg = transfer.querySelector('.transfer-msg');
  function openTransfer(mode) {
    const exporting = mode === 'export';
    transfer.classList.remove('hidden');
    el('.transfer-title').textContent = exporting
      ? 'Copie ce code et colle-le dans "Importer un code" sur ton autre appareil.'
      : 'Colle ici un code de sauvegarde.';
    area.value = exporting ? encodeProfile(profile.current) : '';
    area.readOnly = exporting;
    msg.textContent = '';
    transfer.querySelector('.btn-copy').hidden = !exporting;
    transfer.querySelector('.btn-load').hidden = exporting;
    area.focus();
    if (exporting) area.select();
    transfer.scrollIntoView({ block: 'nearest' });
  }
  el('.btn-export').addEventListener('click', () => openTransfer('export'));
  el('.btn-import').addEventListener('click', () => openTransfer('import'));
  el('.btn-close-transfer').addEventListener('click', () => transfer.classList.add('hidden'));
  el('.btn-copy').addEventListener('click', async () => {
    area.select();
    try {
      await navigator.clipboard.writeText(area.value);
      msg.textContent = 'Code copié.';
    } catch {
      // Presse-papiers refusé (navigateur ancien, page non sécurisée) : copie à l'ancienne
      msg.textContent = document.execCommand('copy') ? 'Code copié.' : 'Sélectionne le code et copie-le à la main.';
    }
  });
  el('.btn-load').addEventListener('click', () => {
    const result = decodeProfile(area.value);
    if (result.error) {
      msg.textContent = result.error;
      return;
    }
    const next = result.profile;
    const cur = profile.current;
    const describe = (p) => `${p.shadows + investedShadows(p)} Ombres au total, ${p.stats.runs} descentes`;
    if (!window.confirm(`Remplacer ta progression (${describe(cur)}) par celle du code (${describe(next)}) ?`)) return;
    profile.current = next;
    onChange();
    render();
    msg.textContent = 'Progression chargée.';
  });

  function render() {
    const p = profile.current;
    el('.shadows').textContent = `${p.shadows} Ombre${p.shadows > 1 ? 's' : ''}`;
    const st = p.stats;
    el('.stats').textContent =
      `${st.runs} descente${st.runs > 1 ? 's' : ''} · ${st.victories} victoire${st.victories > 1 ? 's' : ''}` +
      ` · meilleur étage : ${st.bestFloor || '-'}`;
    el('.btn-refund').disabled = spentPoints(p) === 0;
    const free = freePoints(p);
    el('.points').textContent = `${free} point${free > 1 ? 's' : ''} de talent à dépenser`;
    el('.points').classList.toggle('some', free > 0);

    for (const [id, b] of classCards) {
      const c = CLASSES[id];
      const open = classUnlocked(p, id);
      // Chaque classe est un personnage : son niveau (niveaux d'attributs gagnés) est affiché
      b.innerHTML = open
        ? `<b>${c.name}</b><span>Niveau ${characterLevel(p, id) + 1} · ${c.weaponName}</span><small>${c.text}</small>`
        : `<b>${c.name}</b><span>Verrouillée</span><small>Bats ${BOSS_NAMES[c.unlockBoss]} pour la débloquer</small>`;
      b.disabled = !open;
      b.classList.toggle('on', id === p.cls);
    }

    const classTab = current === 'class';
    const total = talentPoints(p.attrs); // progression totale : niveaux gagnés dans tous les attributs
    for (const [id, b] of tabs) {
      b.innerHTML =
        id === 'class'
          ? `${CLASSES[p.cls].name}<small>arbre de classe</small>`
          : `${ATTRS[id].name}<small>niveau ${attrLevel(p, id)}</small>`;
      b.classList.toggle('on', id === current);
    }

    // Carte : attribut (niveau, bonus, achat) ou classe (progression totale)
    const a = classTab ? null : ATTRS[current];
    const lvl = classTab ? total : attrLevel(p, current);
    const lb = el('.btn-level');
    if (classTab) {
      el('.attr-name').textContent = `${CLASSES[p.cls].name} · ${CLASSES[p.cls].weaponName}`;
      el('.attr-level').textContent = `Progression totale ${total} / ${ATTR_IDS.length * (ATTR_MAX - 1)}`;
      el('.attr-bonus').textContent = 'Monte tes attributs pour ouvrir les paliers de cet arbre';
      lb.hidden = true;
    } else {
      lb.hidden = false;
      el('.attr-name').textContent = `${a.name} · ${a.theme}`;
      el('.attr-level').textContent = `Niveau ${lvl} / ${ATTR_MAX}`;
      el('.attr-bonus').textContent = lvl > 1 ? a.bonus(lvl - 1) : 'Aucun bonus pour l\'instant';
      const blocker = levelBlocker(p, current);
      lb.disabled = blocker !== '';
      lb.innerHTML =
        blocker === 'maximum'
          ? 'Niveau maximum'
          : `Monter au niveau ${lvl + 1}<small>${levelCost(p, current)} Ombres · +1 point · ${a.bonus(lvl)}</small>`;
    }

    // Arbre : une rangée par palier, deux chemins, l'ultime au centre
    tiersEl.innerHTML = '';
    const levels = classTab ? CLASS_TIER_LEVELS : TIER_LEVELS;
    const inTree = (t) => (classTab ? TALENTS[t].cls === p.cls : TALENTS[t].attr === current);
    levels.forEach((need, tier) => {
      const row = document.createElement('div');
      row.className = `tier${lvl >= need ? '' : ' closed'}`;
      row.innerHTML = `<span class="tier-label">${classTab ? `Total ${need}` : `Niv. ${need}`}</span>`;
      for (const id of TALENT_IDS.filter((t) => inTree(t) && TALENTS[t].tier === tier)) {
        const t = TALENTS[id];
        const btn = nodes.get(id);
        const r = rankOf(p, id);
        const why = talentBlocker(p, id);
        const shown = Math.max(1, Math.min(r + 1, t.ranks)); // effet au rang suivant (ou atteint)
        let foot;
        if (why === 'palier') foot = classTab ? `Progression totale ${need} requise` : `${a.name} niveau ${need} requis`;
        else if (why === 'verrouillé') foot = `Requiert ${t.requires.map((q) => TALENTS[q].name).join(' ou ')}`;
        else if (why === 'maximum') foot = 'Complet';
        else if (why === 'pas de point') foot = `${talentCost(id)} point${talentCost(id) > 1 ? 's' : ''} requis`;
        else foot = `${talentCost(id)} point${talentCost(id) > 1 ? 's' : ''}`;
        btn.innerHTML =
          `<b>${t.name}</b><span>${t.text(t.per * shown)}</span>` +
          `<i>${'◆'.repeat(r)}${'◇'.repeat(t.ranks - r)}</i><small>${foot}</small>`;
        btn.disabled = why !== '';
        btn.dataset.lane = String(t.lane);
        btn.classList.toggle('owned', r > 0);
        btn.classList.toggle('full', why === 'maximum');
        btn.classList.toggle('ultimate', tier === TIER_LEVELS.length - 1);
        btn.classList.toggle('locked', why === 'palier' || why === 'verrouillé');
        row.appendChild(btn);
      }
      tiersEl.appendChild(row);
    });
    // Les liens se tracent une fois les nœuds placés à l'écran
    requestAnimationFrame(drawLinks);
  }

  // Liens parent -> enfant entre les nœuds (dorés quand les deux sont pris)
  function drawLinks() {
    const box = links.getBoundingClientRect();
    if (!box.width) return;
    links.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    links.innerHTML = '';
    const p = profile.current;
    for (const id of TALENT_IDS) {
      const t = TALENTS[id];
      if (current === 'class' ? t.cls !== profile.current.cls : t.attr !== current) continue;
      for (const parent of t.requires) {
        const a = nodes.get(parent).getBoundingClientRect();
        const b = nodes.get(id).getBoundingClientRect();
        const line = document.createElementNS(SVG, 'path');
        const x1 = a.left + a.width / 2 - box.left;
        const y1 = a.bottom - box.top;
        const x2 = b.left + b.width / 2 - box.left;
        const y2 = b.top - box.top;
        const my = (y1 + y2) / 2;
        line.setAttribute('d', `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`);
        line.setAttribute('class', rankOf(p, parent) && rankOf(p, id) ? 'on' : rankOf(p, parent) ? 'open' : '');
        links.appendChild(line);
      }
    }
  }
  window.addEventListener('resize', () => {
    if (!root.classList.contains('hidden')) drawLinks();
  });

  // Duo en ligne entre deux descentes : « Descendre » devient « Prêt » ; la descente
  // part quand les deux joueurs sont prêts (cf. server/rooms.js). duo = null en solo.
  function renderDuo(duo) {
    const info = el('.duo-info');
    const descend = el('.btn-descend');
    info.hidden = !duo;
    el('.btn-same-seed').hidden = !!duo;
    el('.btn-online').textContent = duo ? 'Quitter le duo' : 'Jouer à deux';
    if (!duo) {
      descend.textContent = 'Descendre';
      descend.disabled = false;
      return;
    }
    info.textContent = `En duo avec ${duo.ally} · ${duo.allyReady ? 'prêt à descendre' : 'au Seuil'}`;
    descend.textContent = duo.meReady ? 'En attente de ton allié…' : 'Prêt';
    descend.disabled = duo.meReady;
  }

  return {
    setDuo: renderDuo,
    // gained : Ombres de la partie qui vient de finir (0 = pas de message)
    open(gained = 0) {
      el('.gained').textContent = gained ? `+${gained} Ombres rapportées de ta descente` : '';
      render();
      root.classList.remove('hidden');
      root.scrollTop = 0; // toujours ouvert en haut (Ombres et titre visibles)
      transfer.classList.add('hidden');
    },
    close() {
      root.classList.add('hidden');
    },
    isOpen: () => !root.classList.contains('hidden'),
    // Le profil a été remplacé (compte en ligne) : redessiner si le Seuil est affiché
    refresh() {
      if (!root.classList.contains('hidden')) render();
    },
  };
}
