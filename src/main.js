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
import { createGateView } from './render/gateView.js';
import { createLootView } from './render/lootView.js';
import { createHazardView } from './render/hazardView.js';
import { BOONS } from './systems/boons.js';
import { rerollCost, healCost } from './systems/descent.js';
import { SIM } from './systems/simConfig.js';
import { ZONE_THEMES } from './render/zoneThemes.js';
import { zoneOf, FLOORS_PER_ZONE } from './dungeon/zones.js';
import { createInput } from './controls/input.js';
import { recordRun, metaOf } from './meta/profile.js';
import { loadProfile, saveProfile } from './ui/storage.js';
import { createThreshold } from './ui/threshold.js';

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
const newState = (s) => createGameState(s, { meta: metaOf(profile.current), cls: profile.current.cls });

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

startScreen.addEventListener('click', (e) => {
  if (e.target.closest('button')) return; // boutons du Seuil / d'abandon
  if (DEVICE.isMobile) enterFullscreen();
  setPlaying(true);
});
window.addEventListener('keydown', (e) => {
  if (threshold.isOpen()) return;
  if ((e.code === 'Escape' || e.code === 'KeyP') && state.status === 'playing') setPlaying(!playing);
});
// Quitter l'onglet met le jeu en pause
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.status === 'playing' && !threshold.isOpen()) setPlaying(false);
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
  // Avant la première partie : accès au Seuil ; en pause : abandon possible
  $('btn-open-threshold').hidden = started;
  $('btn-abandon').hidden = !started;
  loop.reset();
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
  const p = state.player;
  healthFill.style.width = `${(100 * p.hp) / p.maxHp}%`;
  healthText.textContent = `${p.hp} / ${p.maxHp}`;
  $('kills').textContent = `${state.kills} vaincu${state.kills > 1 ? 's' : ''}`;
  $('gold').textContent = `${state.gold} obole${state.gold > 1 ? 's' : ''}`;
  $('shadows').textContent = `${state.shadows} Ombre${state.shadows > 1 ? 's' : ''}`;
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
  const open = state.status === 'choosing' && started && !threshold.isOpen();
  charon.classList.toggle('hidden', !open);
  if (!open) {
    charonKey = '';
    return;
  }
  const key = JSON.stringify([state.offer.boons, state.offer.rerolls, state.offer.free, state.gold, state.player.hp]);
  if (key === charonKey) return;
  charonKey = key;
  // Pacte de Charon : choix d'un bienfait au départ, sans descendre
  const pact = !!state.offer.start;
  $('charon-title').textContent = pact ? 'Pacte de Charon' : 'Charon, le passeur';
  $('charon-hint').textContent = pact ? 'Choisis le bienfait qui t\'accompagnera' : 'Choisis un bienfait des dieux pour descendre';
  const cards = $('boon-cards');
  cards.innerHTML = '';
  state.offer.boons.forEach((id, i) => {
    const b = BOONS[id];
    const lvl = state.player.boons[id] || 0;
    const btn = document.createElement('button');
    btn.className = 'boon-card';
    btn.type = 'button';
    btn.innerHTML = `<b>${b.name}</b><span>${b.text}</span><small>${lvl ? `niveau ${lvl} → ${lvl + 1}` : 'nouveau'}${DEVICE.isMobile ? '' : ` · touche ${i + 1}`}</small>`;
    btn.addEventListener('click', () => (pendingAction = { choice: i }));
    cards.appendChild(btn);
  });
  if (!state.offer.boons.length) {
    const btn = document.createElement('button');
    btn.className = 'boon-card';
    btn.type = 'button';
    btn.innerHTML = '<b>Descendre</b><span>Les dieux n\'ont plus rien à t\'offrir</span>';
    btn.addEventListener('click', () => (pendingAction = { choice: 0 }));
    cards.appendChild(btn);
  }
  const p = state.player;
  const heal = $('btn-heal');
  heal.textContent = `Se soigner +${SIM.loot.healAmount} PV · ${healCost(state)} oboles`;
  heal.disabled = state.gold < healCost(state) || p.hp >= p.maxHp;
  const reroll = $('btn-reroll');
  reroll.textContent = `Autres bienfaits · ${rerollCost(state)} oboles`;
  reroll.disabled = state.gold < rerollCost(state);
  $('charon-gold').textContent = `${state.gold} oboles · ${p.hp} / ${p.maxHp} PV`;
}
$('btn-heal').addEventListener('click', () => (pendingAction = { shop: 'heal' }));
$('btn-reroll').addEventListener('click', () => (pendingAction = { shop: 'reroll' }));
window.addEventListener('keydown', (e) => {
  if (state.status !== 'choosing') return;
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'].indexOf(e.code);
  if (n >= 0) pendingAction = { choice: n % 4 };
  if (e.code === 'KeyH') pendingAction = { shop: 'heal' };
  if (e.code === 'KeyR') pendingAction = { shop: 'reroll' };
});

