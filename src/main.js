import * as THREE from 'three';
import './style.css';
import { CONFIG } from './config.js';
import { DEVICE } from './core/device.js';
import { createRenderer, bindResize } from './core/renderer.js';
import { createFixedStep } from './core/fixedStep.js';
import { createIsoCamera } from './camera/isoCamera.js';
import { createGameState } from './state/gameState.js';
import { stepGame, STEP } from './systems/simulation.js';
import { EMPTY_INTENT } from './systems/intent.js';
import { createDungeonView, createDungeonResources } from './render/dungeonView.js';
import { createAtlasTexture, createHaloTexture, createToonGradient } from './render/textures.js';
import { createPlayerView } from './render/playerView.js';
import { createAllyBot } from './controls/allyBot.js';
import { createEnemyViews, createProjectileView } from './render/enemyViews.js';
import { createEffects } from './render/effects.js';
import { createGateView } from './render/gateView.js';
import { createLootView } from './render/lootView.js';
import { createHazardView } from './render/hazardView.js';
import { BOONS } from './systems/boons.js';
import { rerollCost, healCost } from './systems/descent.js';
import { classRules } from './systems/classes.js';
import { SIM } from './systems/simConfig.js';
import { ZONE_THEMES } from './render/zoneThemes.js';
import { zoneOf, FLOORS_PER_ZONE } from './dungeon/zones.js';
import { createInput } from './controls/input.js';
import { recordRun, metaOf, shadowsEarned, selectClass, characterOf, characterLevel } from './meta/profile.js';
import { loadProfile, saveProfile, saveRun, loadRunText, clearRun } from './ui/storage.js';
import { createAccount } from './ui/account.js';
import { serializeRun, parseRun, runSummary } from './state/savegame.js';
import { CLASSES, CLASS_IDS } from './systems/classes.js';
import { createThreshold } from './ui/threshold.js';
import { createLobby } from './ui/lobby.js';
import { createNetGame } from './net/netGame.js';
import { stateFromSnapshot, codeFromLink } from './net/protocol.js';

// ---------------------------------------------------------------------------
// Organisation :
//   contrôles -> intention -> simulation (state + systems, pure) -> rendu (render/)
// La simulation tourne à pas fixe (60 Hz) ; le rendu suit le rafraîchissement de
// l'écran et interpole entre deux pas pour rester fluide sur les écrans 90/120 Hz.
// La simulation signale ce qui s'est passé (coups, morts…) par des "événements"
// que le rendu transforme en effets visuels.
// ---------------------------------------------------------------------------

blockBrowserGestures();

// ---- Graine de la partie ----
// ?seed=xxx dans l'adresse permet de rejouer un donjon précis.
// Sinon on en tire une au hasard (ici Math.random est permis : on est hors simulation).
const params = new URLSearchParams(window.location.search);
const randomSeed = () => Math.floor(Math.random() * 1e9).toString(36);
let seed = params.get('seed') || randomSeed();

// ---- Profil (méta-progression, sauvegardé dans le navigateur) ----
// Objet conteneur : l'écran du Seuil et la boucle partagent le même profil
const profile = { current: loadProfile() };
// Chaque partie démarre avec les améliorations permanentes achetées au Seuil
// Co-op de test (étape 8c) : ?coop=bot ajoute un partenaire contrôlé par l'ordinateur.
// Il prend une autre classe que la tienne : ton personnage de cette classe (niveaux et talents).
const COOP_BOT = params.get('coop') === 'bot';
function botPlayer() {
  const cls = profile.current.cls === 'huntress' ? 'warrior' : 'huntress';
  return { meta: characterOf(profile.current, cls), cls };
}
const newState = (s) => {
  const me = { meta: metaOf(profile.current), cls: profile.current.cls };
  return createGameState(s, COOP_BOT ? { players: [me, botPlayer()] } : me);
};
// Le joueur de cet écran : le premier en local ; en ligne, la place donnée par le serveur
let myIndex = 0;
const me = () => state.players[myIndex];
const allyOf = () => state.players.find((p, i) => i !== myIndex);
let allyBot = createAllyBot(1);
// Partie en ligne (étape 8d) : null en solo. net = affichage et prédiction, session = connexion
let net = null;
let session = null;
// Mon héros tel qu'il faut le dessiner et viser : prédit en ligne, réel en local
const heroNow = () => (net ? net.hero() : me());

// ---- État ----
let state = newState(seed);

// ---- Rendu ----
const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.render.background);
const cam = createIsoCamera(CONFIG.camera);
bindResize(renderer, cam.resize);

// Éclairage peu coûteux : ambiance froide + une directionnelle + UNE lumière ponctuelle
// qui suit le héros (les flammes sont "peintes" dans les couleurs, cf. dungeonMesh)
const L = CONFIG.lights;
const ambient = new THREE.HemisphereLight(L.ambientSky, L.ambientGround, L.ambientIntensity);
scene.add(ambient);
const key = new THREE.DirectionalLight(L.keyColor, L.keyIntensity);
key.position.set(3, 10, 6);
scene.add(key);
const heroLight = new THREE.PointLight(
  CONFIG.heroLight.color,
  CONFIG.heroLight.intensity,
  CONFIG.heroLight.distance,
  1.6,
);
scene.add(heroLight);

