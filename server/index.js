// Serveur de Bor-rog, hébergé sur Render (cf. render.yaml à la racine du dépôt).
// Pour l'instant (étape 8b, premier pas) il ne fait qu'une chose : répondre sur
// /health pour vérifier que toute la chaîne fonctionne (Render démarre le serveur,
// le serveur joint la base Postgres de Neon). Les comptes, la sauvegarde en ligne
// et le multijoueur viendront s'y ajouter.
//
// Secrets : l'adresse de la base (DATABASE_URL) vient UNIQUEMENT des variables
// d'environnement de Render, jamais du code ni du dépôt.

import http from 'node:http';
import pg from 'pg';

const PORT = Number(process.env.PORT) || 10000;
// Le jeu est servi par GitHub Pages : seule cette origine peut appeler le serveur
// depuis un navigateur (plus localhost pour le développement)
const ALLOWED_ORIGINS = ['https://ozaxe.github.io', 'http://localhost:5173', 'http://localhost:4173'];

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: { rejectUnauthorized: true } })
  : null;

// État de la base : 'ok', 'absente' (variable non configurée) ou 'erreur'
async function databaseStatus() {
  if (!pool) return 'absente';
  try {
    await pool.query('select 1');
    return 'ok';
  } catch (err) {
    console.error('Base injoignable :', err.message);
    return 'erreur';
  }
}

function send(res, status, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    const db = await databaseStatus();
    // Render vérifie cette adresse : on répond 200 même si la base est absente,
    // pour pouvoir diagnostiquer (le détail est dans la réponse)
    send(res, 200, { ok: true, service: 'bor-rog', db }, origin);
    return;
  }
  send(res, 404, { ok: false, error: 'introuvable' }, origin);
});

server.listen(PORT, () => console.log(`Serveur Bor-rog prêt sur le port ${PORT}`));

// Arrêt propre quand Render redémarre ou endort le service
process.on('SIGTERM', () => {
  server.close(() => (pool ? pool.end() : Promise.resolve()).then(() => process.exit(0)));
});
