// Sauvegarde du profil dans le navigateur (localStorage). Toute erreur (navigation
// privée, stockage plein ou bloqué, donnée abîmée) est absorbée : le jeu reste jouable,
// au pire sans mémoire d'une visite à l'autre.

import { newProfile, sanitizeProfile } from '../meta/profile.js';

const KEY = 'bor-rog.profil';

export function loadProfile() {
  try {
    const text = window.localStorage.getItem(KEY);
    return text ? sanitizeProfile(JSON.parse(text)) : newProfile();
  } catch {
    return newProfile();
  }
}

export function saveProfile(profile) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

// ---------- Descente en cours (reprise après fermeture de la page) ----------

const RUN_KEY = 'bor-rog.partie';

export function saveRun(text) {
  try {
    window.localStorage.setItem(RUN_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function loadRunText() {
  try {
    return window.localStorage.getItem(RUN_KEY);
  } catch {
    return null;
  }
}

export function clearRun() {
  try {
    window.localStorage.removeItem(RUN_KEY);
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}

// ---------- Compte en ligne (étape 8b) ----------
// { name, token, rev, dirty } : pseudo, jeton de session (null = déconnecté), dernière
// version en ligne connue, et changements pas encore envoyés. Jamais le mot de passe.

const ACCOUNT_KEY = 'bor-rog.compte';

export function loadAccount() {
  try {
    const a = JSON.parse(window.localStorage.getItem(ACCOUNT_KEY));
    if (!a || typeof a.name !== 'string') return null;
    return {
      name: a.name,
      token: typeof a.token === 'string' ? a.token : null,
      rev: Number.isInteger(a.rev) ? a.rev : 0,
      dirty: a.dirty === true,
    };
  } catch {
    return null;
  }
}

export function saveAccount(account) {
  try {
    if (account) window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    else window.localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* stockage indisponible : le compte sera redemandé à la prochaine visite */
  }
}
