// Code d'export du profil : un texte à copier pour transporter sa progression
// (d'un navigateur à l'autre, du PC au téléphone). Format :
//   BORROG1-<données en base64 "url">-<somme de contrôle>
// La somme de contrôle détecte un code tronqué, abîmé ou modifié à la main :
// un tel code est refusé proprement au lieu d'abîmer la sauvegarde.
// Ce n'est pas une protection contre la triche (le jeu est solo) : juste contre les erreurs.

import { hashString } from '../core/rng.js';
import { sanitizeProfile, PROFILE_VERSION } from './profile.js';
import { ATTR_IDS } from './tree.js';

const PREFIX = 'BORROG1';

export function encodeProfile(profile) {
  const s = profile.stats;
  // Forme compacte pour un code plus court
  const data = JSON.stringify({
    v: PROFILE_VERSION,
    o: profile.shadows,
    a: ATTR_IDS.map((id) => profile.attrs[id]), // niveaux d'attributs, dans l'ordre d'ATTR_IDS
    t: profile.talents,
    c: profile.cls,
    b: profile.builds,
    s: [s.runs, s.victories, s.bestFloor, s.totalShadows],
    k: s.bosses, // boss vaincus (déblocage des classes)
  });
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
    // Version 1 (avant la refonte en attributs) : r = rangs de l'ancien arbre, remboursés
    profile: sanitizeProfile({
      version: raw.v,
      shadows: raw.o,
      ranks: raw.r,
      attrs: Array.isArray(raw.a) ? Object.fromEntries(ATTR_IDS.map((id, i) => [id, raw.a[i]])) : undefined,
      talents: raw.t,
      cls: raw.c,
      builds: raw.b,
      stats: { runs: st[0], victories: st[1], bestFloor: st[2], totalShadows: st[3], bosses: raw.k },
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