// Textures dessinées par le code, créées une fois pour toute la partie
const textures = {
  halo: createHaloTexture(),
  toon: createToonGradient(),
};
// Ressources du décor par zone (atlas aux couleurs de la zone), créées à la première visite
const zoneResources = new Map();
let currentZone = null;
function resourcesFor(zoneId) {
  if (!zoneResources.has(zoneId)) {
    const theme = ZONE_THEMES[zoneId];
    zoneResources.set(zoneId, createDungeonResources({ ...textures, atlas: createAtlasTexture(theme.palette) }, theme));
  }
  return zoneResources.get(zoneId);
}
// Applique l'ambiance de la zone (fond, lumières) quand on en change
function applyZone() {
  const zone = zoneOf(state.floorIndex);
  if (zone.id === currentZone) return;
  currentZone = zone.id;
  const t = ZONE_THEMES[zone.id];
  scene.background.set(t.background);
  ambient.color.set(t.lights.sky);
  ambient.groundColor.set(t.lights.ground);
  ambient.intensity = t.lights.ambient;
  key.color.set(t.lights.key);
  key.intensity = t.lights.keyIntensity;
  heroLight.color.set(t.lights.hero);
}
const makeDungeonView = () => {
  applyZone();
  return createDungeonView(scene, state.dungeon, resourcesFor(zoneOf(state.floorIndex).id), cam.camera.quaternion);
};
let dungeonView = makeDungeonView();
let viewFloor = state.floorIndex;
const playerView = createPlayerView(scene, textures.toon);
// Co-op : le second héros, avec un anneau vert au sol pour le reconnaître
const allyView = createPlayerView(scene, textures.toon, { ring: 0x2fff86 });
const enemyViews = createEnemyViews(scene, textures.toon, cam.camera.quaternion);
const projectileView = createProjectileView(scene, textures.halo);
const effects = createEffects(scene, textures.halo);
const gateView = createGateView(scene, textures.halo);
const lootView = createLootView(scene, textures.toon, textures.halo);
const hazardView = createHazardView(scene, textures.halo);

// ---- Entrées ----
const input = createInput(canvas);

// Visée à la souris : on projette le pointeur sur le sol et on prend la direction
// héros -> point visé. Le plan doit être à la même hauteur que la position du héros
// (le sol), sinon un curseur posé sur le héros donnerait quand même une direction.
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
function aimFromMouse(px, py) {
  ndc.set((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, cam.camera);
  if (!raycaster.ray.intersectPlane(aimPlane, hit)) return null;
  const dx = hit.x - heroNow().x;
  const dz = hit.z - heroNow().z;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return null; // souris sur le héros : pas de direction fiable
  return { x: dx / len, y: -dz / len };
}

// ---- Interface ----
const $ = (id) => document.getElementById(id);
const startScreen = $('start-screen');
const startText = $('start-text');
const banner = $('floor-banner');
const healthFill = $('health-fill');
const healthText = $('health-text');
const hurtFlash = $('hurt-flash');
const deathScreen = $('death-screen');
let playing = false;
let started = false;

startText.innerHTML = DEVICE.isMobile
  ? 'Touche l’écran pour jouer<br><small>Pouce gauche : se déplacer · Boutons : frapper, esquiver</small>'
  : 'Clique pour jouer<br><small>ZQSD / WASD : se déplacer · Souris : viser · Clic : frapper · Espace : esquiver · Échap : pause</small>';

startScreen.addEventListener('click', (e) => {
  if (e.target.closest('button')) return; // bouton du Seuil
  if (savedRun) return; // une descente sauvegardée attend : choisir avec les boutons
  if (DEVICE.isMobile) enterFullscreen();
  setPlaying(true);
});
window.addEventListener('keydown', (e) => {
  if (threshold.isOpen()) return;
  if ((e.code === 'Escape' || e.code === 'KeyP') && state.status === 'playing' && started) setPlaying(!playing);
});
// Quitter l'onglet met le jeu en pause
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.status === 'playing' && !threshold.isOpen() && !net) setPlaying(false);
  if (document.hidden) autosave();
});

function setPlaying(value) {
  playing = value;
  // Avant la première partie : écran titre ; ensuite : menu de pause
  startScreen.classList.toggle('hidden', value || started);
  pauseScreen.classList.toggle('hidden', value || !started);
  if (!value && started) {
    showPauseInfo();
    autosave();
  }
  // Le bandeau "Étage 1" n'apparaît qu'au vrai début de la partie
  // (sinon il s'anime derrière l'écran titre et chevauche le titre)
  if (value && !started) {
    started = true;
    showFloor(true);
    startScreen.classList.add('hidden');
  }
  // L'accès au Seuil depuis l'écran titre n'existe qu'avant la première partie
  $('btn-open-threshold').hidden = started;
  loop.reset();
}

