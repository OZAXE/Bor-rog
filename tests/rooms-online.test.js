// Salons en ligne (étape 8d) : création, code, lancement, intentions, instantanés,
// départs et retours. Fausses connexions et fausse horloge : aucun réseau.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRooms } from '../server/rooms.js';
import { packIntent, unpackIntent, encode, fixedOf, snapshotOf, stateFromSnapshot, roomCode, cleanPlayerName, ROOM_CODE_LETTERS, joinLink, codeFromLink } from '../src/net/protocol.js';
import { createGameState } from '../src/state/gameState.js';
import { stepGame } from '../src/systems/simulation.js';
import { TILE } from '../src/dungeon/tiles.js';

function world() {
  let t = 1000;
  let r = 0.123;
  const rooms = createRooms({ now: () => t, random: () => (r = (r * 9301 + 0.4927) % 1) });
  const conn = () => {
    const c = { inbox: [], send: (m) => c.inbox.push(JSON.parse(encode(m))) };
    c.last = (type) => [...c.inbox].reverse().find((m) => m.t === type);
    c.all = (type) => c.inbox.filter((m) => m.t === type);
    return c;
  };
  // Le temps saute d'un coup (serveur bloqué), puis un seul tour de boucle
  const freeze = (ms) => {
    t += ms;
    rooms.tick();
  };
  const advance = (ms) => {
    for (let k = 0; k < ms; k += 4) {
      t += 4;
      rooms.tick();
    }
  };
  return { rooms, conn, advance, freeze, clock: () => t };
}

// Deux joueurs dans un salon lancé
function duo(w) {
  const a = w.conn();
  const b = w.conn();
  w.rooms.message(a, { t: 'create', name: 'Orphée', cls: 'warrior', meta: {} });
  const code = a.last('lobby').code;
  w.rooms.message(b, { t: 'join', code: code.toLowerCase(), name: 'Eurydice', cls: 'huntress', meta: {} });
  w.rooms.message(a, { t: 'start' });
  return { a, b, code, room: w.rooms.rooms.get(code) };
}

test('protocole : intentions compactes, code de salon, pseudo nettoyé', () => {
  const i = { moveX: 0.70710678, moveY: -0.5, aimX: 0, aimY: 1, attack: true, dash: false, special: true };
  const back = unpackIntent(packIntent(i));
  assert.equal(back.moveX, 0.707);
  assert.equal(back.attack, true);
  assert.equal(back.dash, false);
  assert.equal(back.special, true);
  assert.deepEqual(unpackIntent('n’importe quoi'), {});
  const code = roomCode(() => 0.5);
  assert.equal(code.length, 4);
  for (const ch of code) assert.ok(ROOM_CODE_LETTERS.includes(ch));
  assert.ok(!/[ILO]/.test(ROOM_CODE_LETTERS));
  assert.equal(cleanPlayerName('<script>Zag</script>'), 'scriptZagscript');
  assert.equal(cleanPlayerName(''), 'Invité');
});

test('lien d’invitation (QR code) : l’adresse du jeu avec le code, relue à l’arrivée', () => {
  const link = joinLink('https://ozaxe.github.io/Bor-rog/?seed=abc&coop=bot#x', 'RTZB');
  assert.equal(link, 'https://ozaxe.github.io/Bor-rog/?join=RTZB');
  // Les réglages de test (serveur local) sont gardés
  assert.equal(joinLink('http://localhost:4173/Bor-rog/?server=http%3A%2F%2Flocalhost%3A10000', 'ABCD'), 'http://localhost:4173/Bor-rog/?server=http%3A%2F%2Flocalhost%3A10000&join=ABCD');
  assert.equal(codeFromLink(new URL(link).search), 'RTZB');
  assert.equal(codeFromLink('?join=rtzb'), 'RTZB');
  assert.equal(codeFromLink('?join=RT1B'), '', 'caractère interdit');
  assert.equal(codeFromLink('?join=RTZBX'), '');
  assert.equal(codeFromLink('?seed=x'), '');
});

test('instantané : l’état reconstruit côté navigateur a la même forme que la simulation', () => {
  const s = createGameState('forme', { players: [{ cls: 'mystic' }, { cls: 'huntress' }] });
  for (let i = 0; i < 120; i++) stepGame(s, [{ moveX: 1 }, { moveX: 1 }]);
  s.lock = { roomId: 0, doors: [{ c: 3, r: 4, axis: 'x' }], enemyIds: [] };
  const snap = JSON.parse(encode(snapshotOf(s)));
  const fixed = JSON.parse(encode(fixedOf(s)));
  assert.equal(snap.dungeon, undefined, 'le décor n’est pas répété à chaque instantané');
  assert.equal(snap.rng, undefined);
  assert.equal(snap.players[0].meta, undefined);
  const c = stateFromSnapshot(fixed, snap);
  assert.equal(c.players.length, 2);
  assert.equal(c.players[1].cls, 'huntress');
  assert.deepEqual(c.players[0].meta, s.players[0].meta);
  assert.ok(Math.abs(c.players[0].x - s.players[0].x) < 0.001);
  assert.equal(c.enemies.length, s.enemies.length);
  assert.equal(c.dungeon.tiles[4 * c.dungeon.width + 3], TILE.GATE, 'grille posée');
  assert.notEqual(fixed.dungeon.tiles[4 * c.dungeon.width + 3], TILE.GATE, 'décor reçu intact');
  // Taille : un instantané reste petit (avant compression)
  assert.ok(encode(snapshotOf(s)).length < encode(s).length * 0.75);
});

