// Le Seuil : écran entre deux parties. On y dépense ses Ombres dans l'arbre des
// améliorations permanentes, puis on redescend. Interface HTML (pensée pour le
// tactile) ; les règles d'achat sont dans src/meta/profile.js.

import { TREE, NODE_IDS, BRANCHES, rankOf } from '../meta/tree.js';
import { buy, buyBlocker, nextCost, refundAll, spentShadows } from '../meta/profile.js';

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
    },
    close() {
      root.classList.add('hidden');
    },
    isOpen: () => !root.classList.contains('hidden'),
  };
}
