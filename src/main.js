import * as THREE from 'three';
import './style.css';
import { CONFIG } from './config.js';
import { DEVICE } from './core/device.js';
import { createRenderer, bindResize } from './core/renderer.js';
import { createFixedStep } from './core/fixedStep.js';
import { createTopDownCamera } from './camera/topDownCamera.js';
import { createPreviewRoom } from './render/previewRoom.js';

// ---------------------------------------------------------------------------
// Organisation (cible) :
//   état (state/) -> simulation pure (systems/, dungeon/) -> rendu (render/)
//   contrôles (controls/) -> "intention" -> simulation
// Étape 1 (socle) : chaîne de rendu, boucle à pas fixe, écran titre et graine.
// ---------------------------------------------------------------------------

blockBrowserGestures();

// ---- Graine de la partie ----
// ?seed=xxx dans l'adresse permet de rejouer un donjon précis.
// Sinon on en tire une au hasard (ici Math.random est permis : on est hors simulation).
const params = new URLSearchParams(window.location.search);
const seed = params.get('seed') || Math.floor(Math.random() * 1e9).toString(36);

// ---- Rendu ----
const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.render.background);
const cam = createTopDownCamera(CONFIG.camera);
bindResize(renderer, cam.camera);
const room = createPreviewRoom(scene);
cam.follow(0, 0);

// ---- Écran titre / pause ----
const startScreen = document.getElementById('start-screen');
const startText = document.getElementById('start-text');
document.getElementById('start-seed').textContent = `Graine : ${seed}`;
document.getElementById('seed-label').textContent = `graine ${seed}`;
let playing = false;

startText.innerHTML = DEVICE.isMobile
  ? 'Touche l’écran pour jouer'
  : 'Clique pour jouer<br><small>Échap : pause</small>';

startScreen.addEventListener('click', () => {
  if (DEVICE.isMobile) enterFullscreen();
  setPlaying(true);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') setPlaying(!playing);
});
// Quitter l'onglet met le jeu en pause
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPlaying(false);
});

function setPlaying(value) {
  playing = value;
  startScreen.classList.toggle('hidden', value);
  if (!value) {
    startText.innerHTML = DEVICE.isMobile ? 'Touche pour reprendre' : 'Clique pour reprendre';
  }
  loop.reset();
}

// ---- Boucle de jeu ----
const loop = createFixedStep(1 / CONFIG.tickRate);
const timer = new THREE.Timer();
let tick = 0;

// Compteur d'images par seconde (affichage de mise au point)
const debugEl = document.getElementById('debug');
let fpsFrames = 0;
let fpsTime = 0;

function frame(timestamp) {
  requestAnimationFrame(frame);
  timer.update(timestamp);
  const dt = timer.getDelta();

  if (playing) {
    loop.advance(dt, () => {
      tick++; // la simulation viendra ici à l'étape 2
    });
  }

  room.update(timer.getElapsed());
  renderer.render(scene, cam.camera);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    debugEl.textContent = `${Math.round(fpsFrames / fpsTime)} ips · tick ${tick}`;
    fpsFrames = 0;
    fpsTime = 0;
  }
}
requestAnimationFrame(frame);

// ---- Utilitaires navigateur ----
// Bloque les gestes du navigateur (défilement, pinch-zoom iOS, double-tap, menu contextuel)
function blockBrowserGestures() {
  const prevent = (e) => e.preventDefault();
  document.addEventListener('touchmove', prevent, { passive: false });
  document.addEventListener('gesturestart', prevent);
  document.addEventListener('dblclick', prevent);
  document.addEventListener('contextmenu', prevent);
}

// Plein écran + paysage sur Android (iOS Safari ne le permet pas sur iPhone, on ignore l'erreur)
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

// Accès de mise au point depuis la console du navigateur
window.__game = { seed, CONFIG, scene, cam };