// ---- Pause ----
// Bouton visible en partie (PC et mobile), menu avec Reprendre / Abandonner
const pauseScreen = $('pause-screen');
const pauseBtn = $('btn-pause');
pauseBtn.addEventListener('click', () => {
  if (state.status === 'playing' && started) setPlaying(false);
});
$('btn-resume').addEventListener('click', () => setPlaying(true));
$('btn-pause-abandon').addEventListener('click', () => {
  const earned = shadowsEarned(state.shadows, profile.current);
  const what = net ? 'Quitter la partie en ligne' : 'Abandonner la descente';
  if (!window.confirm(`${what} ? Tu gardes les ${earned} Ombres déjà gagnées.`)) return;
  pauseScreen.classList.add('hidden');
  endOfRun();
  leaveOnline();
  openThreshold();
});
$('pause-help').innerHTML = DEVICE.isMobile
  ? '<small>Pouce gauche : se déplacer · Boutons : frapper, esquiver, capacité</small>'
  : '<small>ZQSD / WASD : se déplacer · Souris : viser · Clic : frapper · Espace : esquiver · E ou clic droit : capacité · Échap : pause</small>';
function showPauseInfo() {
  const zone = zoneOf(state.floorIndex);
  const earned = shadowsEarned(state.shadows, profile.current);
  $('pause-info').innerHTML =
    `Étage ${state.floorIndex + 1} · ${zone.name}<br>` +
    `${state.kills} ennemi${state.kills > 1 ? 's' : ''} vaincu${state.kills > 1 ? 's' : ''} · ${me().gold} oboles · ` +
    `<span class="earned">${earned} Ombres</span> à rapporter`;
}
// Le bouton pause n'apparaît qu'en pleine partie (pas sur les écrans de choix ou de fin)
function updatePauseButton() {
  pauseBtn.hidden = !(started && playing && state.status === 'playing' && !threshold.isOpen());
}

function showFloor(withBanner) {
  const zone = zoneOf(state.floorIndex);
  $('floor-label').textContent = `Étage ${state.floorIndex + 1} · ${zone.name}`;
  if (!withBanner) return;
  // Premier étage d'une zone : on annonce aussi la zone
  const firstOfZone = state.floorIndex % FLOORS_PER_ZONE === 0;
  showBanner(firstOfZone ? `${zone.name}` : `Étage ${state.floorIndex + 1}`);
}

function showBanner(text, kind = '') {
  banner.textContent = text;
  banner.className = kind;
  void banner.offsetWidth; // relance l'animation CSS
  banner.classList.add('show');
}

function showSeed() {
  $('start-seed').textContent = `Graine : ${seed}`;
  $('seed-label').textContent = `graine ${seed}`;
  // L'adresse affichée permet de partager / rejouer cette graine
  const url = new URL(window.location.href);
  url.searchParams.set('seed', seed);
  window.history.replaceState(null, '', url);
}

let lastBoonKey = '';
function updateHud() {
  const p = me();
  healthFill.style.width = `${(100 * p.hp) / p.maxHp}%`;
  healthText.textContent = `${p.hp} / ${p.maxHp}`;
  $('kills').textContent = `${state.kills} vaincu${state.kills > 1 ? 's' : ''}`;
  $('gold').textContent = `${me().gold} obole${me().gold > 1 ? 's' : ''}`;
  $('shadows').textContent = `${state.shadows} Ombre${state.shadows > 1 ? 's' : ''}`;
  // Co-op : vie de l'allié (ou son état), et mon propre compte à rebours si je suis à terre
  const a = allyOf();
  const allyEl = $('ally-hud');
  allyEl.hidden = !a;
  if (a) {
    const name = CLASSES[a.cls].name;
    allyEl.textContent = a.out
      ? `${name} · revient à l’étage suivant`
      : a.down > 0
        ? `${name} · à terre (${Math.ceil(a.down / 60)} s)`
        : `${name} · ${a.hp} / ${a.maxHp} PV`;
    allyEl.classList.toggle('danger', a.down > 0 || a.out);
  }
  const downEl = $('down-info');
  const mine = me();
  // Co-op chez Charon : mon choix est fait, l'allié choisit encore
  const waiting = state.status === 'choosing' && !mine.offer && started;
  downEl.classList.toggle('on', (state.status === 'playing' && (mine.down > 0 || mine.out)) || waiting);
  if (waiting) downEl.textContent = 'Ton allié choisit son bienfait…';
  else if (mine.down > 0) downEl.textContent = `À terre · ${Math.ceil(mine.down / 60)} s pour être relevé`;
  else if (mine.out) downEl.textContent = 'Tu reviendras à l’étage suivant';
  const boonKey = JSON.stringify(p.boons);
  if (boonKey !== lastBoonKey) {
    lastBoonKey = boonKey;
    $('boon-list').innerHTML = Object.entries(p.boons)
      .map(([id, n]) => `<span>${BOONS[id].name}${n > 1 ? ` ×${n}` : ''}</span>`)
      .join('');
  }
  // Boss : barre de vie en haut de l'écran, dès que le combat commence
  const boss = state.enemies.find((e) => e.boss);
  const bossBar = $('boss-bar');
  if (boss && boss.alert && state.status === 'playing') {
    bossBar.classList.remove('hidden');
    $('boss-name').textContent = SIM.bosses[boss.type].name;
    $('boss-fill').style.width = `${(100 * Math.max(0, boss.hp)) / boss.maxHp}%`;
  } else bossBar.classList.add('hidden');
  // Salle verrouillée : nombre d'ennemis encore à vaincre
  const lockEl = $('lock-info');
  // Pendant un combat de boss, la barre du boss suffit (le compteur ferait doublon)
  if (state.lock && state.status === 'playing' && !(boss && boss.alert)) {
    const alive = new Set(state.enemies.map((e) => e.id));
    const left = state.lock.enemyIds.filter((id) => alive.has(id)).length;
    lockEl.textContent = `Salle scellée · ${left} ennemi${left > 1 ? 's' : ''}`;
    lockEl.classList.add('on');
  } else lockEl.classList.remove('on');
}

