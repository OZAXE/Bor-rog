// Salons de jeu en ligne (étape 8d) : le serveur fait tourner la simulation de chaque
// partie et diffuse l'état aux deux joueurs. Ce fichier ne connaît pas le réseau : une
// « connexion » est un objet { send(message) } fourni de l'extérieur (realtime.js), ce
// qui permet de tester toutes les règles sans ouvrir de vraie connexion.

import { createGameState } from '../src/state/gameState.js';
import { stepGame, STEP } from '../src/systems/simulation.js';
import { classOf } from '../src/systems/classes.js';
import { SIM } from '../src/systems/simConfig.js';
import { roomCode, cleanPlayerName, unpackIntent, fixedOf, snapshotOf, SNAPSHOT_EVERY } from '../src/net/protocol.js';

const MAX_ROOMS = 100;
const MAX_QUEUE = 12; // intentions en attente au plus (au-delà, les plus anciennes sont jetées)
const MAX_CATCHUP = 5; // pas rattrapés au plus par tour de boucle (serveur ralenti)
const LOBBY_TTL = 10 * 60e3; // salon jamais lancé : fermé au bout de 10 min
const EMPTY_TTL = 2 * 60e3; // partie sans aucun joueur connecté : fermée au bout de 2 min
const BETWEEN_TTL = 30 * 60e3; // entre deux descentes (au Seuil) : salon gardé 30 min

