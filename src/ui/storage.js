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