// ---- Écran de Charon (choix d'un bienfait) ----
// Les clics ne modifient pas l'état directement : ils deviennent une intention,
// envoyée à la simulation au pas suivant (comme le reste des contrôles)
let pendingAction = null;
let charonKey = '';
const charon = $('charon');
function updateCharon() {
  // Seulement en cours de partie (avec le Pacte, l'état démarre en choix dès sa création)
  // (en co-op, une fois mon choix fait, l'écran se ferme en attendant l'allié)
  const open = state.status === 'choosing' && !!me().offer && started && !threshold.isOpen();
  charon.classList.toggle('hidden', !open);
  if (!open) {
    charonKey = '';
    return;
  }
  const key = JSON.stringify([me().offer.boons, me().offer.rerolls, me().offer.free, me().gold, me().hp]);
  if (key === charonKey) return;
  charonKey = key;
  // Pacte de Charon : choix d'un bienfait au départ, sans descendre
  const pact = !!me().offer.start;
  $('charon-title').textContent = pact ? 'Pacte de Charon' : 'Charon, le passeur';
  $('charon-hint').textContent = pact ? 'Choisis le bienfait qui t\'accompagnera' : 'Choisis un bienfait des dieux pour descendre';
  const cards = $('boon-cards');
  cards.innerHTML = '';
  me().offer.boons.forEach((id, i) => {
    const b = BOONS[id];
    const lvl = me().boons[id] || 0;
    const btn = document.createElement('button');
    btn.className = 'boon-card';
    btn.type = 'button';
    btn.innerHTML = `<b>${b.name}</b><span>${b.text}</span><small>${lvl ? `niveau ${lvl} → ${lvl + 1}` : 'nouveau'}${DEVICE.isMobile ? '' : ` · touche ${i + 1}`}</small>`;
    btn.addEventListener('click', () => act({ choice: i }));
    cards.appendChild(btn);
  });
  if (!me().offer.boons.length) {
    const btn = document.createElement('button');
    btn.className = 'boon-card';
    btn.type = 'button';
    btn.innerHTML = '<b>Descendre</b><span>Les dieux n\'ont plus rien à t\'offrir</span>';
    btn.addEventListener('click', () => act({ choice: 0 }));
    cards.appendChild(btn);
  }
  const p = me();
  const heal = $('btn-heal');
  heal.textContent = `Se soigner +${SIM.loot.healAmount} PV · ${healCost(me())} oboles`;
  heal.disabled = me().gold < healCost(me()) || p.hp >= p.maxHp;
  const reroll = $('btn-reroll');
  reroll.textContent = `Autres bienfaits · ${rerollCost(me())} oboles`;
  reroll.disabled = me().gold < rerollCost(me());
  $('charon-gold').textContent = `${me().gold} oboles · ${p.hp} / ${p.maxHp} PV`;
}
// Un choix chez Charon : intention du prochain pas en local, message au serveur en ligne
function act(action) {
  if (net) session.send({ t: 'act', ...action });
  else pendingAction = action;
}
$('btn-heal').addEventListener('click', () => act({ shop: 'heal' }));
$('btn-reroll').addEventListener('click', () => act({ shop: 'reroll' }));
window.addEventListener('keydown', (e) => {
  if (state.status !== 'choosing') return;
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'].indexOf(e.code);
  if (!me().offer) return;
  if (n >= 0) act({ choice: n % 4 });
  if (e.code === 'KeyH') act({ shop: 'heal' });
  if (e.code === 'KeyR') act({ shop: 'reroll' });
});

// ---- Mort et nouvelle partie ----
let deathTimer = 0;
function showDeath() {
  const n = state.floorIndex + 1;
  $('death-text').innerHTML =
    `Étage ${n} · ${state.kills} ennemi${state.kills > 1 ? 's' : ''} vaincu${state.kills > 1 ? 's' : ''} · ${me().gold} oboles<br>` +
    `<span class="earned">+${lastEarned} Ombres</span><br>` +
    `${Object.keys(me().boons).length ? `Bienfaits : ${Object.entries(me().boons).map(([id, k]) => BOONS[id].name + (k > 1 ? ` ×${k}` : '')).join(', ')}<br>` : ''}` +
    `<small>Graine ${seed}</small>`;
  deathScreen.classList.remove('hidden');
}
const victoryScreen = $('victory-screen');
function showVictory() {
  const secs = Math.floor(state.tick / SIM.tickRate);
  const time = `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')} s`;
  const boons = Object.entries(me().boons)
    .map(([id, k]) => BOONS[id].name + (k > 1 ? ` ×${k}` : ''))
    .join(', ');
  $('victory-text').innerHTML =
    `Descente en ${time} · ${state.kills} ennemis vaincus · ${me().gold} oboles<br>` +
    `<span class="earned">+${lastEarned} Ombres</span><br>` +
    (boons ? `Bienfaits : ${boons}<br>` : '') +
    `<small>Graine ${seed}</small>`;
  victoryScreen.classList.remove('hidden');
}