// now() : horloge en millisecondes ; random() : nombre dans [0, 1[ (codes, graines, jetons)
export function createRooms({ now = () => Date.now(), random = Math.random } = {}) {
  const rooms = new Map(); // code -> salon
  const where = new Map(); // connexion -> { room, slot }

  const token = () => Array.from({ length: 4 }, () => Math.floor(random() * 2 ** 32).toString(36)).join('');

  function newCode() {
    for (let k = 0; k < 50; k++) {
      const c = roomCode(random);
      if (!rooms.has(c)) return c;
    }
    return null;
  }

  // Profil de jeu envoyé par le joueur (validé ensuite par createGameState : cleanMeta, classOf)
  function seatOf(conn, msg) {
    return {
      conn,
      name: cleanPlayerName(msg.name),
      cls: classOf(msg.cls),
      meta: msg.meta && typeof msg.meta === 'object' ? msg.meta : {},
      token: token(),
      queue: [], // intentions reçues pas encore jouées : [seq, intention]
      last: {}, // dernière intention jouée (répétée si la file est vide)
      ack: 0, // numéro de la dernière intention jouée
      action: null, // choix chez Charon en attente
      left: false,
      ready: false, // entre deux descentes : prêt à repartir
    };
  }

  function lobbyMessage(room, slot) {
    const seat = room.seats[slot];
    return {
      t: 'lobby',
      code: room.code,
      you: slot,
      host: slot === 0,
      token: seat.token,
      players: room.seats.map((s) => ({ name: s.name, cls: s.cls, ready: s.ready })),
      between: !!room.between, // le duo est entre deux descentes (chacun au Seuil)
      run: room.run || 0, // nombre de descentes déjà lancées dans ce salon
    };
  }

  function broadcastLobby(room) {
    room.seats.forEach((s, i) => s.conn && s.conn.send(lobbyMessage(room, i)));
  }

  function error(conn, message) {
    conn.send({ t: 'error', message });
  }

  function leaveCurrent(conn) {
    const at = where.get(conn);
    if (!at) return;
    where.delete(conn);
    const { room, slot } = at;
    const seat = room.seats[slot];
    if (room.phase === 'lobby') {
      // Entre deux descentes : celui qui reste garde le salon (il en devient le créateur)
      if (room.between) {
        room.seats.splice(slot, 1);
        if (!room.seats.length) return closeRoom(room);
        reseat(room);
        broadcastLobby(room);
        return;
      }
      // Avant la première descente : le créateur part, le salon ferme ; l'invité part, la place se libère
      if (slot === 0) closeRoom(room, 'Le créateur du salon est parti.');
      else {
        room.seats.splice(1, 1);
        broadcastLobby(room);
      }
      return;
    }
    // En partie : le héros reste hors jeu jusqu'à la fin ; l'autre continue seul
    seat.conn = null;
    seat.left = true;
    const p = room.state.players[slot];
    if (room.state.status === 'playing' || room.state.status === 'choosing') {
      p.left = true;
      p.out = true;
      p.down = 0;
      p.offer = null;
    }
    for (const s of room.seats) if (s.conn) s.conn.send({ t: 'left', name: seat.name });
  }

  // Places renumérotées (après un départ) : chaque connexion connaît sa nouvelle place
  function reseat(room) {
    room.seats.forEach((st, i) => st.conn && where.set(st.conn, { room, slot: i }));
  }

  // Lance une descente avec les profils actuels des joueurs (classe, niveaux, talents)
  function startGame(room) {
    const seed = Math.floor(random() * 1e9).toString(36);
    room.state = createGameState(seed, { players: room.seats.map((st) => ({ meta: st.meta, cls: st.cls })) });
    room.phase = 'playing';
    room.between = false;
    room.run = (room.run || 0) + 1;
    room.steps = 0;
    room.floor = room.state.floorIndex;
    room.events = [];
    room.last = now();
    room.acc = 0;
    for (const st of room.seats) Object.assign(st, { ready: false, queue: [], last: {}, ack: 0, action: null, left: false });
    room.seats.forEach((st, i) => st.conn && st.conn.send(startMessage(room, i)));
  }

  // Fin d'une descente : le duo reste ensemble. Chacun passe au Seuil, puis se déclare
  // prêt ; la descente suivante part quand les deux le sont. Les absents sont retirés.
  function backToLobby(room) {
    room.phase = 'lobby';
    room.between = true;
    room.since = now();
    room.state = null;
    for (const st of room.seats) if (!st.conn || st.left) st.conn && where.delete(st.conn);
    room.seats = room.seats.filter((st) => st.conn && !st.left);
    if (!room.seats.length) return closeRoom(room);
    for (const st of room.seats) st.ready = false;
    reseat(room);
    broadcastLobby(room);
  }

  function closeRoom(room, message) {
    for (const s of room.seats) {
      if (!s.conn) continue;
      where.delete(s.conn);
      if (message) error(s.conn, message);
    }
    rooms.delete(room.code);
  }

  // run : numéro de la descente (le navigateur distingue une nouvelle descente d'un retour après coupure)
  function startMessage(room, slot) {
    return { t: 'start', you: slot, run: room.run, fixed: fixedOf(room.state), snap: snapshot(room, slot) };
  }

  function snapshot(room, slot) {
    // n : pas joués par le salon (continue d'avancer pendant l'écran de Charon, contrairement à tick)
    return { t: 'snap', ...snapshotOf(room.state), n: room.steps, ack: room.seats[slot].ack, ev: room.events };
  }

  function handlers(conn, msg) {
    switch (msg.t) {
      case 'create': {
        leaveCurrent(conn);
        if (rooms.size >= MAX_ROOMS) return error(conn, 'Trop de parties en cours, réessaie dans un moment.');
        const code = newCode();
        if (!code) return error(conn, 'Impossible de créer un salon, réessaie.');
        const room = { code, phase: 'lobby', seats: [seatOf(conn, msg)], state: null, events: [], since: now(), acc: 0, last: now() };
        rooms.set(code, room);
        where.set(conn, { room, slot: 0 });
        broadcastLobby(room);
        return;
      }
      case 'join': {
        const room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room) return error(conn, 'Aucun salon avec ce code.');
        if (room.phase !== 'lobby' || room.seats.length >= SIM.coop.maxPlayers) return error(conn, 'Ce salon est complet.');
        leaveCurrent(conn);
        room.seats.push(seatOf(conn, msg));
        where.set(conn, { room, slot: room.seats.length - 1 });
        broadcastLobby(room);
        return;
      }
      case 'start': {
        const at = where.get(conn);
        if (!at || at.slot !== 0 || at.room.phase !== 'lobby') return;
        const room = at.room;
        if (room.seats.length < 2) return error(conn, 'Il faut être deux pour lancer la descente.');
        startGame(room);
        return;
      }
      case 'ready': {
        // Entre deux descentes : profil mis à jour (Ombres dépensées, autre personnage)
        // et prêt à repartir ; la descente part quand les deux sont prêts
        const at = where.get(conn);
        if (!at || at.room.phase !== 'lobby' || !at.room.between) return;
        const room = at.room;
        const fresh = seatOf(conn, msg);
        Object.assign(room.seats[at.slot], { name: fresh.name, cls: fresh.cls, meta: fresh.meta, ready: msg.ready !== false });
        if (room.seats.length === SIM.coop.maxPlayers && room.seats.every((st) => st.ready)) startGame(room);
        else broadcastLobby(room);
        return;
      }
      case 'rejoin': {
        const room = rooms.get(String(msg.code || '').toUpperCase());
        const slot = room ? room.seats.findIndex((s) => s.token === msg.token && !s.left) : -1;
        if (!room || slot < 0 || room.phase === 'lobby') return error(conn, 'Partie introuvable.');
        leaveCurrent(conn);
        const seat = room.seats[slot];
        if (seat.conn && seat.conn !== conn) where.delete(seat.conn);
        seat.conn = conn;
        seat.queue = [];
        where.set(conn, { room, slot });
        conn.send(startMessage(room, slot));
        return;
      }
      case 'in': {
        const at = where.get(conn);
        if (!at || at.room.phase !== 'playing' || !Array.isArray(msg.l) || !Number.isInteger(msg.s)) return;
        const seat = at.room.seats[at.slot];
        msg.l.slice(0, MAX_QUEUE).forEach((packed, k) => {
          const seq = msg.s + k;
          if (seq > seat.ack && !seat.queue.some((q) => q[0] === seq)) seat.queue.push([seq, unpackIntent(packed)]);
        });
        // Trop d'avance (connexion qui a rattrapé d'un coup) : on garde les plus récentes
        if (seat.queue.length > MAX_QUEUE) seat.queue.splice(0, seat.queue.length - MAX_QUEUE);
        return;
      }
      case 'act': {
        const at = where.get(conn);
        if (!at || at.room.phase !== 'playing') return;
        at.room.seats[at.slot].action = { choice: msg.choice, shop: msg.shop };
        return;
      }
      case 'leave':
        leaveCurrent(conn);
        return;
      default:
    }
  }

  // Un pas de simulation d'une partie : une intention par joueur
  function stepRoom(room) {
    const intents = room.seats.map((seat) => {
      if (seat.left || !seat.conn) return {};
      const next = seat.queue.shift();
      if (next) {
        seat.ack = next[0];
        seat.last = next[1];
      }
      let intent = seat.last;
      if (seat.action) {
        intent = { ...intent, ...seat.action };
        seat.action = null;
      }
      return intent;
    });
    stepGame(room.state, intents);
    room.events.push(...room.state.events);
  }

  function sendState(room) {
    // Nouvel étage : le décor d'abord
    if (room.state.floorIndex !== room.floor) {
      room.floor = room.state.floorIndex;
      const fixed = fixedOf(room.state);
      for (const s of room.seats) if (s.conn) s.conn.send({ t: 'floor', fixed });
    }
    room.seats.forEach((s, i) => s.conn && s.conn.send(snapshot(room, i)));
    room.events = [];
  }

  return {
    // Message reçu d'une connexion (déjà décodé du JSON)
    message(conn, msg) {
      if (msg && typeof msg === 'object' && typeof msg.t === 'string') handlers(conn, msg);
    },
    // Connexion perdue : en salon, la place se libère ; en partie, le héros attend son retour
    disconnect(conn) {
      const at = where.get(conn);
      if (!at) return;
      if (at.room.phase === 'lobby') return leaveCurrent(conn);
      where.delete(conn);
      at.room.seats[at.slot].conn = null;
      at.room.emptySince = at.room.seats.some((s) => s.conn) ? undefined : now();
    },
    // À appeler souvent (toutes les quelques millisecondes) : fait avancer chaque partie
    // au rythme réel de 60 pas par seconde et envoie un instantané tous les 3 pas
    tick() {
      const t = now();
      for (const room of [...rooms.values()]) {
        if (room.phase === 'lobby') {
          if (t - room.since > (room.between ? BETWEEN_TTL : LOBBY_TTL)) closeRoom(room, 'Salon fermé (inactif).');
          continue;
        }
        if (!room.seats.some((s) => s.conn)) {
          room.emptySince ??= t;
          if (t - room.emptySince > EMPTY_TTL) closeRoom(room);
          continue;
        }
        room.emptySince = undefined;
        room.acc = Math.min(room.acc + (t - room.last) / 1000, MAX_CATCHUP * STEP);
        room.last = t;
        while (room.acc >= STEP) {
          room.acc -= STEP;
          stepRoom(room);
          // (compté par le salon : pendant l'écran de Charon, le temps du jeu est arrêté)
          if (++room.steps % SNAPSHOT_EVERY === 0) sendState(room);
          if (room.state.status === 'dead' || room.state.status === 'victory') {
            sendState(room);
            backToLobby(room);
            break;
          }
        }
      }
    },
    // Pour les tests et le suivi
    rooms,
    roomOf: (conn) => where.get(conn)?.room || null,
  };
}
