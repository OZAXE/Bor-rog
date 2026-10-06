// Jeu en ligne de bout en bout (étape 8d) : vrai serveur HTTP + WebSocket sur un port libre,
// deux vrais clients. Vérifie aussi le filtrage de l'origine et le débit (compression).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { attachRealtime } from '../server/realtime.js';
import { packIntent } from '../src/net/protocol.js';

// La bibliothèque WebSocket est une dépendance du serveur (server/node_modules)
const WebSocket = createRequire(new URL('../server/package.json', import.meta.url))('ws');

let server;
let rt;
let url;
before(async () => {
  server = http.createServer((req, res) => res.end());
  rt = attachRealtime(server, { origins: ['https://ozaxe.github.io'] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${server.address().port}/play`;
});
after(() => {
  rt.close();
  server.close();
});

// Client de test : garde les messages reçus et compte les octets réellement transmis
function client(origin = 'https://ozaxe.github.io') {
  const ws = new WebSocket(url, { origin, perMessageDeflate: true });
  const c = { ws, inbox: [], bytes: 0 };
  ws.on('message', (data) => c.inbox.push(JSON.parse(data.toString())));
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (type, ms = 3000) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const look = () => {
        const m = c.inbox.find((x) => x.t === type);
        if (m) return resolve(m);
        if (Date.now() - t0 > ms) return reject(new Error(`pas de message ${type}`));
        setTimeout(look, 10);
      };
      look();
    });
  c.open = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    ws.on('unexpected-response', (req, res) => reject(new Error(`refusé ${res.statusCode}`)));
  });
  return c;
}

test('une origine inconnue est refusée', async () => {
  const c = client('https://pirate.example');
  await assert.rejects(c.open, /refusé|401|403/);
});

test('deux joueurs : salon, lancement, déplacement, instantanés compressés', async () => {
  const a = client();
  const b = client();
  await Promise.all([a.open, b.open]);
  a.send({ t: 'create', name: 'Orphée', cls: 'warrior', meta: {} });
  const lobby = await a.wait('lobby');
  b.send({ t: 'join', code: lobby.code, name: 'Eurydice', cls: 'mystic', meta: {} });
  await b.wait('lobby');
  a.send({ t: 'start' });
  const start = await a.wait('start');
  await b.wait('start');
  const x0 = start.snap.players[0].x;
  // Une intention toutes les 16 ms pendant 1 s
  for (let k = 1; k <= 60; k++) {
    a.send({ t: 'in', s: k, l: [packIntent({ moveX: 1 })] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await new Promise((r) => setTimeout(r, 200));
  const snaps = a.inbox.filter((m) => m.t === 'snap');
  const last = snaps[snaps.length - 1];
  assert.ok(snaps.length >= 15, `${snaps.length} instantanés en ~1,2 s`);
  assert.ok(last.players[0].x > x0 + 2, 'le héros du joueur 1 a avancé');
  assert.ok(last.ack >= 50);
  assert.equal(last.players[1].cls, 'mystic');
  // Débit réel (compressé) reçu par le joueur 1 : octets lus sur la connexion
  const bytes = a.ws._socket.bytesRead;
  const seconds = 1.2;
  if (process.env.DEBIT) console.log(`débit reçu : ${Math.round(bytes / seconds)} octets/s`);
  assert.ok(bytes / seconds < 40000, `${Math.round(bytes / seconds)} octets/s`);
  a.ws.close();
  b.ws.close();
});
