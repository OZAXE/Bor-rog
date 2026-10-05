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
import { createEnemyViews, createProjectileView } from './render/enemyViews.js';
import { createEffects } from './render/effects.js';
import { createInput } from './controls/input.js';

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

// ---- État ----
let state = createGameState(seed);

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
const enemyViews = createEnemyViews(scene, textures.toon, cam.camera.quaternion);
const projectileView = createProjectileView(scene);
const effects = createEffects(scene, textures.halo);

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
  const dx = hit.x - state.player.x;
  const dz = hit.z - state.player.z;
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

startScreen.addEventListener('click', () => {
  if (DEVICE.isMobile) enterFullscreen();
  setPlaying(true);
});
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && state.status === 'playing') setPlaying(!playing);
});
// Quitter l'onglet met le jeu en pause
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.status === 'playing') setPlaying(false);
});

function setPlaying(value) {
  playing = value;
  startScreen.classList.toggle('hidden', value);
  // Le bandeau "Étage 1" n'apparaît qu'au vrai début de la partie
  // (sinon il s'anime derrière l'écran titre et chevauche le titre)
  if (value && !started) {
    started = true;
    showFloor(true);
  }
  if (!value) {
    startText.innerHTML = DEVICE.isMobile ? 'Touche pour reprendre' : 'Clique pour reprendre';
  }
  loop.reset();
}

function showFloor(withBanner) {
  $('floor-label').textContent = `Étage ${state.floorIndex + 1}`;
  if (!withBanner) return;
  banner.textContent = `Étage ${state.floorIndex + 1}`;
  banner.classList.remove('show');
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

function updateHud() {
  const p = state.player;
  healthFill.style.width = `${(100 * p.hp) / p.maxHp}%`;
  healthText.textContent = `${p.hp} / ${p.maxHp}`;
  $('kills').textContent = `${state.kills} vaincu${state.kills > 1 ? 's' : ''}`;
}

// ---- Mort et nouvelle partie ----
let deathTimer = 0;
function showDeath() {
  const n = state.floorIndex + 1;
  $('death-text').innerHTML =
    `Étage ${n} · ${state.kills} ennemi${state.kills > 1 ? 's' : ''} vaincu${state.kills > 1 ? 's' : ''}<br>` +
    `<small>Graine ${seed}</small>`;
  deathScreen.classList.remove('hidden');
}
function restart(newSeed) {
  seed = newSeed;
  state = createGameState(seed);
  window.__game.state = state;
  deathScreen.classList.add('hidden');
  prev.x = state.player.x;
  prev.z = state.player.z;
  prev.facing = state.player.facing;
  prevEnemies.clear();
  showSeed();
  rebuildFloor();
  updateHud();
  loop.reset();
  deathTimer = 0;
}
$('btn-retry').addEventListener('click', () => restart(seed));
$('btn-new').addEventListener('click', () => restart(randomSeed()));

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
const prev = { x: state.player.x, z: state.player.z, facing: state.player.facing };
const prevEnemies = new Map(); // id -> { x, z }
const enemyPos = new Map(); // id -> position interpolée
let hurtTimeout = 0;

function tick() {
  prev.x = state.player.x;
  prev.z = state.player.z;
  prev.facing = state.player.facing;
  for (const e of state.enemies) prevEnemies.set(e.id, { x: e.x, z: e.z });
  stepGame(state, playing ? input.getIntent(cam.screenToWorld, aimFromMouse) : EMPTY_INTENT);
  for (const ev of state.events) {
    effects.handle(ev);
    if (ev.type === 'playerHurt') {
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

  const alpha = playing && state.status === 'playing' ? loop.advance(dt, tick) : 1;

  // Changement d'étage : on reconstruit le décor et on n'interpole pas (téléportation)
  if (state.floorIndex !== viewFloor) {
    rebuildFloor();
    prev.x = state.player.x;
    prev.z = state.player.z;
    prevEnemies.clear();
  }

  const p = state.player;
  const x = prev.x + (p.x - prev.x) * alpha;
  const z = prev.z + (p.z - prev.z) * alpha;
  const facing = lerpAngle(prev.facing, p.facing, alpha);
  playerView.update(x, z, facing, Math.hypot(p.vx, p.vz), time, {
    blink: p.invuln > 0 && p.dashTimer === 0 && state.status === 'playing',
    dashing: p.dashTimer > 0,
  });
  heroLight.position.set(x, CONFIG.heroLight.height, z);

  enemyPos.clear();
  for (const e of state.enemies) {
    const pe = prevEnemies.get(e.id) || e;
    enemyPos.set(e.id, { x: pe.x + (e.x - pe.x) * alpha, z: pe.z + (e.z - pe.z) * alpha });
  }
  enemyViews.update(state.enemies, enemyPos, time);
  projectileView.update(state.projectiles, 1 - alpha, STEP);
  effects.update(dt);

  const shake = effects.shakeOffset();
  cam.follow(x + shake.x, z + shake.z);
  dungeonView.update(time);
  updateHud();

  // Mort : on laisse une seconde pour voir la scène avant l'écran de fin
  if (state.status === 'dead') {
    deathTimer += dt;
    if (deathTimer > 1 && deathScreen.classList.contains('hidden')) showDeath();
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
window.__game = { seed, state, CONFIG, scene, cam, renderer };