// ---- Fin de partie et Seuil ----
// Les Ombres sont encaissées dès la fin de la partie (mort, victoire ou abandon)
// et sauvegardées aussitôt : fermer l'onglet ensuite ne fait rien perdre.
let recorded = false;
let lastEarned = 0;
function endOfRun() {
  if (recorded) return;
  recorded = true;
  clearRun(); // la descente est finie : plus rien à reprendre
  lastEarned = recordRun(profile.current, state);
  storeProfile();
  // Partie en ligne finie : le serveur ferme le salon ; on se déconnecte
  if (net && state.status !== 'playing' && state.status !== 'choosing') leaveOnline();
}
const threshold = createThreshold({
  root: $('threshold'),
  profile,
  onChange: () => storeProfile(),
  onDescend: (sameSeed) => {
    threshold.close();
    restart(sameSeed ? seed : randomSeed());
    setPlaying(true);
  },
});
// ---- Compte en ligne (étape 8b) ----
// Le profil est toujours enregistré dans le navigateur, puis envoyé au serveur si le
// joueur est connecté. Une question (deux progressions différentes) n'interrompt
// jamais une partie : elle attend un moment calme (Seuil, pause, écran de fin).
const account = createAccount({
  root: $('threshold'),
  conflictRoot: $('cloud-conflict'),
  serverUrl: params.get('server') || CONFIG.server.url,
  profile,
  save: () => saveProfile(profile.current),
  onReplaced: () => threshold.refresh(),
  canPrompt: () => !(playing && (state.status === 'playing' || state.status === 'choosing')),
});
function storeProfile() {
  saveProfile(profile.current);
  account.changed();
}
account.start();

// ---- Jouer à deux en ligne (étape 8d) ----
// Le serveur fait tourner la partie ; ce navigateur envoie mes commandes et affiche
// ce que le serveur renvoie (cf. src/net/netGame.js). Pas de pause en ligne : le menu
// s'affiche mais la partie continue pour l'allié.
const lobby = createLobby({
  root: $('lobby'),
  serverUrl: params.get('server') || CONFIG.server.url,
  // Pseudo du compte s'il y en a un (sinon « Invité », cf. cleanPlayerName)
  info: () => ({ name: account.name(), cls: profile.current.cls, meta: metaOf(profile.current) }),
  onStart: startOnline,
});
function openLobby() {
  startScreen.classList.add('hidden');
  threshold.close();
  lobby.open();
}
$('btn-online').addEventListener('click', openLobby);

// ---- Choix de la classe sur l'écran titre ----
// Toutes les classes sont jouables dès le départ ; chacune garde son build de talents.
// Avant la première descente, changer de classe recrée le héros de la partie qui attend.
const startClasses = $('start-classes');
const startCards = new Map();
for (const id of CLASS_IDS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `class-card class-${id}`;
  b.innerHTML = `<b>${CLASSES[id].name}</b><span>${CLASSES[id].weaponName}</span><small>${CLASSES[id].text}</small>`;
  b.addEventListener('click', () => {
    if (selectClass(profile.current, id)) storeProfile();
    if (!started && !net) adoptState(newState(seed));
    renderStartClasses();
  });
  startClasses.appendChild(b);
  startCards.set(id, b);
}
function renderStartClasses() {
  for (const [id, b] of startCards) {
    b.classList.toggle('on', id === profile.current.cls);
    // Chaque classe est un personnage qu'on fait progresser : son niveau est affiché
    b.querySelector('span').textContent = `Niveau ${characterLevel(profile.current, id) + 1} · ${CLASSES[id].weaponName}`;
  }
}
renderStartClasses();
// Lien d'invitation (?join=CODE, QR code scanné) : on rejoint le salon tout de suite.
// Le paramètre est retiré de l'adresse pour qu'un rechargement ne rejoigne pas à nouveau.
const invitedTo = codeFromLink(window.location.search);
if (invitedTo) {
  const url = new URL(window.location.href);
  url.searchParams.delete('join');
  window.history.replaceState(null, '', url);
  startScreen.classList.add('hidden');
  lobby.joinFromLink(invitedTo);
}
$('threshold').querySelector('.btn-online').addEventListener('click', openLobby);
$('lobby').querySelector('.btn-close-lobby').addEventListener('click', () => {
  // Retour : au Seuil après une partie, sinon à l'écran titre
  if (started) openThreshold();
  else startScreen.classList.remove('hidden');
});

function startOnline(start, s) {
  abandonSavedRun();
  clearRun();
  session = s;
  session.handler = onlineMessage;
  session.statusHandler = (text) => text && showBanner(text, 'danger');
  session.lostHandler = () => {
    if (!net) return;
    showBanner('Connexion perdue', 'danger');
    endOfRun();
    leaveOnline();
    openThreshold();
  };
  myIndex = start.you;
  net = createNetGame(start, (msg) => session.send(msg));
  $('btn-retry').hidden = true; // « même graine » n'a pas de sens pour une partie en ligne
  threshold.close();
  adoptState(stateFromSnapshot(start.fixed, start.snap));
  if (DEVICE.isMobile) enterFullscreen();
  setPlaying(true);
}

