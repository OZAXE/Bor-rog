// Routes HTTP du serveur (sans dépendance à Postgres : le stockage est fourni de
// l'extérieur, ce qui permet de tester toutes les règles en mémoire).
//
//   GET  /health        état du service et de la base
//   POST /api/register  { name, password }          -> { name, token, rev, profile }
//   POST /api/login     { name, password }          -> { name, token, rev, profile }
//   POST /api/logout    (jeton)                     -> { ok }
//   GET  /api/profile   (jeton)                     -> { name, rev, profile }
//   PUT  /api/profile   (jeton) { profile, baseRev } -> { rev }  ou 409 { rev, profile }
//
// Le jeton se passe dans l'en-tête « Authorization: Bearer <jeton> ».
// Le profil reçu est relu par les règles du jeu (sanitizeProfile) : une donnée
// abîmée ou trafiquée est remise d'aplomb, comme pour un code d'export.

import { sanitizeProfile } from '../src/meta/profile.js';
import {
  cleanName,
  nameKey,
  validPassword,
  hashPassword,
  verifyPassword,
  dummyVerify,
  newToken,
  tokenHash,
  NAME_RULE,
  PASSWORD_RULE,
} from './auth.js';

// Version des routes : /health l'affiche (on voit ainsi quel code tourne sur Render)
export const API_VERSION = 1;
const SESSION_DAYS = 90;
const MAX_BODY = 32 * 1024; // un profil fait quelques Ko
const LOGIN_FAILS = 5; // essais ratés par minute et par adresse
const REGISTERS = 5; // créations de compte par heure et par adresse

export function createApp({ store, origins = [], now = () => Date.now(), dbStatus = async () => 'ok' }) {
  // Limiteur d'essais : adresse -> { n, reset }
  const limits = { login: new Map(), register: new Map() };
  function limited(kind, ip, max) {
    const m = limits[kind];
    const e = m.get(ip);
    if (!e || e.reset <= now()) return false;
    return e.n >= max;
  }
  function count(kind, ip, windowMs) {
    const m = limits[kind];
    let e = m.get(ip);
    if (!e || e.reset <= now()) {
      e = { n: 0, reset: now() + windowMs };
      m.set(ip, e);
    }
    e.n++;
    // Ménage : la table ne grossit pas indéfiniment
    if (m.size > 5000) for (const [k, v] of m) if (v.reset <= now()) m.delete(k);
  }

  function headers(origin) {
    const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (origin && origins.includes(origin)) {
      h['access-control-allow-origin'] = origin;
      h.vary = 'Origin';
    }
    return h;
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          // On cesse de lire ; la connexion sera fermée après la réponse 413
          req.pause();
          resolve({ tooLarge: true });
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve({ json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
        } catch {
          resolve({ json: null });
        }
      });
      req.on('error', () => resolve({ json: null }));
    });
  }

  async function auth(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    return m ? store.sessionAccount(tokenHash(m[1]), now()) : null;
  }

  async function openSession(account) {
    const token = newToken();
    await store.createSession(tokenHash(token), account.id, now() + SESSION_DAYS * 86400e3, now());
    const p = await store.getProfile(account.id);
    return { name: account.name, token, rev: p.rev, profile: p.data };
  }

  // Adresse du joueur (Render place la vraie adresse en tête de x-forwarded-for)
  function clientIp(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || req.socket.remoteAddress || '?';
  }

  async function route(req, method, path) {
    if (method === 'GET' && path === '/health') return [200, { ok: true, service: 'bor-rog', api: API_VERSION, db: await dbStatus() }];
    if (!path.startsWith('/api/')) return [404, { error: 'introuvable' }];

    let body = {};
    if (method === 'POST' || method === 'PUT') {
      const b = await readBody(req);
      if (b.tooLarge) return [413, { error: 'Requête trop grosse.' }];
      if (!b.json || typeof b.json !== 'object') return [400, { error: 'Requête illisible.' }];
      body = b.json;
    }
    const ip = clientIp(req);

    if (method === 'POST' && path === '/api/register') {
      if (limited('register', ip, REGISTERS)) return [429, { error: 'Trop de comptes créés, réessaie plus tard.' }];
      const name = cleanName(body.name);
      if (!name) return [400, { error: NAME_RULE }];
      if (!validPassword(body.password)) return [400, { error: PASSWORD_RULE }];
      count('register', ip, 3600e3);
      const account = await store.createAccount(name, nameKey(name), await hashPassword(body.password));
      if (!account) return [409, { error: 'Ce pseudo est déjà pris.' }];
      return [201, await openSession(account)];
    }

    if (method === 'POST' && path === '/api/login') {
      if (limited('login', ip, LOGIN_FAILS)) return [429, { error: 'Trop d’essais, attends une minute.' }];
      const name = cleanName(body.name);
      const password = typeof body.password === 'string' ? body.password : '';
      const account = name ? await store.findAccount(nameKey(name)) : null;
      const ok = account ? await verifyPassword(password, account.pass) : await dummyVerify(password);
      if (!ok) {
        count('login', ip, 60e3);
        // Même message que le pseudo existe ou non
        return [401, { error: 'Pseudo ou mot de passe incorrect.' }];
      }
      return [200, await openSession(account)];
    }

    // Tout le reste demande d'être connecté
    const account = await auth(req);
    if (!account) return [401, { error: 'Session expirée, reconnecte-toi.' }];

    if (method === 'POST' && path === '/api/logout') {
      const m = /^Bearer (\S+)$/.exec(req.headers.authorization);
      await store.deleteSession(tokenHash(m[1]));
      return [200, { ok: true }];
    }
    if (method === 'GET' && path === '/api/profile') {
      const p = await store.getProfile(account.id);
      return [200, { name: account.name, rev: p.rev, profile: p.data }];
    }
    if (method === 'PUT' && path === '/api/profile') {
      if (!body.profile || typeof body.profile !== 'object') return [400, { error: 'Profil manquant.' }];
      const baseRev = Number.isInteger(body.baseRev) && body.baseRev >= 0 ? body.baseRev : 0;
      const r = await store.putProfile(account.id, sanitizeProfile(body.profile), baseRev);
      // Conflit : un autre appareil a écrit depuis ; le client choisit quoi garder
      if (!r.ok) return [409, { error: 'conflit', rev: r.rev, profile: r.data }];
      return [200, { rev: r.rev }];
    }
    return [404, { error: 'introuvable' }];
  }

  return async function handle(req, res) {
    const origin = req.headers.origin;
    const path = new URL(req.url, 'http://localhost').pathname;
    // Pré-vérification CORS du navigateur (requêtes avec jeton ou JSON)
    if (req.method === 'OPTIONS') {
      const h = headers(origin);
      h['access-control-allow-methods'] = 'GET, POST, PUT, OPTIONS';
      h['access-control-allow-headers'] = 'content-type, authorization';
      h['access-control-max-age'] = '600';
      res.writeHead(204, h);
      res.end();
      return;
    }
    let status;
    let body;
    try {
      [status, body] = await route(req, req.method, path);
    } catch (err) {
      console.error('Erreur serveur :', err);
      [status, body] = [500, { error: 'Erreur du serveur, réessaie plus tard.' }];
    }
    if (res.headersSent) return;
    const h = headers(origin);
    if (status === 413) h.connection = 'close';
    res.writeHead(status, h);
    res.end(JSON.stringify(body), () => {
      if (status === 413) req.destroy();
    });
  };
}
