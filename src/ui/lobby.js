// Écran « Jouer à deux » (étape 8d) : créer un salon et donner son code à un ami, ou
// rejoindre un salon avec un code. Le créateur lance la descente quand l'ami est là.
// Le jeu lui-même (après le lancement) est géré par main.js et src/net/netGame.js.

import { createSession } from '../net/client.js';
import { CLASSES } from '../systems/classes.js';
import { joinLink } from '../net/protocol.js';
import qrcode from 'qrcode-generator';

// info() : { name, cls, meta } du joueur ; onStart(message start, session) : la partie commence
export function createLobby({ root, serverUrl, info, onStart, onOpen = () => {} }) {
  const el = (sel) => root.querySelector(sel);
  let session = null;
  let busy = false;
  let invitedCode = '';

  function status(text) {
    el('.lobby-status').textContent = text;
  }

  function show(view) {
    el('.lobby-choose').hidden = view !== 'choose';
    el('.lobby-room').hidden = view !== 'room';
  }

  function onMessage(msg) {
    if (msg.t === 'lobby') {
      show('room');
      el('.room-code').textContent = msg.code;
      // Invitation (QR code + lien) tant que la place est libre
      el('.room-invite').hidden = msg.players.length >= 2;
      if (msg.code !== invitedCode) {
        invitedCode = msg.code;
        el('.room-qr').innerHTML = qrSvg(joinLink(window.location.href, msg.code));
        el('.share-msg').textContent = '';
      }
      el('.room-players').innerHTML = msg.players
        .map((p, i) => `<li>${escapeHtml(p.name)} · ${CLASSES[p.cls]?.name || ''}${i === 0 ? ' (crée le salon)' : ''}</li>`)
        .join('');
      const two = msg.players.length >= 2;
      el('.btn-start-room').hidden = !msg.host;
      el('.btn-start-room').disabled = !two;
      status(
        two
          ? msg.host
            ? 'Ton allié est là : lance la descente quand vous êtes prêts.'
            : 'En attente du lancement par le créateur du salon…'
          : 'Donne ce code à ton allié pour qu’il te rejoigne.',
      );
    } else if (msg.t === 'error') {
      status(msg.message);
    } else if (msg.t === 'start') {
      root.classList.add('hidden');
      const s = session;
      session = null; // la partie prend la main sur la connexion
      onStart(msg, s);
    }
  }

  async function connect() {
    if (session) return session;
    const s = createSession(serverUrl, {
      // Une fois la partie lancée, les messages d'état (coupure, retour) vont au jeu
      onStatus: (t) => (s.statusHandler ? s.statusHandler(t) : status(t)),
      onMessage: (m) => s.handler(m),
      onLost: () => {
        if (session === s) {
          session = null;
          show('choose');
          status('Connexion au serveur perdue.');
        }
        s.lostHandler?.();
      },
    });
    s.handler = onMessage;
    await s.connect();
    session = s;
    return s;
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    try {
      const s = await connect();
      action(s);
    } catch {
      status('Serveur injoignable. Vérifie ta connexion et réessaie.');
      session = null;
    }
    busy = false;
  }

  el('.btn-create-room').addEventListener('click', () => run((s) => s.send({ t: 'create', ...info() })));
  const codeInput = el('.room-code-input');
  codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)));
  el('.lobby-join').addEventListener('submit', (e) => {
    e.preventDefault();
    if (codeInput.value.length !== 4) return status('Le code fait 4 lettres.');
    run((s) => s.send({ t: 'join', code: codeInput.value, ...info() }));
  });
  // Partager le lien : menu de partage du téléphone, sinon copie dans le presse-papiers
  el('.btn-share-room').addEventListener('click', async () => {
    const url = joinLink(window.location.href, invitedCode);
    const msg = el('.share-msg');
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Bor-rog', text: `Rejoins-moi dans les Enfers ! Salon ${invitedCode}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      msg.textContent = 'Lien copié.';
    } catch {
      msg.textContent = url; // partage annulé ou refusé : le lien reste visible
    }
  });
  el('.btn-start-room').addEventListener('click', () => session && session.send({ t: 'start' }));
  el('.btn-close-lobby').addEventListener('click', () => {
    if (session) session.leave();
    session = null;
    root.classList.add('hidden');
  });

  return {
    open() {
      show('choose');
      status('Joue à deux en ligne : l’un crée un salon, l’autre le rejoint avec son code.');
      codeInput.value = '';
      root.classList.remove('hidden');
      onOpen();
    },
    isOpen: () => !root.classList.contains('hidden'),
    // Arrivée par un lien d'invitation (QR code scanné) : on rejoint directement
    joinFromLink(code) {
      this.open();
      codeInput.value = code;
      run((s) => s.send({ t: 'join', code, ...info() }));
    },
  };
}

// QR code en SVG (net à toutes les tailles, sans image à charger)
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
