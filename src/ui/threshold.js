// Le Seuil : écran entre deux parties. On y dépense ses Ombres dans l'arbre des
// améliorations permanentes, puis on redescend. Interface HTML (pensée pour le
// tactile) ; les règles d'achat sont dans src/meta/profile.js.

import { TREE, NODE_IDS, BRANCHES, rankOf } from '../meta/tree.js';
import { buy, buyBlocker, nextCost, refundAll, spentShadows } from '../meta/profile.js';
import { encodeProfile, decodeProfile } from '../meta/transfer.js';

// profile : profil du joueur (modifié ici par les achats, puis sauvegardé via onChange)
// onChange() : appelé après chaque achat ou remise à zéro
// onDescend(sameSeed) : lance une nouvelle partie (sameSeed = rejouer la même graine)
export function createThreshold({ root, profile, onChange, onDescend }) {
  const el = (sel) => root.querySelector(sel);
  const tree = el('.tree');

  // Une colonne par branche, un bouton par nœud (créés une fois, mis à jour ensuite)
  const buttons = new Map();
  for (const b of BRANCHES) {
    const col = document.createElement('section');
    col.className = `branch branch-${b.id}`;
    col.innerHTML = `<h3>${b.name}<small>${b.theme}</small></h3>`;
    for (const id of NODE_IDS.filter((n) => TREE[n].branch === b.id)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'node';
      btn.addEventListener('click', () => {
        if (buy(profile.current, id)) {
          onChange();
          render();
        }
      });
      col.appendChild(btn);
      buttons.set(id, btn);
    }
    tree.appendChild(col);
  }

  el('.btn-descend').addEventListener('click', () => onDescend(false));
  el('.btn-same-seed').addEventListener('click', () => onDescend(true));
  el('.btn-refund').addEventListener('click', () => {
    const spent = spentShadows(profile.current);
    if (!spent) return;
    if (!window.confirm(`Reprendre les ${spent} Ombres investies ? Toutes les améliorations seront retirées.`)) return;
    refundAll(profile.current);
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
    const describe = (p) => `${p.shadows + spentShadows(p)} Ombres au total, ${p.stats.runs} descentes`;
    if (!window.confirm(`Remplacer ta progression (${describe(cur)}) par celle du code (${describe(next)}) ?`)) return;
    profile.current = next;
    onChange();
    render();
    msg.textContent = 'Progression chargée.';
  });

  function render() {
    const p = profile.current;
    el('.shadows').textContent = `${p.shadows} Ombre${p.shadows > 1 ? 's' : ''}`;
    const s = p.stats;
    el('.stats').textContent =
      `${s.runs} descente${s.runs > 1 ? 's' : ''} · ${s.victories} victoire${s.victories > 1 ? 's' : ''}` +
      ` · meilleur étage : ${s.bestFloor || '-'}`;
    el('.btn-refund').disabled = spentShadows(p) === 0;
    for (const [id, btn] of buttons) {
      const n = TREE[id];
      const r = rankOf(p.ranks, id);
      const max = n.costs.length;
      const blocker = buyBlocker(p, id);
      const cost = nextCost(p, id);
      // Effet affiché : celui du rang suivant, ou du rang atteint si le nœud est complet
      const shown = Math.max(1, Math.min(r + 1, max));
      let foot;
      if (blocker === 'verrouillé') foot = `Requiert ${TREE[n.requires].name}`;
      else if (blocker === 'maximum') foot = 'Complet';
      else foot = `${cost} Ombres`;
      btn.innerHTML =
        `<b>${n.name}</b><span>${n.text(n.per * shown)}</span>` +
        `<i>${'◆'.repeat(r)}${'◇'.repeat(max - r)}</i><small>${foot}</small>`;
      btn.disabled = blocker !== '';
      btn.classList.toggle('locked', blocker === 'verrouillé');
      btn.classList.toggle('owned', r > 0);
      btn.classList.toggle('full', blocker === 'maximum');
    }
  }

  return {
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
  };
}