function onlineMessage(msg) {
  if (!net) return;
  if (msg.t === 'start') {
    // Retour après une coupure : on reprend l'affichage depuis l'état actuel du serveur
    net = createNetGame(msg, (m) => session.send(m));
    showBanner('De retour dans la partie', 'calm');
    return;
  }
  if (msg.t === 'left') showBanner(msg.name === 'Invité' ? 'Ton allié a quitté la partie' : `${msg.name} a quitté la partie`, 'danger');
  else if (msg.t === 'error') showBanner(msg.message, 'danger');
  else net.receive(msg);
}

function leaveOnline() {
  if (session) session.leave();
  session = null;
  net = null;
}

function openThreshold() {
  deathScreen.classList.add('hidden');
  victoryScreen.classList.add('hidden');
  startScreen.classList.add('hidden');
  threshold.open(recorded ? lastEarned : 0);
}
$('btn-open-threshold').addEventListener('click', openThreshold);
$('btn-death-threshold').addEventListener('click', openThreshold);
$('btn-victory-threshold').addEventListener('click', openThreshold);

function restart(newSeed) {
  abandonSavedRun();
  clearRun();
  leaveOnline();
  myIndex = 0;
  $('btn-retry').hidden = false;
  adoptState(newState(newSeed));
}

// Installe un état de partie (nouvelle descente ou descente reprise) et remet l'affichage à zéro
function adoptState(next) {
  seed = next.seed;
  state = next;
  recorded = false;
  lastEarned = 0;
  window.__game.state = state;
  deathScreen.classList.add('hidden');
  victoryScreen.classList.add('hidden');
  prev.x = heroNow().x;
  prev.z = heroNow().z;
  prev.facing = heroNow().facing;
  const ally = allyOf();
  if (ally) Object.assign(prevAlly, { x: ally.x, z: ally.z, facing: ally.facing });
  allyBot = createAllyBot(1);
  prevEnemies.clear();
  gateView.reset();
  pendingAction = null;
  showSeed();
  rebuildFloor();
  updateHud();
  loop.reset();
  deathTimer = 0;
}
$('btn-retry').addEventListener('click', () => restart(seed));
$('btn-victory-new').addEventListener('click', () => restart(randomSeed()));
$('btn-new').addEventListener('click', () => restart(randomSeed()));

// ---- Reprise d'une descente (étape 8a) ----
// La partie est sauvegardée en continu ; à l'ouverture de la page, l'écran titre
// propose de la reprendre. En commencer une autre compte comme un abandon (les
// Ombres de la descente interrompue sont encaissées, rien n'est perdu).
let savedRun = parseRun(loadRunText());
let autosaveTimer = 0;
function autosave() {
  // Rien à sauvegarder avant la première partie ni après sa fin (mort, victoire, abandon),
  // ni en ligne (la partie vit sur le serveur)
  if (net || !started || recorded || (state.status !== 'playing' && state.status !== 'choosing')) return;
  saveRun(serializeRun(state));
}
function abandonSavedRun() {
  if (!savedRun) return;
  recordRun(profile.current, savedRun);
  storeProfile();
  savedRun = null;
  $('resume-run').hidden = true;
}
if (savedRun) {
  const r = runSummary(savedRun);
  $('resume-text').textContent = `Descente en cours${r.coop ? ' en duo' : ''} : étage ${r.floor} · ${CLASSES[r.cls].name} · ${r.hp} / ${r.maxHp} PV`;
  $('resume-run').hidden = false;
  startText.innerHTML = '';
  $('start-seed').hidden = true; // graine de la partie neuve : sans objet tant que le choix n'est pas fait
}
$('btn-resume-run').addEventListener('click', () => {
  const run = savedRun;
  savedRun = null;
  $('resume-run').hidden = true;
  if (DEVICE.isMobile) enterFullscreen();
  adoptState(run);
  setPlaying(true);
});
$('btn-new-run').addEventListener('click', () => {
  if (DEVICE.isMobile) enterFullscreen();
  restart(randomSeed());
  setPlaying(true);
});
// Fermer ou quitter la page : dernière sauvegarde
window.addEventListener('pagehide', autosave);

function rebuildFloor() {
  dungeonView.dispose();
  dungeonView = makeDungeonView();
  viewFloor = state.floorIndex;
  showFloor(true);
}

// ---- Boucle de jeu ----
const loop = createFixedStep(STEP);
const timer = new THREE.Timer();
// Positions au pas précédent, pour l'interpolation visuelle
const prev = { x: me().x, z: me().z, facing: me().facing };
const prevAlly = { x: 0, z: 0, facing: 0 }; // co-op : position de l'allié au pas précédent
const prevEnemies = new Map(); // id -> { x, z }
const enemyPos = new Map(); // id -> position interpolée
let hurtTimeout = 0;

