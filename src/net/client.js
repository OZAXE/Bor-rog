// Connexion du navigateur au serveur de jeu en ligne (étape 8d).
// Réveille d'abord le serveur (l'offre gratuite de Render s'endort après 15 min sans
// visite : jusqu'à une minute de réveil), puis ouvre la connexion WebSocket. En cas
// de coupure pendant une partie, retente automatiquement de revenir (jeton de retour).

const WAKE_TIMEOUT = 90_000;
const RETRY_EVERY = 2000;
const RETRY_FOR = 45_000; // au-delà, la partie est considérée comme perdue côté navigateur
const KEEPALIVE = 4 * 60_000; // visite régulière pendant la partie (le serveur ne s'endort pas)

// handlers : { onStatus(texte), onMessage(message), onLost() }
export function createSession(serverUrl, handlers) {
  const wsUrl = serverUrl.replace(/^http/, 'ws') + '/play';
  let ws = null;
  let closed = false;
  let room = null; // { code, token } : pour revenir après une coupure
  let inGame = false;
  let keepalive = 0;

  async function wake() {
    handlers.onStatus('Connexion au serveur… (jusqu’à une minute s’il dormait)');
    const r = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(WAKE_TIMEOUT) });
    if (!r.ok) throw new Error('serveur indisponible');
  }

  function open() {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(wsUrl);
      let opened = false;
      sock.onopen = () => {
        opened = true;
        ws = sock;
        resolve();
      };
      sock.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.t === 'lobby') room = { code: msg.code, token: msg.token };
        if (msg.t === 'start') inGame = true;
        handlers.onMessage(msg);
      };
      sock.onclose = () => {
        if (!opened) return reject(new Error('connexion refusée'));
        if (ws === sock) ws = null;
        if (!closed) lost();
      };
    });
  }

  // Coupure inattendue : en partie, on retente de revenir ; en salon, c'est fini
  async function lost() {
    if (!inGame || !room) {
      closed = true;
      handlers.onLost();
      return;
    }
    handlers.onStatus('Connexion perdue, nouvelle tentative…');
    const until = Date.now() + RETRY_FOR;
    while (!closed && Date.now() < until) {
      await new Promise((r) => setTimeout(r, RETRY_EVERY));
      try {
        await open();
        ws.send(JSON.stringify({ t: 'rejoin', ...room }));
        handlers.onStatus('');
        return;
      } catch {
        /* nouvel essai */
      }
    }
    if (!closed) {
      closed = true;
      handlers.onLost();
    }
  }

  const session = {
    async connect() {
      await wake();
      await open();
      handlers.onStatus('');
      keepalive = setInterval(() => fetch(`${serverUrl}/health`).catch(() => {}), KEEPALIVE);
    },
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    // Quitter volontairement (salon ou partie)
    leave() {
      session.send({ t: 'leave' });
      session.close();
    },
    close() {
      closed = true;
      inGame = false;
      clearInterval(keepalive);
      if (ws) ws.close();
      ws = null;
    },
    get code() {
      return room?.code || '';
    },
  };
  return session;
}
