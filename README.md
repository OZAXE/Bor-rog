# Bor-rog

Roguelike de donjon en 3D vue de dessus, jouable dans le navigateur sur PC et mobile, sans rien installer.

**Jouer :** https://ozaxe.github.io/Bor-rog/

Chaque partie est générée à partir d'une graine, affichée à l'écran. Pour rejouer exactement le même donjon : `https://ozaxe.github.io/Bor-rog/?seed=<graine>`.

## Développement

```bash
npm install
npm run dev        # http://localhost:5173/Bor-rog/
npm test           # tests de la simulation (Node)
npm run build      # version de production dans dist/
```

Conventions, architecture et méthode de livraison : voir [CLAUDE.md](CLAUDE.md).
