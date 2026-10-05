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
- Roguelite (`src/meta/`, étape 6) : monnaie permanente, les Ombres (`state.shadows`, barème `SIM.shadows` : ennemi, élite, étage, boss), encaissées à la fin de la partie (mort, victoire ou abandon) par `recordRun`. Méta-progression façon Cyberpunk 2.0 (6c) : 4 attributs (Arès, Déméter, Hermès, Charon, `src/meta/tree.js`) du niveau 1 à 10, montés avec les Ombres (`ATTR_COSTS`) ; chaque niveau donne un bonus passif (`ATTR_EFFECT`) et 1 point de talent. Un arbre de talents par attribut : 4 paliers ouverts aux niveaux 1/4/7/10 de l'attribut, 2 chemins et un ultime ; un rang coûte 1, 2, 3 ou 4 points selon le palier (`TIER_COSTS`) : 36 points = un arbre complet et le bas d'un deuxième (builds). Talents repris gratuitement, niveaux acquis. `cleanMeta` rejoue les talents selon les règles : toute entrée (sauvegarde, code, simulation) donne un build valide. La partie reçoit `createGameState(seed, { meta: { attrs, talents } })` -> `state.player.meta` ; effets lus par `playerStats` (boons.js), player.js (critique, Exécution, Rage, Élan, Danse des lames, Défi de la Mort, Moisson), descent.js (Pacte, Marchandage, 4 bienfaits, relance gratuite, Racines), loot.js (Élixir, Œil), projectiles.js (renvoi). Un tirage n'a lieu que si le talent est possédé : sans amélioration, les parties ne changent pas. Profil v2 (`src/meta/profile.js`) ; les profils et codes v1 (ancien arbre) sont convertis en remboursant les Ombres. Seuil : `src/ui/threshold.js` (onglets, carte d'attribut, arbre avec liens SVG). Code d'export : `src/meta/transfer.js` (`BORROG1-<base64>-<somme>`).
- Calibrage 6c (bot à 75 % d'esquive, parties complètes, scripts botlib/variants/career2) : sans amélioration 0 % de victoires (mort médiane étage 4) ; tout au max avec un build offensif (Arès + Hermès) ~45 % ; build endurance (Déméter + bas d'Arès) ~80 % (le bot rate 25 % des esquives, la survie le favorise) ; à mi-parcours ~10-20 %. Carrière : 1re victoire vers la 14e partie, attributs au max après 21 à 25 parties.
- Classes (étape 7, `src/systems/classes.js`, chiffres dans `SIM.classes`) : Guerrier (héros de base `SIM.player`, épée en arc, 12 PV), Chasseresse (arc : flèche alliée qui traverse 1 ennemi, +1 par rang de Fendoir, 11 PV, plus rapide), Mystique (orbe lent qui explose en zone, rayon agrandi par Fendoir, 11 PV). `createGameState(seed, { meta, cls })` -> `state.player.cls` ; `playerStats` lit les réglages de la classe (`classRules`). Les tirs du héros sont des projectiles `friendly` résolus dans projectiles.js (`explode` pour l'orbe). Déblocage : Chasseresse en battant Cerbère, Mystique en battant l'Hydre (`state.bossesDefeated` -> `profile.stats.bosses`). Profil v3 : `cls`, `talents` = build de la classe choisie, `builds` = builds rangés des autres classes (`selectClass`), attributs communs. Calibrage (bot 75 %) : sans amélioration, les 3 classes meurent vers l'étage 4 ; en fin de progression le Guerrier reste devant (build endurance : Guerrier ~84 %, Mystique ~69 %, Chasseresse ~43 %), à rééquilibrer avec les arbres de classe (7c). Le bot des tireurs garde ses distances, mais se rapproche des boss (Cerbère punit la distance). Prochaines étapes validées : 7b capacité spéciale par classe (3e bouton : Tourbillon, Volée, Nova), 7c arbre de talents par classe (5e onglet, même réserve de points).
- Le rendu ne modifie JAMAIS l'état : un test (`tests/purity.test.js`) scanne `src/render` pour l'interdire.
- Feuille de route validée : 5b = 3 zones de 3 étages avec boss et victoire (fait) ; 6 = roguelite (fait : Ombres, attributs et talents, sauvegarde navigateur + code d'export) ; ensuite classes (guerrier, chasseresse, mystique…), chacune avec son propre arbre de talents branché sur les mêmes attributs.
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
