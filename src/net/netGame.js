// Partie en ligne côté navigateur (étape 8d) : ce que le joueur VOIT pendant que le
// serveur fait tourner la vraie simulation. Pas de réseau ici (testable dans Node) :
// on reçoit les messages du serveur et on fournit les intentions à envoyer.
//
// Deux techniques classiques des jeux en ligne :
// - Interpolation : les autres (ennemis, allié, projectiles) sont affichés avec un
//   petit retard (~80 ms), entre deux instantanés reçus : le mouvement reste fluide
//   même si les messages arrivent irrégulièrement.
// - Prédiction : TON héros réagit tout de suite à tes commandes. Le navigateur rejoue
//   localement les mêmes règles de déplacement (updatePlayer) ; quand le serveur
//   répond, on repart de sa position officielle et on rejoue les commandes qu'il n'a
//   pas encore traitées. Un petit écart restant est lissé à l'écran.

import { stateFromSnapshot, packIntent } from './protocol.js';
import { updatePlayer } from '../systems/player.js';
import { sanitizeIntent } from '../systems/intent.js';
import { STEP } from '../systems/simulation.js';
import { isActive } from '../state/gameState.js';

const DELAY = 5; // retard d'affichage des autres, en pas (5 pas = 83 ms : un peu plus d'un intervalle d'instantané)
const SNAP_AWAY = 2; // écart (m) au-delà duquel la correction est immédiate (téléportation)
const SMOOTH = 12; // vitesse de résorption d'un petit écart de prédiction (par seconde)

// start : message { you, fixed, snap } ; send(message) : envoi au serveur
export function createNetGame(start, send) {
  const you = start.you;
  let fixed = start.fixed;
  const buffer = []; // instantanés à afficher : { n, snap, fixed }
  let renderN = start.snap.n - DELAY;
  let latest = start.snap; // dernier instantané reçu (pour la prédiction)
  let current = null; // { entry, state } affiché
  let previous = null;

  // Prédiction de mon héros
  let seq = 0;
  const history = []; // [seq, intention] pas encore confirmées par le serveur
  let outbox = []; // intentions à envoyer au prochain envoi
  let outFirst = 1;
  let hero = null; // mon héros prédit
  const prevHero = { x: 0, z: 0, facing: 0 };
  const offset = { x: 0, z: 0 }; // écart lissé entre l'ancienne et la nouvelle prédiction

  const eventQueue = []; // événements reçus pas encore rendus : { n, ev }

  function push(snap) {
    buffer.push({ n: snap.n, snap, fixed });
    eventQueue.push({ n: snap.n, ev: snap.ev || [] });
    latest = snap;
    reconcile();
  }

  // Petit état local pour rejouer mes commandes : le décor (avec les grilles), les héros et
  // les ennemis (pour la visée automatique). Une copie : rien de ce qui est affiché n'est touché.
  function miniState(snap) {
    const { ev, ...rest } = snap;
    return stateFromSnapshot(fixed, structuredClone({ ...rest, projectiles: [], pickups: [], hazards: [] }));
  }

  function reconcile() {
    const mine = latest.players[you];
    const before = hero ? { x: hero.x, z: hero.z } : null;
    const mini = miniState(latest);
    hero = mini.players[you];
    while (history.length && history[0][0] <= latest.ack) history.shift();
    // Héros à terre, partie arrêtée, écran de Charon : pas de prédiction, la position officielle
    if (latest.status !== 'playing' || !isActive(mine)) history.length = 0;
    for (const [, intent] of history) {
      mini.events = [];
      updatePlayer(mini, hero, intent, STEP);
    }
    hero.mini = mini;
    if (before) {
      const dx = before.x + offset.x - hero.x;
      const dz = before.z + offset.z - hero.z;
      // Petit écart : on le garde à l'écran et on le résorbe en douceur
      if (Math.hypot(dx, dz) < SNAP_AWAY) {
        offset.x = dx;
        offset.z = dz;
      } else offset.x = offset.z = 0;
    }
  }

  push(start.snap);
  Object.assign(prevHero, { x: hero.x, z: hero.z, facing: hero.facing });

  return {
    you,
    // Message reçu du serveur
    receive(msg) {
      if (msg.t === 'floor') fixed = msg.fixed;
      else if (msg.t === 'snap') push(msg);
    },
    // Un pas local (60 par seconde) : mon intention est prédite et mise en attente d'envoi
    localStep(rawIntent) {
      const intent = sanitizeIntent(rawIntent);
      seq++;
      if (!outbox.length) outFirst = seq;
      outbox.push(packIntent(intent));
      prevHero.x = hero.x;
      prevHero.z = hero.z;
      prevHero.facing = hero.facing;
      const mine = latest.players[you];
      if (latest.status === 'playing' && isActive(mine)) {
        history.push([seq, intent]);
        hero.mini.events = [];
        updatePlayer(hero.mini, hero, intent, STEP);
      }
    },
    // Envoi groupé des intentions de l'image (une ou deux par message)
    flush() {
      if (!outbox.length) return;
      send({ t: 'in', s: outFirst, l: outbox });
      outbox = [];
    },
    // Avance l'affichage des autres de dt secondes. Renvoie { state, previous, alpha,
    // events, changed } : changed quand on est passé à un nouvel instantané.
    advance(dt) {
      const newest = buffer[buffer.length - 1].n;
      renderN += dt / STEP;
      // Rattrapage doux vers « dernier reçu moins le retard » ; saut si trop loin (onglet en veille)
      const target = newest - DELAY;
      if (Math.abs(renderN - target) > 30) renderN = target;
      else renderN += (target - renderN) * Math.min(1, dt * 2);
      let events = [];
      let changed = false;
      while (buffer.length > 1 && buffer[0].n <= renderN && buffer[1].n <= renderN) {
        buffer.shift();
      }
      // Paire affichée : buffer[0] (passé) et buffer[1] (à venir)
      const a = buffer[0];
      const b = buffer[1] || a;
      // Les événements de tous les instantanés atteints (même ceux sautés en route)
      while (eventQueue.length && eventQueue[0].n <= b.n) events = events.concat(eventQueue.shift().ev);
      if (!current || current.entry !== b) {
        previous = current && current.entry === a ? current.state : stateFromSnapshot(a.fixed, a.snap);
        current = { entry: b, state: stateFromSnapshot(b.fixed, b.snap) };
        changed = true;
      }
      const alpha = b.n > a.n ? Math.max(0, Math.min(1, (renderN - a.n) / (b.n - a.n))) : 1;
      // L'écart de prédiction se résorbe
      const k = Math.exp(-SMOOTH * dt);
      offset.x *= k;
      offset.z *= k;
      return { state: current.state, previous, alpha, events, changed };
    },
    // Mon héros prédit (position lissée entre deux pas locaux)
    hero() {
      return hero;
    },
    heroView(alpha) {
      return {
        x: prevHero.x + (hero.x - prevHero.x) * alpha + offset.x,
        z: prevHero.z + (hero.z - prevHero.z) * alpha + offset.z,
        facing: hero.facing,
      };
    },
    // Pour les tests : intentions pas encore confirmées
    pending: () => history.length,
  };
}
