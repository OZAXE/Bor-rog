# Consignes du projet

Roguelike dans les enfers grecs, 3D isométrique inspirée de Hades, action en temps réel (Vite + Three.js, JavaScript sans TypeScript), publié sur GitHub Pages : https://ozaxe.github.io/Bor-rog/

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
- `src/render/` : lit l'état sans jamais le modifier.
- `src/controls/` : produisent une "intention" `{ moveX, moveY, aimX, aimY, attack, dash }` exprimée dans le repère du MONDE (la conversion écran -> monde selon la caméra se fait côté client).
- Boucle à pas fixe 60 Hz (`src/core/fixedStep.js`) + interpolation d'affichage.

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
