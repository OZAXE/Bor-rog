// Connexions temps réel (WebSocket) du jeu en ligne : branchées sur le serveur HTTP
// à l'adresse /play. Toute la logique des salons est dans rooms.js ; ici, on ne fait
// que décoder, filtrer et relayer les messages.

import { WebSocketServer } from 'ws';
import { createRooms } from './rooms.js';
import { encode } from '../src/net/protocol.js';

const MAX_MESSAGE = 16 * 1024; // un message de joueur fait quelques centaines d'octets
const MAX_PER_SECOND = 120; // au-delà, les messages sont ignorés (client qui s'emballe)

export function attachRealtime(httpServer, { origins = [], rooms = createRooms(), tickMs = 4 } = {}) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/play',
    maxPayload: MAX_MESSAGE,
    // Compression : les instantanés successifs se ressemblent, ils se compressent très bien
    perMessageDeflate: { threshold: 256 },
    // Seul le site du jeu peut ouvrir une connexion depuis un navigateur
    verifyClient: ({ origin }) => !origin || origins.includes(origin),
  });

  wss.on('connection', (ws) => {
    let count = 0;
    let windowStart = Date.now();
    const conn = {
      send(msg) {
        if (ws.readyState === ws.OPEN) ws.send(encode(msg));
      },
    };
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (data) => {
      const t = Date.now();
      if (t - windowStart > 1000) {
        windowStart = t;
        count = 0;
      }
      if (++count > MAX_PER_SECOND) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      try {
        rooms.message(conn, msg);
      } catch (err) {
        console.error('Erreur de salon :', err);
      }
    });
    ws.on('close', () => rooms.disconnect(conn));
    ws.on('error', () => ws.terminate());
  });

  // Boucle des parties : toutes les quelques millisecondes, chaque partie rattrape le temps réel
  const loop = setInterval(() => {
    try {
      rooms.tick();
    } catch (err) {
      console.error('Erreur de boucle :', err);
    }
  }, tickMs);
  // Connexions mortes (téléphone en veille, réseau coupé) : détectées par un ping toutes les 20 s
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 20e3);

  return {
    wss,
    rooms,
    close() {
      clearInterval(loop);
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