// ---- Mort et nouvelle partie ----
let deathTimer = 0;
function showDeath() {
  const n = state.floorIndex + 1;
  $('death-text').innerHTML =
    `Étage ${n} · ${state.kills} ennemi${state.kills > 1 ? 's' : ''} vaincu${state.kills > 1 ? 's' : ''} · ${state.gold} oboles<br>` +
    `<span class="earned">+${lastEarned} Ombres</span><br>` +
    `${Object.keys(state.player.boons).length ? `Bienfaits : ${Object.entries(state.player.boons).map(([id, k]) => BOONS[id].name + (k > 1 ? ` ×${k}` : '')).join(', ')}<br>` : ''}` +
    `<small>Graine ${seed}</small>`;
  deathScreen.classList.remove('hidden');
}
const victoryScreen = $('victory-screen');
function showVictory() {
  const secs = Math.floor(state.tick / SIM.tickRate);
  const time = `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')} s`;
  const boons = Object.entries(state.player.boons)
    .map(([id, k]) => BOONS[id].name + (k > 1 ? ` ×${k}` : ''))
    .join(', ');
  $('victory-text').innerHTML =
    `Descente en ${time} · ${state.kills} ennemis vaincus · ${state.gold} oboles<br>` +
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
  lastEarned = recordRun(profile.current, state);
  saveProfile(profile.current);
}
const threshold = createThreshold({
  root: $('threshold'),
  profile,
  onChange: () => saveProfile(profile.current),
  onDescend: (sameSeed) => {
    threshold.close();
    restart(sameSeed ? seed : randomSeed());
    setPlaying(true);
  },
});
function openThreshold() {
  deathScreen.classList.add('hidden');
  victoryScreen.classList.add('hidden');
  startScreen.classList.add('hidden');
  threshold.open(recorded ? lastEarned : 0);
}
$('btn-open-threshold').addEventListener('click', openThreshold);
$('btn-death-threshold').addEventListener('click', openThreshold);
$('btn-victory-threshold').addEventListener('click', openThreshold);
$('btn-abandon').addEventListener('click', () => {
  endOfRun();
  openThreshold();
});

function restart(newSeed) {
  seed = newSeed;
  state = newState(seed);
  recorded = false;
  lastEarned = 0;
  window.__game.state = state;
  deathScreen.classList.add('hidden');
  victoryScreen.classList.add('hidden');
  prev.x = state.player.x;
  prev.z = state.player.z;
  prev.facing = state.player.facing;
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
  let intent = EMPTY_INTENT;
  if (state.status === 'choosing') {
    intent = pendingAction || EMPTY_INTENT;
    pendingAction = null;
  } else if (playing) intent = input.getIntent(cam.screenToWorld, aimFromMouse);
  stepGame(state, intent);
  for (const ev of state.events) {
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

  const alpha = playing && state.status !== 'dead' ? loop.advance(dt, tick) : 1;

  // Changement d'étage : on reconstruit le décor et on n'interpole pas (téléportation)
  if (state.floorIndex !== viewFloor) {
    rebuildFloor();
    gateView.reset();
    prev.x = state.player.x;
    prev.z = state.player.z;
    prevEnemies.clear();
  }

  const p = state.player;
  const x = prev.x + (p.x - prev.x) * alpha;
  const z = prev.z + (p.z - prev.z) * alpha;
  const facing = lerpAngle(prev.facing, p.facing, alpha);
  playerView.setClass(p.cls);
  setAttackLabel(p.cls);
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
  // Les écrans à faire défiler (Seuil, Charon) gardent le défilement au doigt
  document.addEventListener('touchmove', (e) => !e.target.closest?.('#threshold, #charon') && e.preventDefault(), {
    passive: false,
  });
  document.addEventListener('gesturestart', prevent);
  // Le champ du code de sauvegarde garde la sélection et le menu "Coller" (appui long)
  const outsideField = (e) => !e.target.closest?.('textarea') && e.preventDefault();
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
