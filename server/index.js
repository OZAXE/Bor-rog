// Serveur de Bor-rog, hébergé sur Render (cf. render.yaml à la racine du dépôt).
// Comptes (pseudo + mot de passe), sauvegarde du profil en ligne, et parties à deux
// (WebSocket sur /play, cf. realtime.js et rooms.js). Les routes sont dans app.js, le stockage dans pgStore.js.
//
// Secrets : l'adresse de la base (DATABASE_URL) vient UNIQUEMENT des variables
// d'environnement de Render, jamais du code ni du dépôt.

import http from 'node:http';
import { createApp } from './app.js';
import { createPgStore } from './pgStore.js';
import { createMemoryStore } from './memoryStore.js';
import { attachRealtime } from './realtime.js';

const PORT = Number(process.env.PORT) || 10000;
// Le jeu est servi par GitHub Pages : seule cette origine peut appeler le serveur
// depuis un navigateur (plus localhost pour le développement)
const ORIGINS = ['https://ozaxe.github.io', 'http://localhost:5173', 'http://localhost:4173'];

// Sans base configurée (développement local), tout reste en mémoire
const pgStore = process.env.DATABASE_URL
  ? createPgStore(process.env.DATABASE_URL, { ssl: process.env.DATABASE_SSL !== 'off' })
  : null;
const store = pgStore || createMemoryStore();

// État de la base : 'ok', 'absente' (variable non configurée) ou 'erreur'
let ready = false;
async function prepare() {
  if (ready) return;
  await store.init();
  ready = true;
}
async function dbStatus() {
  if (!pgStore) return 'absente';
  try {
    await prepare(); // nouvel essai si la création des tables avait échoué au démarrage
    await pgStore.ping();
    return 'ok';
  } catch (err) {
    console.error('Base injoignable :', err.message);
    return 'erreur';
  }
}

try {
  await prepare();
} catch (err) {
  // On démarre quand même : /health dira « erreur » pour aider au diagnostic
  console.error('Création des tables impossible :', err.message);
}

const server = http.createServer(createApp({ store, origins: ORIGINS, dbStatus }));
// Jeu en ligne : connexions WebSocket sur /play (salons, simulation des parties)
const realtime = attachRealtime(server, { origins: ORIGINS });
server.listen(PORT, () => console.log(`Serveur Bor-rog prêt sur le port ${PORT}`));

// Arrêt propre quand Render redémarre ou endort le service
process.on('SIGTERM', () => {
  realtime.close();
  server.close(() => store.close().then(() => process.exit(0)));
});
