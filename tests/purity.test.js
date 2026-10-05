// Garde-fou du déterminisme : la simulation ne doit dépendre que de l'état,
// de la graine et des intentions. On interdit donc, dans les dossiers de
// simulation, tout ce qui introduit du hasard ou du temps "extérieur",
// ainsi que Three.js et le navigateur (la simulation doit tourner dans Node,
// donc aussi sur un futur serveur multijoueur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Dossiers qui doivent rester purs (certains n'existent pas encore : c'est prévu)
export const PURE_DIRS = ['src/core/rng.js', 'src/core/fixedStep.js', 'src/state', 'src/systems', 'src/dungeon', 'src/meta'];

const FORBIDDEN = [
  { re: /Math\.random\s*\(/, why: 'hasard non reproductible : utiliser src/core/rng.js' },
  { re: /Date\.now\s*\(|new Date\s*\(/, why: "l'heure change à chaque partie" },
  { re: /performance\.now\s*\(/, why: "l'heure change à chaque partie" },
  { re: /from\s+['"]three['"]/, why: 'Three.js appartient au rendu, pas à la simulation' },
  { re: /\b(window|document|localStorage|navigator)\./, why: 'la simulation doit tourner dans Node' },
];

function listJs(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((name) => listJs(join(path, name))).filter((p) => p.endsWith('.js'));
}

// Retire les commentaires pour ne pas signaler un mot interdit cité en explication
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('aucune source de hasard, de temps ou de navigateur dans la simulation', () => {
  const files = PURE_DIRS.flatMap(listJs);
  assert.ok(files.length > 0, 'au moins un fichier pur doit être contrôlé');
  const problems = [];
  for (const file of files) {
    const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) problems.push(`${file} : ${re} (${why})`);
    }
  }
  assert.deepEqual(problems, []);
});

// Le rendu LIT l'état sans jamais le modifier (sinon l'affichage pourrait changer
// la partie, et le rejeu ou le multijoueur deviendraient faux)
test("le rendu n'écrit jamais dans l'état du jeu", () => {
  const files = listJs('src/render');
  assert.ok(files.length > 0);
  const WRITE = /\b(state|e|p|it|chest|enemy|boss)\.[A-Za-z_][\w.]*\s*(=(?!=)|\+=|-=|\+\+|--)/;
  const problems = [];
  for (const file of files) {
    const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    code.split('\n').forEach((line, i) => {
      if (WRITE.test(line)) problems.push(`${file}:${i + 1} : ${line.trim()}`);
    });
  }
  assert.deepEqual(problems, []);
});
