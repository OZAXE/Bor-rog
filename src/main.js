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
import { createInput } from './controls/input.js';

// ---------------------------------------------------------------------------
// Organisation :
//   contrôles -> intention -> simulation (state + systems, pure) -> rendu (render/)
// La simulation tourne à pas fixe (60 Hz) ; le rendu suit le rafraîchissement de
// l'écran et interpole entre deux pas pour rester fluide sur les écrans 90/120 Hz.
// ---------------------------------------------------------------------------

blockBrowserGestures();

// ---- Graine de la partie ----
// ?seed=xxx dans l'adresse permet de rejouer un donjon précis.
// Sinon on en tire une au hasard (ici Math.random est permis : on est hors simulation).
const params = new URLSearchParams(window.location.search);
const seed = params.get('seed') || Math.floor(Math.random() * 1e9).toString(36);

// ---- État ----
const state = createGameState(seed);

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
scene.add(new THREE.HemisphereLight(L.ambientSky, L.ambientGround, L.ambientIntensity));
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
  atlas: createAtlasTexture(),
  halo: createHaloTexture(),
  toon: createToonGradient(),
};
const dungeonResources = createDungeonResources(textures);
const makeDungeonView = () =>
  createDungeonView(scene, state.dungeon, dungeonResources, cam.camera.quaternion);
let dungeonView = makeDungeonView();
let viewFloor = state.floorIndex;
const playerView = createPlayerView(scene, textures.toon);

// ---- Entrées ----
const input = createInput();

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
  const dx = hit.x - state.player.x;
  const dz = hit.z - state.player.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return null; // souris sur le héros : pas de direction fiable
  return { x: dx / len, y: -dz / len };
}

// ---- Interface ----
const startScreen = document.getElementById('start-screen');
const startText = document.getElementById('start-text');
const floorLabel = document.getElementById('floor-label');
const banner = document.getElementById('floor-banner');
document.getElementById('start-seed').textContent = `Graine : ${seed}`;
document.getElementById('seed-label').textContent = `graine ${seed}`;
let playing = false;

startText.innerHTML = DEVICE.isMobile
  ? 'Touche l’écran pour jouer<br><small>Pouce gauche : se déplacer</small>'
  : 'Clique pour jouer<br><small>ZQSD / WASD : se déplacer · Souris : viser · Échap : pause</small>';

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

let started = false;
function setPlaying(value) {
  playing = value;
  // Le bandeau "Étage 1" n'apparaît qu'au vrai début de la partie
  // (sinon il s'anime derrière l'écran titre et chevauche le titre)
  if (value && !started) {
    started = true;
    showFloor(true);
  }
  startScreen.classList.toggle('hidden', value);
  if (!value) {
    startText.innerHTML = DEVICE.isMobile ? 'Touche pour reprendre' : 'Clique pour reprendre';
  }
  loop.reset();
}

function showFloor(withBanner) {
  floorLabel.textContent = `Étage ${state.floorIndex + 1}`;
  if (!withBanner) return;
  banner.textContent = `Étage ${state.floorIndex + 1}`;
  banner.classList.remove('show');
  void banner.offsetWidth; // relance l'animation CSS
  banner.classList.add('show');
}
showFloor(false);

// ---- Boucle de jeu ----
const loop = createFixedStep(STEP);
const timer = new THREE.Timer();
// Position avant/après le dernier pas, pour l'interpolation visuelle
const prev = { x: state.player.x, z: state.player.z, facing: state.player.facing };

function tick() {
  prev.x = state.player.x;
  prev.z = state.player.z;
  prev.facing = state.player.facing;
  stepGame(state, playing ? input.getIntent(cam.screenToWorld, aimFromMouse) : EMPTY_INTENT);
}

// Compteur d'images par seconde (affichage de mise au point)
const debugEl = document.getElementById('debug');
let fpsFrames = 0;
let fpsTime = 0;

function frame(timestamp) {
  requestAnimationFrame(frame);
  timer.update(timestamp);
  const dt = timer.getDelta();
  const time = timer.getElapsed();

  const alpha = playing ? loop.advance(dt, tick) : 1;

  // Changement d'étage : on reconstruit le décor et on n'interpole pas (téléportation)
  if (state.floorIndex !== viewFloor) {
    dungeonView.dispose();
    dungeonView = makeDungeonView();
    viewFloor = state.floorIndex;
    prev.x = state.player.x;
    prev.z = state.player.z;
    showFloor(true);
  }

  const p = state.player;
  const x = prev.x + (p.x - prev.x) * alpha;
  const z = prev.z + (p.z - prev.z) * alpha;
  const facing = lerpAngle(prev.facing, p.facing, alpha);
  playerView.update(x, z, facing, Math.hypot(p.vx, p.vz), time);
  heroLight.position.set(x, CONFIG.heroLight.height, z);
  cam.follow(x, z);
  dungeonView.update(time);

  renderer.render(scene, cam.camera);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    debugEl.textContent = `${Math.round(fpsFrames / fpsTime)} ips · tick ${state.tick}`;
    fpsFrames = 0;
    fpsTime = 0;
  }
}
requestAnimationFrame(frame);

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

// Accès de mise au point depuis la console du navigateur (et pour les tests visuels)
window.__game = { seed, state, CONFIG, scene, cam };
