import { defineConfig } from 'vite';

// Le site est servi par GitHub Pages sous https://ozaxe.github.io/Bor-rog/
// "base" doit correspondre au nom du dépôt (casse comprise), sinon les fichiers
// JS/CSS sont cherchés à la racine et la page reste blanche.
// On garde la même base en dev, en preview et au build (une base conditionnelle
// casse "vite preview") : en local, le jeu est sur http://localhost:5173/Bor-rog/
export default defineConfig({
  base: '/Bor-rog/',
  build: {
    target: 'es2020',
    // three.js pèse ~500 ko non compressé : normal, pas besoin d'alerte
    chunkSizeWarningLimit: 1000,
  },
});