function tick() {
  prev.x = me().x;
  prev.z = me().z;
  prev.facing = me().facing;
  const ally = allyOf();
  if (ally) Object.assign(prevAlly, { x: ally.x, z: ally.z, facing: ally.facing });
  for (const e of state.enemies) prevEnemies.set(e.id, { x: e.x, z: e.z });
  let intent = EMPTY_INTENT;
  if (state.status === 'choosing') {
    intent = pendingAction || EMPTY_INTENT;
    pendingAction = null;
  } else if (playing) intent = input.getIntent(cam.screenToWorld, aimFromMouse);
  stepGame(state, state.players.length > 1 ? [intent, allyBot(state)] : intent);
  handleEvents(state.events);
}

// En ligne : un pas local = mon intention, prédite tout de suite et envoyée au serveur
function netTick() {
  prev.x = net.hero().x;
  prev.z = net.hero().z;
  prev.facing = net.hero().facing;
  const intent = playing && state.status === 'playing' ? input.getIntent(cam.screenToWorld, aimFromMouse) : EMPTY_INTENT;
  net.localStep(intent);
}

// Effets, bandeaux et flash à partir des événements de la simulation
function handleEvents(events) {
  for (const ev of events) {
    effects.handle(ev);
    if (ev.type === 'roomLocked') {
      const boss = state.enemies.find((e) => e.boss);
      showBanner(boss ? SIM.bosses[boss.type].name.split(',')[0] : 'Salle scellée', 'danger');
    }
    if (ev.type === 'bossDefeated') {
      const name = SIM.bosses[ev.bossType].name.split(',')[0];
      showBanner(`${name} ${ev.bossType === 'hydra' ? 'est vaincue' : 'est vaincu'}`, 'calm');
    }
    // Arène de boss purifiée : on garde le bandeau de victoire affiché juste avant
    if (ev.type === 'roomCleared' && state.dungeon.rooms.find((r) => r.id === ev.roomId)?.type !== 'boss') {
      showBanner('Salle purifiée', 'calm');
    }
    if (ev.type === 'defiance') showBanner('Défi de la Mort', 'calm');
    if (ev.type === 'stairsBlocked' && ev.player === myIndex) showBanner('Purifie la salle pour descendre', 'danger');
    if (ev.type === 'playerDown') showBanner(ev.player === myIndex ? 'À terre ! Ton allié peut te relever' : 'Ton allié est à terre : va le relever', 'danger');
    if (ev.type === 'playerRevived') showBanner(ev.player === myIndex ? 'Relevé !' : 'Allié relevé', 'calm');
    if (ev.type === 'playerOut') showBanner(ev.player === myIndex ? 'Tu reviendras à l’étage suivant' : 'Ton allié reviendra à l’étage suivant', 'danger');
    // Le flash rouge ne concerne que mon héros
    if (ev.type === 'playerHurt' && ev.player === myIndex) {
      hurtFlash.classList.add('on');
      clearTimeout(hurtTimeout);
      hurtTimeout = setTimeout(() => hurtFlash.classList.remove('on'), 90);
    }
  }
}

// Compteur d'images par seconde (affichage de mise au point)
const debugEl = $('debug');
let fpsFrames = 0;
let fpsTime = 0;

