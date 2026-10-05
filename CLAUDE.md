# Consignes du projet

Roguelite dans les enfers grecs, 3D isométrique inspirée de Hades, action en temps réel (Vite + Three.js, JavaScript sans TypeScript), publié sur GitHub Pages : https://ozaxe.github.io/Bor-rog/

Le propriétaire du dépôt n'est pas développeur de jeux : il juge sur des résultats testés et visibles. Explications en français, tutoiement, pas de tiret long.

## Conventions

- Commentaires du code en français.
- Pas d'éditeur graphique : tout est du code ou du texte (géométries, couleurs, sons générés en code).
- Performance mobile d'abord : InstancedMesh, MeshLambertMaterial, pas de shadow maps (ombre "disque"), pixel ratio plafonné (1,5 mobile / 2 PC), pas d'antialias sur mobile, une seule lumière ponctuelle. Objectif : 60 ips sur téléphone milieu de gamme.
- Contrôles : `event.code` (KeyW…) pour que ZQSD et WASD marchent sans réglage ; appareil détecté via `matchMedia('(pointer: coarse)')`, jamais le user-agent.
- `base: '/Bor-rog/'` dans `vite.config.js` doit rester égal au nom du dépôt (casse comprise), en dev, preview ET build.

## Direction artistique (validée : « option A », tout en code)

- Caméra isométrique orthographique, fixe, au sud-est (`src/camera/isoCamera.js`). Elle ne voit que le dessus et les faces sud/est des murs.
- Murs côté caméra abaissés selon `isLowWall` (`src/dungeon/tiles.js`) : un mur est bas s'il a du sol au nord, à l'ouest ou au nord-ouest.
- Décor fixe d'un étage = un seul maillage + un atlas de textures dessiné en canvas (`src/render/dungeonMesh.js`, `src/render/textures.js`). Lueur des flammes peinte dans les couleurs des sommets + halos additifs, pas de vraies lumières ni de bloom.
- Palette : ardoise bleu-vert, encre presque noire, flammes vert spectral, accents or. Personnages en cel shading (MeshToonMaterial) avec contour d'encre par coque inversée.

## Architecture (préparée pour un futur multijoueur)

