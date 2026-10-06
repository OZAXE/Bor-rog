// Compte en ligne (étape 8b) : connexion, création de compte, envoi du profil au serveur.
// Le jeu ne dépend jamais du serveur : la progression est toujours enregistrée dans le
// navigateur d'abord ; l'envoi en ligne suit quand il peut (le serveur gratuit s'endort
// et met jusqu'à une minute à se réveiller ; le réseau peut manquer).
// Les décisions (envoyer, adopter, demander au joueur) sont des règles pures : src/meta/sync.js.

import { sanitizeProfile } from '../meta/profile.js';
import { ATTRS, ATTR_IDS } from '../meta/tree.js';
import { loginAction, refreshAction, sameProfile, profileSummary } from '../meta/sync.js';
import { loadAccount, saveAccount } from './storage.js';

const TIMEOUT = 90_000; // le réveil du serveur peut prendre une minute
const RETRY = 60_000; // nouvel essai d'envoi si le serveur était injoignable

// profile : { current } partagé avec le jeu ; save() l'enregistre dans le navigateur ;
// onReplaced() : le profil vient d'être remplacé par celui du compte (rafraîchir l'affichage) ;
// canPrompt() : peut-on afficher la question en cas de conflit (pas en pleine partie)
export function createAccount({ root, conflictRoot, serverUrl, profile, save, onReplaced, canPrompt }) {
  const el = (sel) => root.querySelector(sel);
  const form = el('.account-form');
  let account = loadAccount();
  let status = account?.token ? 'pending' : 'local';
  let busy = false;
  let pushTimer = 0;
  let conflict = null; // { rev, profile } du serveur, en attente du choix du joueur

  // ---------- Réseau ----------
  async function call(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (account?.token) headers.authorization = `Bearer ${account.token}`;
    try {
      const r = await fetch(serverUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    } catch {
      return { status: 0, body: {} }; // serveur endormi trop longtemps, pas de réseau…
    }
  }

  function persist() {
    saveAccount(account);
  }

  function setStatus(s) {
    status = s;
    render();
  }

  // Session refusée par le serveur (expirée, ou déconnectée ailleurs) : on garde le pseudo
  function lostSession() {
    account.token = null;
    persist();
    setStatus('expired');
  }

  // ---------- Synchronisation ----------
  function adopt(remoteRev, remote) {
    profile.current = sanitizeProfile(remote);
    save();
    account.rev = remoteRev;
    account.dirty = false;
    persist();
    onReplaced();
    setStatus('synced');
  }

  async function push() {
    clearTimeout(pushTimer);
    if (!account?.token || busy || conflict) return;
    busy = true;
    setStatus('sending');
    const sent = JSON.parse(JSON.stringify(profile.current));
    const r = await call('PUT', '/api/profile', { profile: sent, baseRev: account.rev });
    busy = false;
    if (r.status === 200) {
      account.rev = r.body.rev;
      // Un changement arrivé pendant l'envoi repartira au prochain tour
      account.dirty = !sameProfile(sent, profile.current);
      persist();
      setStatus('synced');
      if (account.dirty) schedulePush();
    } else if (r.status === 409) {
      if (!r.body.profile) {
        // Rien en ligne (compte vidé) : on repart de zéro
        account.rev = 0;
        schedulePush();
      } else openConflict(r.body.rev, r.body.profile);
    } else if (r.status === 401) lostSession();
    else {
      setStatus('offline');
      pushTimer = setTimeout(push, RETRY);
    }
  }

  function schedulePush(delay = 1500) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, delay);
  }

  // Ouverture du jeu : relire le compte (un autre appareil a peut-être joué)
  async function refresh() {
    if (!account?.token || busy) return;
    busy = true;
    setStatus('waking');
    const r = await call('GET', '/api/profile');
    busy = false;
    if (r.status === 401) return lostSession();
    if (r.status !== 200) {
      setStatus('offline');
      pushTimer = setTimeout(account.dirty ? push : refresh, RETRY);
      return;
    }
    apply(refreshAction(account, r.body.rev, r.body.profile), r.body.rev, r.body.profile);
  }

  function apply(action, remoteRev, remote) {
    if (action === 'adopt') adopt(remoteRev, remote);
    else if (action === 'conflict') openConflict(remoteRev, remote);
    else if (action === 'push') {
      account.rev = remoteRev;
      account.dirty = true;
      persist();
      push();
    } else setStatus('synced');
  }

  // ---------- Connexion / création ----------
  async function enter(path) {
    if (busy) return;
    const name = form.elements.name.value.trim();
    const password = form.elements.password.value;
    busy = true;
    el('.account-msg').textContent = '';
    setStatus('waking');
    const prev = account;
    account = { name, token: null, rev: 0, dirty: false };
    const r = await call('POST', path, { name, password });
    busy = false;
    if (r.status !== 200 && r.status !== 201) {
      account = prev?.token ? prev : prev ? { ...prev, token: null } : null;
      el('.account-msg').textContent =
        r.status === 0 ? 'Serveur injoignable. Réessaie dans un instant.' : r.body.error || 'Échec, réessaie.';
      setStatus(account?.token ? 'synced' : 'local');
      return;
    }
    form.elements.password.value = '';
    account = { name: r.body.name, token: r.body.token, rev: 0, dirty: false };
    // Même compte qu'avant sur cet appareil (session expirée) : on sait ce qui a changé ici
    const same = prev && prev.name.toLowerCase() === r.body.name.toLowerCase();
    const action = same
      ? refreshAction({ rev: prev.rev, dirty: prev.dirty }, r.body.rev, r.body.profile)
      : loginAction(profile.current, r.body.profile);
    persist();
    apply(action, r.body.rev, r.body.profile);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    enter('/api/login');
  });
  el('.btn-register').addEventListener('click', () => enter('/api/register'));
  el('.btn-logout').addEventListener('click', async () => {
    if (!account) return;
    if (account.token && account.dirty && !window.confirm('Des changements ne sont pas encore en ligne. Te déconnecter quand même ? Ils restent sur cet appareil.')) return;
    const token = account.token;
    clearTimeout(pushTimer);
    account = null;
    persist();
    conflict = null;
    setStatus('local');
    if (token) {
      // Prévenir le serveur (sans attendre : la déconnexion locale suffit)
      fetch(`${serverUrl}/api/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
    }
  });
  el('.btn-account').addEventListener('click', () => {
    root.querySelector('.account').classList.toggle('hidden');
    render();
  });
  el('.btn-close-account').addEventListener('click', () => root.querySelector('.account').classList.add('hidden'));

  // ---------- Conflit : deux progressions différentes ----------
  function openConflict(remoteRev, remote) {
    conflict = { rev: remoteRev, profile: remote };
    setStatus('conflict');
    showConflict();
  }

  function describe(p) {
    const s = profileSummary(p);
    return (
      `${s.shadows} Ombres au total · ${s.levels} niveau${s.levels > 1 ? 'x' : ''} d’attributs<br>` +
      `${s.runs} descente${s.runs > 1 ? 's' : ''} · ${s.victories} victoire${s.victories > 1 ? 's' : ''} · meilleur étage ${s.bestFloor}<br>` +
      // Détail des attributs : deux progressions de même total restent distinguables
      ATTR_IDS.map((id) => `${ATTRS[id].name} ${p.attrs[id]}`).join(' · ')
    );
  }

  function showConflict() {
    if (!conflict || !canPrompt() || !conflictRoot.classList.contains('hidden')) return;
    conflictRoot.querySelector('.summary-local').innerHTML = describe(profile.current);
    conflictRoot.querySelector('.summary-remote').innerHTML = describe(sanitizeProfile(conflict.profile));
    conflictRoot.querySelector('.remote-title').textContent = `Ton compte (${account.name})`;
    conflictRoot.classList.remove('hidden');
  }

  conflictRoot.querySelector('#btn-keep-local').addEventListener('click', () => {
    // On écrit par-dessus la version du serveur que le joueur vient de voir
    account.rev = conflict.rev;
    account.dirty = true;
    conflict = null;
    persist();
    conflictRoot.classList.add('hidden');
    push();
  });
  conflictRoot.querySelector('#btn-keep-remote').addEventListener('click', () => {
    const c = conflict;
    conflict = null;
    conflictRoot.classList.add('hidden');
    adopt(c.rev, c.profile);
  });

  // ---------- Affichage ----------
  const TEXTS = {
    local: 'Progression enregistrée sur cet appareil seulement. Connecte-toi pour la sauvegarder en ligne et la retrouver partout.',
    pending: 'Connexion au compte…',
    waking: 'Connexion au serveur… (jusqu’à une minute s’il dormait)',
    sending: 'Envoi de ta progression…',
    synced: '✓ Progression sauvegardée en ligne.',
    offline: 'Serveur injoignable : ta progression reste sur cet appareil, nouvel essai dans une minute.',
    expired: 'Session expirée : reconnecte-toi (ta progression est restée sur cet appareil).',
    conflict: 'Deux progressions différentes : choisis laquelle garder.',
  };
  const SHORT = {
    local: 'Compte : non connecté',
    pending: '… Compte',
    waking: '… Connexion',
    sending: '… Envoi',
    synced: '✓ Sauvegardé en ligne',
    offline: '⚠ Hors ligne',
    expired: '⚠ Reconnecte-toi',
    conflict: '⚠ À choisir',
  };
  function render() {
    const logged = !!account?.token;
    const who = account ? ` · ${account.name}` : '';
    el('.btn-account').textContent = status === 'local' ? SHORT.local : `${SHORT[status]}${who}`;
    el('.btn-account').dataset.status = status;
    el('.account-status').textContent = logged || status === 'expired' ? `${account.name} : ${TEXTS[status]}` : TEXTS[status];
    form.hidden = logged;
    if (!logged && account?.name && !form.elements.name.value) form.elements.name.value = account.name;
    el('.btn-logout').hidden = !account;
  }

  // Retour du réseau : on retente tout de suite
  window.addEventListener('online', () => (account?.dirty ? push() : refresh()));

  render();
  return {
    start: refresh,
    // Pseudo du compte (vide sans compte) : affiché dans les salons en ligne
    name: () => account?.name || '',
    // Le profil vient d'être enregistré dans le navigateur : à envoyer en ligne
    changed() {
      if (!account) return;
      // Retenu même déconnecté : à la reconnexion, on saura que cet appareil a avancé
      account.dirty = true;
      persist();
      if (account.token) schedulePush();
    },
    // Moment calme (Seuil, pause, écran de fin) : afficher le choix en attente
    showPending: showConflict,
    render,
    status: () => status,
  };
}
