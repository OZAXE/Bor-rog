// Côté navigateur du jeu en ligne (étape 8d) : prédiction de mon héros et affichage
// interpolé, avec un vrai salon serveur et un réseau simulé (latence de 60 ms).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRooms } from '../server/rooms.js';
import { createNetGame } from '../src/net/netGame.js';
import { encode } from '../src/net/protocol.js';

const LATENCY = 60; // ms dans chaque sens

function setup() {
  let t = 0;
  let r = 0.37;
  const rooms = createRooms({ now: () => t, random: () => (r = (r * 9301 + 0.4927) % 1) });
  const pipes = []; // messages en transit : { at, deliver }
  const later = (fn) => pipes.push({ at: t + LATENCY, fn });
  // Connexion côté serveur : ce qu'elle « envoie » arrive au navigateur 60 ms plus tard
  const conn = (name) => {
    const c = { name, inbox: [], game: null };
    c.send = (m) => {
      const copy = JSON.parse(encode(m));
      later(() => (c.game && copy.t !== 'start' ? c.game.receive(copy) : c.inbox.push(copy)));
    };
    return c;
  };
  const a = conn('a');
  const b = conn('b');
  rooms.message(a, { t: 'create', name: 'A', cls: 'warrior' });
  rooms.message(b, { t: 'join', code: [...rooms.rooms.keys()][0], name: 'B', cls: 'huntress' });
  rooms.message(a, { t: 'start' });
  const room = [...rooms.rooms.values()][0];
  // Fait avancer le monde : serveur, réseau, et le navigateur de A (une image toutes les 16 ms)
  const run = (ms, intentOf = () => ({})) => {
    const out = [];
    for (let k = 0; k < ms; k += 4) {
      t += 4;
      rooms.tick();
      for (const p of pipes.filter((x) => x.at <= t)) p.fn();
      pipes.splice(0, pipes.length, ...pipes.filter((x) => x.at > t));
      if (!a.game && a.inbox.find((m) => m.t === 'start')) {
        const start = a.inbox.find((m) => m.t === 'start');
        a.game = createNetGame(start, (msg) => later(() => rooms.message(a, msg)));
      }
      if (a.game && t % 16 === 0) {
        a.game.localStep(intentOf(t));
        a.game.flush();
        out.push(a.game.advance(0.016));
      }
    }
    return out;
  };
  return { rooms, room, a, run, now: () => t };
}

test('prédiction : mon héros bouge DÈS l’appui, sans attendre l’aller-retour au serveur', () => {
  const w = setup();
  w.run(400); // le jeu démarre chez A
  const x0 = w.a.game.hero().x;
  const serverX0 = w.room.state.players[0].x;
  w.run(48, () => ({ moveX: 1 })); // 3 images
  assert.ok(w.a.game.hero().x > x0 + 0.05, 'le héros prédit a déjà avancé');
  assert.ok(w.room.state.players[0].x - serverX0 < 0.01, 'le serveur ne l’a pas encore reçu');
});

test('en marchant, la position prédite avance sans à-coups vers l’arrière à chaque réponse du serveur', () => {
  const w = setup();
  w.run(400);
  const xs = [];
  let lead = 0;
  for (let k = 0; k < 60; k++) {
    w.run(16, () => ({ moveX: 1 }));
    xs.push(w.a.game.heroView(1).x);
    // À mi-course (avant le mur), écart entre mon écran et la position actuelle du serveur
    if (k === 30) lead = w.a.game.heroView(1).x - w.room.state.players[0].x;
  }
  // Couloir libre devant ? On ne regarde que la phase où le héros avance vraiment
  const moving = xs.filter((x, i) => i > 0 && x !== xs[i - 1]).length;
  assert.ok(moving > 20, 'il avance');
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1] - 0.02, `recul à l’image ${i} : ${xs[i - 1]} -> ${xs[i]}`);
  // Mes commandes ont une longueur d'avance : l'écran n'est jamais en retard sur le serveur
  // (sans rejouer les commandes non confirmées, il le serait d'environ latence × vitesse)
  assert.ok(lead > -0.15, `en retard de ${(-lead).toFixed(2)} m sur le serveur`);
});

test('après l’aller-retour, prédiction et serveur concordent ; les intentions confirmées sont oubliées', () => {
  const w = setup();
  w.run(400);
  w.run(1000, (t) => ({ moveX: Math.sin(t / 300), moveY: Math.cos(t / 300) }));
  w.run(500); // on lâche les commandes, tout arrive
  const pred = w.a.game.hero();
  const srv = w.room.state.players[0];
  assert.ok(Math.hypot(pred.x - srv.x, pred.z - srv.z) < 0.05, `écart ${Math.hypot(pred.x - srv.x, pred.z - srv.z)}`);
  // Restent en attente seulement les intentions de l'aller-retour en cours (~140 ms)
  assert.ok(w.a.game.pending() <= 16, `${w.a.game.pending()} en attente`);
});

test('affichage des autres : fluide, avec un retard d’environ 80 ms + la latence', () => {
  const w = setup();
  w.run(400);
  const frames = w.run(1000, () => ({}));
  // Chaque image a un état ; l'instantané change environ 20 fois par seconde
  assert.ok(frames.every((f) => f.state && f.alpha >= 0 && f.alpha <= 1));
  const changes = frames.filter((f) => f.changed).length;
  assert.ok(changes >= 14 && changes <= 24, `${changes} changements`);
  // Retard affiché par rapport au serveur : latence (60 ms) + retard d'interpolation (~83 ms)
  const lag = (w.room.state.tick - frames[frames.length - 1].state.tick) / 60;
  assert.ok(lag > 0.06 && lag < 0.3, `retard ${lag.toFixed(3)} s`);
});

test('chaque événement du serveur est rendu une seule fois', () => {
  const w = setup();
  w.run(400);
  // Trois esquives espacées de 1,2 s (au-delà de la recharge)
  const frames = w.run(3600, (t) => ({ dash: t % 1200 < 16 }));
  frames.push(...w.run(400));
  const all = frames.flatMap((f) => f.events).filter((e) => e.type === 'dash');
  // Ni perdue ni en double : exactement une par appui
  assert.equal(all.length, 3, `${all.length} esquives affichées`);
});