function frame(timestamp) {
  requestAnimationFrame(frame);
  timer.update(timestamp);
  const dt = timer.getDelta();
  const time = timer.getElapsed();

  let alpha;
  let heroAlpha;
  if (net) {
    // En ligne : mon héros avance au pas local (prédit), le reste suit les instantanés du serveur
    heroAlpha = loop.advance(dt, netTick);
    net.flush();
    const v = net.advance(dt);
    if (v.changed) {
      for (const e of v.previous.enemies) prevEnemies.set(e.id, { x: e.x, z: e.z });
      const pa = v.previous.players.find((q, i) => i !== myIndex);
      if (pa) Object.assign(prevAlly, { x: pa.x, z: pa.z, facing: pa.facing });
      state = v.state;
      window.__game.state = state;
    }
    handleEvents(v.events);
    alpha = v.alpha;
  } else {
    alpha = playing && state.status !== 'dead' ? loop.advance(dt, tick) : 1;
    heroAlpha = alpha;
  }
  // Question du compte en attente (deux progressions) : affichée dès que la partie le permet
  account.showPending();
  // Sauvegarde automatique de la descente toutes les 3 secondes de jeu
  if (playing && (autosaveTimer += dt) > 3) {
    autosaveTimer = 0;
    autosave();
  }

  // Changement d'étage : on reconstruit le décor et on n'interpole pas (téléportation)
  if (state.floorIndex !== viewFloor) {
    rebuildFloor();
    gateView.reset();
    prev.x = heroNow().x;
    prev.z = heroNow().z;
    const ally = allyOf();
    if (ally) Object.assign(prevAlly, { x: ally.x, z: ally.z });
    prevEnemies.clear();
  }

  const p = me();
  const h = heroNow(); // position, vitesse et esquive : prédites en ligne
  let x = prev.x + (h.x - prev.x) * heroAlpha;
  let z = prev.z + (h.z - prev.z) * heroAlpha;
  if (net) ({ x, z } = net.heroView(heroAlpha));
  const facing = lerpAngle(prev.facing, h.facing, heroAlpha);
  playerView.setClass(p.cls);
  setAttackLabel(p.cls);
  updateSpecial();
  updatePauseButton();
  playerView.update(x, z, facing, Math.hypot(h.vx, h.vz), time, {
    blink: p.invuln > 0 && h.dashTimer === 0 && p.down === 0 && state.status === 'playing',
    dashing: h.dashTimer > 0,
    down: p.down > 0,
    hidden: p.out,
  });
  // Co-op : l'allié
  const a = allyOf();
  if (a) {
    allyView.setClass(a.cls);
    allyView.update(
      prevAlly.x + (a.x - prevAlly.x) * alpha,
      prevAlly.z + (a.z - prevAlly.z) * alpha,
      lerpAngle(prevAlly.facing, a.facing, alpha),
      Math.hypot(a.vx, a.vz),
      time,
      { blink: a.invuln > 0 && a.dashTimer === 0 && a.down === 0, dashing: a.dashTimer > 0, down: a.down > 0, hidden: a.out },
    );
  } else allyView.update(0, 0, 0, 0, time, { hidden: true });
  heroLight.position.set(x, CONFIG.heroLight.height, z);

  enemyPos.clear();
  for (const e of state.enemies) {
    const pe = prevEnemies.get(e.id) || e;
    enemyPos.set(e.id, { x: pe.x + (e.x - pe.x) * alpha, z: pe.z + (e.z - pe.z) * alpha });
  }
  enemyViews.update(state.enemies, enemyPos, time);
  projectileView.update(state.projectiles, 1 - alpha, STEP, cam.camera.quaternion, time);
  effects.update(dt);
  gateView.update(state, dt, time);
  lootView.update(state, time, dt);
  hazardView.update(state, time);
  updateCharon();

  const shake = effects.shakeOffset();
  cam.follow(x + shake.x, z + shake.z);
  dungeonView.update(time);
  updateHud();

  // Mort ou victoire : on laisse un instant pour voir la scène avant l'écran de fin
  if (state.status === 'dead' || state.status === 'victory') {
    endOfRun();
    deathTimer += dt;
    const waiting = !threshold.isOpen(); // écran de fin pas encore quitté pour le Seuil
    if (state.status === 'dead' && waiting && deathTimer > 1 && deathScreen.classList.contains('hidden')) showDeath();
    if (state.status === 'victory' && waiting && deathTimer > 2 && victoryScreen.classList.contains('hidden')) showVictory();
  }

  renderer.render(scene, cam.camera);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    debugEl.textContent = `${Math.round(fpsFrames / fpsTime)} ips · tick ${state.tick}`;
    fpsFrames = 0;
    fpsTime = 0;
  }
}

showSeed();
showFloor(false);
updateHud();
requestAnimationFrame(frame);

// Capacité spéciale : nom selon la classe, recharge affichée (bouton tactile et jauge PC)
const SPECIAL_NAMES = { whirl: 'Tourbillon', volley: 'Volée', nova: 'Nova' };
const specialBtn = $('btn-special');
const specialHud = $('special-hud');
let specialKey = '';
function updateSpecial() {
  const p = me();
  const sp = classRules(p.cls).special;
  const name = SPECIAL_NAMES[sp.id];
  const total = Math.round(sp.cooldown * SIM.tickRate);
  const charge = 1 - p.specialCooldown / total;
  const ready = p.specialCooldown === 0;
  const key = `${name}|${Math.round(charge * 40)}|${ready}`;
  if (key === specialKey) return;
  specialKey = key;
  specialBtn.textContent = name;
  specialBtn.style.setProperty('--charge', charge.toFixed(3));
  specialBtn.classList.toggle('ready', ready);
  specialHud.querySelector('.name').textContent = `E · ${name}`;
  specialHud.querySelector('.fill').style.width = `${Math.round(charge * 100)}%`;
  specialHud.classList.toggle('ready', ready);
}

// Bouton d'attaque tactile : son nom suit l'arme de la classe
const ATTACK_LABELS = { warrior: 'Frapper', huntress: 'Tirer', mystic: 'Lancer' };
let attackLabel = '';
function setAttackLabel(cls) {
  const label = ATTACK_LABELS[cls] || 'Frapper';
  if (label === attackLabel) return;
  attackLabel = label;
  $('btn-attack').textContent = label;
}

// Interpolation d'angle par le plus court chemin (évite un tour complet entre -π et π)
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---- Utilitaires navigateur ----
// Bloque les gestes du navigateur (défilement, pinch-zoom iOS, double-tap, menu contextuel)
function blockBrowserGestures() {
  const prevent = (e) => e.preventDefault();
  // Les écrans à faire défiler (Seuil, Charon, salon en ligne) gardent le défilement au doigt
  document.addEventListener('touchmove', (e) => !e.target.closest?.('#threshold, #charon, #lobby') && e.preventDefault(), {
    passive: false,
  });
  document.addEventListener('gesturestart', prevent);
  // Les champs (code de sauvegarde, compte) gardent la sélection et le menu "Coller" (appui long)
  const outsideField = (e) => !e.target.closest?.('textarea, input') && e.preventDefault();
  document.addEventListener('dblclick', outsideField);
  document.addEventListener('contextmenu', outsideField);
}

// Plein écran + paysage sur Android (iOS Safari ne le permet pas sur iPhone, on ignore l'erreur)
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

// Accès de mise au point depuis la console du navigateur (et pour les tests visuels)
window.__game = { seed, state, CONFIG, scene, cam, renderer };