test('créer un salon, le rejoindre avec son code (casse indifférente), lancer à deux', () => {
  const w = world();
  const a = w.conn();
  const b = w.conn();
  w.rooms.message(a, { t: 'create', name: 'Orphée', cls: 'warrior' });
  const lobby = a.last('lobby');
  assert.match(lobby.code, /^[A-Z]{4}$/);
  assert.equal(lobby.host, true);
  assert.equal(lobby.you, 0);
  // Seul, on ne peut pas lancer
  w.rooms.message(a, { t: 'start' });
  assert.match(a.last('error').message, /deux/);
  w.rooms.message(b, { t: 'join', code: lobby.code.toLowerCase(), name: 'Eurydice', cls: 'huntress' });
  // Salon plein avant même le lancement : un troisième est refusé
  const third = w.conn();
  w.rooms.message(third, { t: 'join', code: lobby.code, name: 'Intrus' });
  assert.match(third.last('error').message, /complet/);
  assert.equal(a.last('lobby').players.length, 2);
  assert.deepEqual(a.last('lobby').players.map((p) => p.name), ['Orphée', 'Eurydice']);
  assert.equal(b.last('lobby').you, 1);
  assert.equal(b.last('lobby').host, false);
  // L'invité ne peut pas lancer
  w.rooms.message(b, { t: 'start' });
  assert.equal(b.last('start'), undefined);
  w.rooms.message(a, { t: 'start' });
  const sa = a.last('start');
  const sb = b.last('start');
  assert.equal(sa.you, 0);
  assert.equal(sb.you, 1);
  assert.equal(sa.fixed.seed, sb.fixed.seed);
  assert.deepEqual(sa.snap.players.map((p) => p.cls), ['warrior', 'huntress']);
  // Un troisième ne peut plus entrer
  const c = w.conn();
  w.rooms.message(c, { t: 'join', code: lobby.code });
  assert.match(c.last('error').message, /complet/);
  w.rooms.message(c, { t: 'join', code: 'ZZZZ' });
  assert.match(c.last('error').message, /Aucun salon/);
});

test('la partie avance au rythme réel : 60 pas et 20 instantanés par seconde', () => {
  const w = world();
  const { a, room } = duo(w);
  w.advance(1000);
  assert.ok(Math.abs(room.state.tick - 60) <= 1, `tick ${room.state.tick}`);
  assert.ok(Math.abs(a.all('snap').length - 20) <= 1);
  // Serveur figé 3 s (machine surchargée) : il ne rattrape que quelques pas, sans s'emballer
  const before = room.state.tick;
  w.freeze(3000);
  assert.ok(room.state.tick - before <= 6, `${room.state.tick - before} pas rattrapés`);
});

test('les intentions de chaque joueur font bouger SON héros ; l’accusé de réception suit', () => {
  const w = world();
  const { a, b, room } = duo(w);
  const [p0, p1] = room.state.players;
  const x0 = p0.x;
  const x1 = p1.x;
  const east = packIntent({ moveX: 1 });
  const west = packIntent({ moveX: -1 });
  // Comme un vrai navigateur : une intention par image, au fil du temps
  for (let k = 0; k < 30; k++) {
    w.rooms.message(a, { t: 'in', s: k + 1, l: [east] });
    w.rooms.message(b, { t: 'in', s: k + 1, l: [west] });
    w.advance(16);
  }
  w.advance(200);
  assert.ok(p0.x > x0 + 1, 'le joueur 1 va à l’est');
  assert.ok(p1.x < x1 - 1, 'le joueur 2 va à l’ouest');
  assert.equal(a.last('snap').ack, 30);
  // Une intention déjà jouée ou en double est ignorée
  w.rooms.message(a, { t: 'in', s: 5, l: [west] });
  assert.equal(room.seats[0].queue.length, 0);
  // Trop d'intentions d'un coup, ou de nombreux messages sans pas joué : la file reste bornée
  w.rooms.message(a, { t: 'in', s: 100, l: Array(500).fill(east) });
  assert.ok(room.seats[0].queue.length <= 12);
  for (let k = 0; k < 10; k++) w.rooms.message(a, { t: 'in', s: 1000 + k * 12, l: Array(12).fill(east) });
  assert.ok(room.seats[0].queue.length <= 12, `${room.seats[0].queue.length} en attente`);
});

