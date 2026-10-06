// Comptes : règles des pseudos et mots de passe, empreintes et jetons de session.
// Uniquement node:crypto (aucune dépendance).
//
// - Le mot de passe n'est JAMAIS stocké : seulement son empreinte « scrypt », un calcul
//   volontairement lent et salé (un sel aléatoire par compte). Même avec une copie de la
//   base, retrouver un mot de passe demanderait de refaire ce calcul pour chaque essai.
// - Le jeton de session est une clé aléatoire remise au navigateur ; la base n'en garde
//   que l'empreinte SHA-256 (une fuite de la base ne permet pas de se faire passer pour
//   un joueur).

import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }; // ~16 Mo et quelques dizaines de ms par calcul

export const NAME_RULE = 'Pseudo : 3 à 20 lettres, chiffres, - ou _.';
export const PASSWORD_RULE = 'Mot de passe : au moins 8 caractères.';

// Renvoie le pseudo nettoyé, ou null s'il ne respecte pas les règles
export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.normalize('NFC').trim();
  return /^[\p{L}\p{N}_-]{3,20}$/u.test(n) ? n : null;
}

// Clé d'unicité : « Enzo » et « enzo » sont le même compte
export function nameKey(name) {
  return name.normalize('NFC').toLowerCase();
}

export function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 128;
}

function derive(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

// Empreinte stockée : scrypt$N$r$p$sel$empreinte (les réglages voyagent avec, pour pouvoir les durcir plus tard)
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), { N: +N, r: +r, p: +p, keylen: expected.length });
  // Comparaison à temps constant : la durée ne trahit pas combien de caractères sont justes
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Empreinte factice : vérifiée quand le pseudo n'existe pas, pour que la réponse prenne
// le même temps (on ne peut pas deviner quels pseudos existent en chronométrant)
let dummy = null;
export async function dummyVerify(password) {
  dummy ??= await hashPassword('mot de passe factice');
  await verifyPassword(password, dummy);
  return false;
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}