- `src/state/` : état pur, sérialisable en JSON (y compris l'état du générateur aléatoire).
- `src/systems/`, `src/dungeon/` : simulation et génération pures, sans Three.js ni navigateur, exécutables dans Node. Les réglages des règles sont dans `src/systems/simConfig.js` ; `src/config.js` ne contient que l'affichage et les contrôles.
- Génération des étages : BSP (`src/dungeon/generate.js`), générateur dérivé de (graine, numéro d'étage). Les tests vérifient sur 300 graines que chaque étage est jouable.
- `src/render/` : lit l'état sans jamais le modifier. `src/ui/` : écrans HTML hors partie (Seuil) et stockage navigateur.
- `src/controls/` : produisent une "intention" `{ moveX, moveY, aimX, aimY, attack, dash }` exprimée dans le repère du MONDE (la conversion écran -> monde selon la caméra se fait côté client).
- Boucle à pas fixe 60 Hz (`src/core/fixedStep.js`) + interpolation d'affichage.

### Combat (étape 3)

- Règles et chiffres : `src/systems/simConfig.js` (durées en secondes, converties en pas entiers par `ticks()`).
- Héros : `src/systems/player.js` (attaque en arc, visée auto sans souris, esquive invulnérable, invulnérabilité après un coup). Ennemis : `src/systems/enemies.js` (machine à états idle / chase / windup / recover ; direction figée au début de la préparation pour que l'attaque soit lisible et esquivable). Flèches : `src/systems/projectiles.js`. Peuplement : `src/dungeon/populate.js` (générateur distinct de celui du plan).
- Salles verrouillées (`src/systems/rooms.js`) : en entrant (au moins une case au-delà du seuil) dans une salle de combat occupée, des grilles (`TILE.GATE`, solides) ferment ses passages. Ne sont enfermés que les ennemis physiquement dans la salle à la fermeture (garantie anti-blocage, testée). Purifiée quand ils sont tous vaincus.
- Les ennemis contournent les obstacles : ligne droite si le passage est libre pour leur corps (`hasClearPath`), sinon carte des distances jusqu'au héros.
- Butin (`src/systems/loot.js`, étape 4) : oboles (attirées vers le héros) et potions lâchées par les ennemis, récompense au centre d'une salle purifiée, coffre dans chaque salle au trésor. Tirages via `state.rng`.
- Bienfaits (`src/systems/boons.js`) : l'état ne stocke que leur nombre (`player.boons`) ; `playerStats()` calcule les caractéristiques effectives. L'escalier ouvre l'écran de Charon (`src/systems/descent.js`, statut `choosing`, donjon en pause) : 1 bienfait parmi 3, soin et relance payants. Les choix passent par l'intention (`choice`, `shop`), jamais par une modification directe de l'état depuis l'interface.
- Difficulté (`src/systems/difficulty.js`, étape 5a) : par étage, PV et vitesse multipliés, +1 dégât tous les 4 étages, préparations raccourcies (plancher 60 %), élites (aura dorée) plus fréquentes. Les valeurs effectives sont calculées à la création de l'ennemi et rangées dans `e.stats` ; l'IA lit `e.stats`. Furie à partir de l'étage 3 (charge annoncée en ligne droite). Calibrage au bot : médiane de mort à l'étage 5 sans méta-progression.
- Zones et boss (`src/dungeon/zones.js`, étape 5b) : 3 zones de 3 étages (Tartare, Asphodèle, Élysée), ambiance par zone dans `src/render/zoneThemes.js`. Le 3e étage d'une zone est un étage de boss au plan fixe (`generateBossFloor` : départ -> arène scellée -> sanctuaire de l'escalier). Boss dans `src/systems/bosses.js` (config `SIM.bosses`), sans recul ni interruption ; chaque attaque annoncée. Les 3 boss sont faits : Cerbère (charge, souffle, morsure, phase 2 avec ombres), l'Hydre de Lerne (immobile au centre, têtes `hydraHead` tranchables qui repoussent sauf si on frappe le corps juste après = cautérisation ; phase 2 flaques de lave), Thanatos (faux circulaire, téléportation dans le dos, pluie d'âmes ; phase 2 doubles `thanatosDouble` qui se dissipent en un coup ; phase 3 plus rapide). Les parties de boss ont `part: true` (pas de butin, pas de recul). Zones au sol dangereuses : `src/systems/hazards.js` (`addHazard`, annonce puis frappe). Vaincre Thanatos met `status = 'victory'` (écran de victoire dans main.js). Calibrage avec un bot qui esquive 75 % des attaques : victoire Cerbère ~52 %, Hydre ~33 %, Thanatos ~10 %, combats de ~50-60 s.
- Roguelite (`src/meta/`, étape 6) : monnaie permanente, les Ombres (`state.shadows`, barème `SIM.shadows` : ennemi, élite, étage, boss), encaissées à la fin de la partie (mort, victoire ou abandon) par `recordRun`. Arbre commun à toutes les classes (`src/meta/tree.js`, 4 branches : Arès, Déméter, Hermès, Charon ; un nœud exige 1 rang du précédent). Les rangs entrent dans la partie par `createGameState(seed, { meta })` -> `state.player.meta` (même graine + mêmes rangs = même partie) ; leurs effets sont lus par `playerStats`, `hurtPlayer` (Défi de la Mort), `descent.js` (4 bienfaits, relance gratuite, soin par étage) et `projectiles.js` (renvoi pendant l'esquive). Un tirage n'a lieu que si l'amélioration est possédée : sans arbre, les parties ne changent pas. Profil (`src/meta/profile.js`, pur) sauvegardé dans le navigateur par `src/ui/storage.js` ; écran du Seuil : `src/ui/threshold.js`. Économie mesurée au bot : ~45 Ombres par partie au début, ~340 avec l'arbre complet (2 075 au total), soit une vingtaine de parties pour tout acheter.
- Le rendu ne modifie JAMAIS l'état : un test (`tests/purity.test.js`) scanne `src/render` pour l'interdire.
- Feuille de route validée : 5b = 3 zones de 3 étages (Tartare, Asphodèle, Élysée) avec boss et victoire ; 6 = roguelite (monnaie permanente, améliorations en arbre, sauvegarde navigateur + code d'export) ; ensuite classes (guerrier, chasseresse, mystique…) avec arbres de compétences.
- La simulation signale ce qui s'est passé via `state.events` (vidé à chaque pas) ; le rendu en tire les effets (`src/render/effects.js`). Les effets peuvent utiliser Math.random : ils n'influencent jamais la partie.
- Budget mesuré : ~60 appels de dessin et ~11 000 triangles par image.

### Déterminisme (règle stricte)

- Tout le hasard de la simulation passe par `src/core/rng.js` (mulberry32), dont l'état vit dans l'état du jeu.
- Interdit dans la simulation : `Math.random`, `Date`, `performance.now`, Three.js, `window`/`document`. Le test `tests/purity.test.js` le vérifie.
- Même graine + mêmes intentions = même partie. Une graine peut être forcée avec `?seed=xxx` dans l'adresse.

## Vérifications avant de pousser

- `npm test` (node:test, sans dépendance) ; chaque nouveau test est validé en cassant volontairement le code pour vérifier qu'il échoue.
- `npm run build`
- Test visuel headless (vite preview + Playwright, Chromium dans /opt/pw-browsers) en viewport PC et mobile, sans erreur console. Le rendu y est logiciel (SwiftShader) : les ips mesurés ne sont pas représentatifs, et sous 12 ips le temps de jeu ralentit (rattrapage plafonné à 5 pas par image) : maintenir les touches plus longtemps dans les scripts. Google Fonts y échoue (certificat du proxy) : sans conséquence en ligne.

## Méthode de livraison (validée par le propriétaire du dépôt)

1. Travailler sur une branche, commits clairs (un par étape logique).
2. Ouvrir une Pull Request vers `main`.
3. Attendre que le contrôle « Contrôle » (`.github/workflows/ci.yml`) soit vert.
4. Fusionner la PR soi-même, puis vérifier que le workflow « Déploiement GitHub Pages » passe au vert.
5. Ne jamais fusionner une PR dont le contrôle est rouge.

La session cloud ne peut pas ouvrir *.github.io (proxy) : le site en ligne se vérifie via le statut du workflow de déploiement.