test('Charon en ligne : chacun choisit avec un message d’action', () => {
  const w = world();
  const { a, b, room } = duo(w);
  const st = room.state.dungeon.stairs;
  Object.assign(room.state.players[0], { x: st.c + 0.5, z: st.r + 0.5 });
  room.state.enemies = [];
  w.advance(100);
  assert.equal(room.state.status, 'choosing');
  assert.ok(a.last('snap').players[0].offer, 'l’offre est dans l’instantané');
  const floor = room.state.floorIndex;
  // Un achat n'est fait qu'une fois par message (pas répété aux pas suivants)
  const pa = room.state.players[0];
  pa.hp = 2;
  pa.gold = 100;
  w.rooms.message(a, { t: 'act', shop: 'heal' });
  w.advance(200);
  assert.equal(pa.hp, 2 + 4);
  w.rooms.message(a, { t: 'act', choice: 0 });
  w.advance(100);
  assert.equal(room.state.status, 'choosing', 'on attend l’autre');
  assert.ok(a.all('snap').length > 0);
  const snaps = b.all('snap').length;
  w.advance(100);
  assert.ok(b.all('snap').length > snaps, 'les instantanés continuent pendant le choix');
  w.rooms.message(b, { t: 'act', choice: 1 });
  w.advance(100);
  assert.equal(room.state.floorIndex, floor + 1);
  // Nouvel étage : le décor est envoyé aux deux
  assert.equal(a.last('floor').fixed.floorIndex, floor + 1);
  assert.equal(b.last('floor').fixed.floorIndex, floor + 1);
});

test('les événements d’un instantané regroupent ceux des pas écoulés', () => {
  const w = world();
  const { a, room } = duo(w);
  w.rooms.message(a, { t: 'in', s: 1, l: [packIntent({ dash: true })] });
  w.advance(200);
  assert.ok(a.all('snap').some((m) => m.ev.some((e) => e.type === 'dash')));
  assert.equal(room.events.length < 50, true);
});

test('coupure : la partie continue, le joueur revient avec son jeton ; un départ volontaire le met hors jeu', () => {
  const w = world();
  const { a, b, code, room } = duo(w);
  const token = b.last('lobby').token;
  w.rooms.disconnect(b);
  const n = a.all('snap').length;
  w.advance(300);
  assert.ok(a.all('snap').length > n, 'la partie continue pour l’autre');
  // Mauvais jeton : refusé
  const intrus = w.conn();
  w.rooms.message(intrus, { t: 'rejoin', code, token: 'faux' });
  assert.match(intrus.last('error').message, /introuvable/);
  const b2 = w.conn();
  w.rooms.message(b2, { t: 'rejoin', code, token });
  assert.equal(b2.last('start').you, 1);
  w.advance(100);
  assert.ok(b2.all('snap').length > 0);
  // Départ volontaire : hors jeu pour toute la partie, l'autre est prévenu
  w.rooms.message(b2, { t: 'leave' });
  assert.equal(room.state.players[1].left, true);
  assert.equal(room.state.players[1].out, true);
  assert.equal(a.last('left').name, 'Eurydice');
  // Il ne revient pas à l'étage suivant, et ne choisit pas chez Charon
  const st = room.state.dungeon.stairs;
  room.state.enemies = [];
  Object.assign(room.state.players[0], { x: st.c + 0.5, z: st.r + 0.5 });
  w.advance(100);
  assert.equal(room.state.players[1].offer, null);
  w.rooms.message(a, { t: 'act', choice: 0 });
  w.advance(100);
  assert.equal(room.state.status, 'playing');
  assert.equal(room.state.players[1].out, true);
});

test('fin de partie : dernier instantané envoyé, salon fermé un peu plus tard', () => {
  const w = world();
  const { a, code, room } = duo(w);
  room.state.players[0].hp = 0;
  room.state.players[0].down = 1;
  room.state.players[1].out = true;
  w.advance(100);
  assert.equal(room.phase, 'ended');
  assert.equal(a.last('snap').status, 'dead');
  const n = a.all('snap').length;
  w.advance(500);
  assert.equal(a.all('snap').length, n, 'plus rien après la fin');
  w.advance(61e3);
  assert.equal(w.rooms.rooms.has(code), false);
});

test('salon : le créateur part, le salon ferme ; l’invité part, la place se libère ; partie vide fermée', () => {
  const w = world();
  const a = w.conn();
  const b = w.conn();
  w.rooms.message(a, { t: 'create', name: 'A' });
  const code = a.last('lobby').code;
  w.rooms.message(b, { t: 'join', code, name: 'B' });
  w.rooms.message(b, { t: 'leave' });
  assert.equal(a.last('lobby').players.length, 1);
  w.rooms.message(b, { t: 'join', code, name: 'B' });
  w.rooms.message(a, { t: 'leave' });
  assert.match(b.last('error').message, /parti/);
  assert.equal(w.rooms.rooms.has(code), false);
  // Partie dont les deux joueurs ont disparu : fermée au bout de 2 minutes
  const d = duo(w);
  w.rooms.disconnect(d.a);
  w.rooms.disconnect(d.b);
  w.advance(1000);
  assert.ok(w.rooms.rooms.has(d.code));
  w.advance(121e3);
  assert.equal(w.rooms.rooms.has(d.code), false);
});
