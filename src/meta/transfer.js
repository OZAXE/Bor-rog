// Code d'export du profil : un texte à copier pour transporter sa progression
// (d'un navigateur à l'autre, du PC au téléphone). Format :
//   BORROG1-<données en base64 "url">-<somme de contrôle>
// La somme de contrôle détecte un code tronqué, abîmé ou modifié à la main :
// un tel code est refusé proprement au lieu d'abîmer la sauvegarde.
// Ce n'est pas une protection contre la triche (le jeu est solo) : juste contre les erreurs.

import { hashString } from '../core/rng.js';
import { sanitizeProfile, PROFILE_VERSION } from './profile.js';

const PREFIX = 'BORROG1';

export function encodeProfile(profile) {
  const s = profile.stats;
  // Forme compacte pour un code plus court
  const data = JSON.stringify({ v: PROFILE_VERSION, o: profile.shadows, r: profile.ranks, s: [s.runs, s.victories, s.bestFloor, s.totalShadows] });
  const body = toBase64Url(data);
  return `${PREFIX}-${body}-${checksum(body)}`;
}

// Renvoie { profile } si le code est valide, sinon { error: 'explication' }
export function decodeProfile(code) {
  const text = String(code ?? '').replace(/\s+/g, ''); // tolère espaces et retours à la ligne collés
  const parts = text.split('-');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { error: "Ce n'est pas un code de sauvegarde Bor-rog." };
  const [, body, sum] = parts;
  if (checksum(body) !== sum) return { error: 'Code incomplet ou modifié : vérifie que tu as tout copié.' };
  let raw;
  try {
    raw = JSON.parse(fromBase64Url(body));
  } catch {
    return { error: 'Code illisible.' };
  }
  if (!raw || typeof raw !== 'object') return { error: 'Code illisible.' };
  const st = Array.isArray(raw.s) ? raw.s : [];
  return {
    profile: sanitizeProfile({
      shadows: raw.o,
      ranks: raw.r,
      stats: { runs: st[0], victories: st[1], bestFloor: st[2], totalShadows: st[3] },
    }),
  };
}

function checksum(body) {
  return hashString(`${PREFIX}:${body}`).toString(36);
}

// base64 "url" : sans +, / ni = (le code reste d'un seul tenant quand on le copie)
function toBase64Url(text) {
  return btoa(text).replace(/\+/g, '.').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(body) {
  const b64 = body.replace(/\./g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}
