// Serveur (étape 8b) : comptes, connexion, sauvegarde du profil en ligne.
// Vrai serveur HTTP sur un port libre, stockage en mémoire (mêmes règles que Postgres ;
// TEST_DATABASE_URL=postgres://... npm test les rejoue contre une vraie base).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { createMemoryStore } from '../server/memoryStore.js';
import { hashPassword, verifyPassword, cleanName } from '../server/auth.js';
import { newProfile } from '../src/meta/profile.js';

let server;
let base;
let clock = 1_000_000;
let store;
before(async () => {
  // Avec TEST_DATABASE_URL, les mêmes tests tournent contre un vrai Postgres (tables recréées)
  if (process.env.TEST_DATABASE_URL) {
    const { createPgStore } = await import('../server/pgStore.js');
    store = createPgStore(process.env.TEST_DATABASE_URL, { ssl: false });
    await store.pool.query('drop table if exists profiles, sessions, accounts');
  } else store = createMemoryStore();
  await store.init();
  const app = createApp({ store, origins: ['https://ozaxe.github.io'], now: () => clock });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await store.close();
});

// Chaque test a sa propre « adresse » (le limiteur d'essais compte par adresse)
let ipCounter = 0;
function client() {
  const ip = `10.0.0.${++ipCounter}`;
  return async (method, path, body, token) => {
    const headers = { 'x-forwarded-for': ip };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
}

test('mot de passe : empreinte salée, jamais le mot de passe en clair', async () => {
  const a = await hashPassword('hadesrocks');
  const b = await hashPassword('hadesrocks');
  assert.notEqual(a, b, 'un sel différent à chaque fois');
  assert.ok(!a.includes('hadesrocks'));
  assert.equal(await verifyPassword('hadesrocks', a), true);
  assert.equal(await verifyPassword('hadesrock', a), false);
  assert.equal(cleanName('  Zagreus '), 'Zagreus');
  assert.equal(cleanName('ab'), null);
  assert.equal(cleanName('a b c'), null);
  assert.equal(cleanName('Éloïse_93'), 'Éloïse_93');
});

test('créer un compte, se connecter, enregistrer et relire son profil', async () => {
  const api = client();
  const reg = await api('POST', '/api/register', { name: 'Orphee', password: 'eurydice!' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.name, 'Orphee');
  assert.equal(reg.body.rev, 0);
  assert.equal(reg.body.profile, null);
  const p = newProfile();
  p.shadows = 321;
  p.attrs.ares = 4;
  p.stats.runs = 7;
  const put = await api('PUT', '/api/profile', { profile: p, baseRev: 0 }, reg.body.token);
  assert.equal(put.status, 200);
  assert.equal(put.body.rev, 1);
  // Connexion sur un « autre appareil » (casse du pseudo indifférente)
  const login = await api('POST', '/api/login', { name: 'orphee', password: 'eurydice!' });
  assert.equal(login.status, 200);
  assert.notEqual(login.body.token, reg.body.token, 'un jeton par appareil');
  assert.equal(login.body.rev, 1);
  assert.equal(login.body.profile.shadows, 321);
  assert.equal(login.body.profile.attrs.ares, 4);
  const get = await api('GET', '/api/profile', undefined, login.body.token);
  assert.equal(get.body.profile.stats.runs, 7);
  assert.equal(get.body.name, 'Orphee');
});

test('pseudo unique (casse comprise), règles de pseudo et de mot de passe', async () => {
  const api = client();
  assert.equal((await api('POST', '/api/register', { name: 'Persephone', password: 'grenade123' })).status, 201);
  const dup = await api('POST', '/api/register', { name: 'PERSEPHONE', password: 'autre12345' });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /déjà pris/);
  assert.equal((await api('POST', '/api/register', { name: 'x', password: 'grenade123' })).status, 400);
  assert.equal((await api('POST', '/api/register', { name: 'Megara', password: 'court' })).status, 400);
  assert.equal((await api('POST', '/api/register', { name: 'Megara' })).status, 400);
});

test('mauvais mot de passe ou pseudo inconnu : même réponse, et pas de jeton', async () => {
  const api = client();
  await api('POST', '/api/register', { name: 'Achille', password: 'patrocle1' });
  const bad = await api('POST', '/api/login', { name: 'Achille', password: 'patrocle2' });
  const unknown = await api('POST', '/api/login', { name: 'Inconnu', password: 'patrocle1' });
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(bad.body.error, unknown.body.error);
  assert.equal(bad.body.token, undefined);
});

test('sans jeton valide, le profil est inaccessible ; la déconnexion invalide le jeton', async () => {
  const api = client();
  const reg = await api('POST', '/api/register', { name: 'Sisyphe', password: 'rocher!!' });
  assert.equal((await api('GET', '/api/profile')).status, 401);
  assert.equal((await api('GET', '/api/profile', undefined, 'faux-jeton')).status, 401);
  assert.equal((await api('PUT', '/api/profile', { profile: newProfile() }, 'faux-jeton')).status, 401);
  assert.equal((await api('GET', '/api/profile', undefined, reg.body.token)).status, 200);
  assert.equal((await api('POST', '/api/logout', {}, reg.body.token)).status, 200);
  assert.equal((await api('GET', '/api/profile', undefined, reg.body.token)).status, 401);
});

test('le jeton expire après 90 jours', async () => {
  const api = client();
  const reg = await api('POST', '/api/register', { name: 'Tantale', password: 'soif!!!!' });
  clock += 89 * 86400e3;
  assert.equal((await api('GET', '/api/profile', undefined, reg.body.token)).status, 200);
  clock += 2 * 86400e3;
  assert.equal((await api('GET', '/api/profile', undefined, reg.body.token)).status, 401);
});

test('trop d’essais ratés : connexion bloquée une minute pour cette adresse', async () => {
  const api = client();
  await api('POST', '/api/register', { name: 'Icare', password: 'soleil!!' });
  for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/api/login', { name: 'Icare', password: 'mauvais!' })).status, 401);
  // Même le bon mot de passe est refusé pendant le blocage
  assert.equal((await api('POST', '/api/login', { name: 'Icare', password: 'soleil!!' })).status, 429);
  // Une autre adresse n'est pas touchée
  assert.equal((await client()('POST', '/api/login', { name: 'Icare', password: 'soleil!!' })).status, 200);
  clock += 61e3;
  assert.equal((await api('POST', '/api/login', { name: 'Icare', password: 'soleil!!' })).status, 200);
});

test('création de comptes limitée à 5 par heure et par adresse', async () => {
  const api = client();
  for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/api/register', { name: `Ombre${i}x`, password: 'password1' })).status, 201);
  assert.equal((await api('POST', '/api/register', { name: 'Ombre9x', password: 'password1' })).status, 429);
});

test('profil trafiqué : relu par les règles du jeu avant d’être enregistré', async () => {
  const api = client();
  const reg = await api('POST', '/api/register', { name: 'Hermes', password: 'sandales' });
  const evil = { shadows: -50, attrs: { ares: 99, hermes: 'x' }, talents: { inconnu: 3 }, cls: 'dieu', stats: { runs: 2.5 } };
  assert.equal((await api('PUT', '/api/profile', { profile: evil, baseRev: 0 }, reg.body.token)).status, 200);
  const p = (await api('GET', '/api/profile', undefined, reg.body.token)).body.profile;
  assert.equal(p.shadows, 0);
  assert.ok(p.attrs.ares <= 10);
  assert.equal(p.attrs.hermes, 1);
  assert.deepEqual(p.talents, {});
  assert.equal(p.cls, 'warrior');
  assert.equal(p.stats.runs, 0);
});

test('deux appareils : une écriture basée sur une vieille version est refusée (409) avec la version du serveur', async () => {
  const api = client();
  const reg = await api('POST', '/api/register', { name: 'Janus', password: 'deuxfaces' });
  const pc = reg.body.token;
  const phone = (await api('POST', '/api/login', { name: 'Janus', password: 'deuxfaces' })).body.token;
  const a = newProfile();
  a.shadows = 100;
  assert.equal((await api('PUT', '/api/profile', { profile: a, baseRev: 0 }, pc)).body.rev, 1);
  const b = newProfile();
  b.shadows = 5;
  const conflict = await api('PUT', '/api/profile', { profile: b, baseRev: 0 }, phone);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.rev, 1);
  assert.equal(conflict.body.profile.shadows, 100, 'rien n’a été écrasé');
  // Le joueur choisit de garder la version du téléphone : il écrit par-dessus la version 1
  const keep = await api('PUT', '/api/profile', { profile: b, baseRev: 1 }, phone);
  assert.equal(keep.status, 200);
  assert.equal(keep.body.rev, 2);
  assert.equal((await api('GET', '/api/profile', undefined, pc)).body.profile.shadows, 5);
});

test('CORS : seul le site du jeu est autorisé ; requêtes abîmées ou énormes refusées proprement', async () => {
  const pre = await fetch(`${base}/api/profile`, {
    method: 'OPTIONS',
    headers: { origin: 'https://ozaxe.github.io', 'access-control-request-method': 'PUT' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://ozaxe.github.io');
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const evil = await fetch(`${base}/health`, { headers: { origin: 'https://pirate.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await evil.json(), { ok: true, service: 'bor-rog', api: 1, db: 'ok' });

  const api = client();
  const r = await fetch(`${base}/api/login`, { method: 'POST', body: '{pas du json' });
  assert.equal(r.status, 400);
  const big = await fetch(`${base}/api/register`, { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(40000) }) });
  assert.equal(big.status, 413);
  assert.equal((await api('GET', '/nimporte')).status, 404);
});
