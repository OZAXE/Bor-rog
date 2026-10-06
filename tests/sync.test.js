// Règles de synchronisation du profil avec le compte en ligne (src/meta/sync.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, buyLevel } from '../src/meta/profile.js';
import { isBlankProfile, loginAction, refreshAction, profileSummary } from '../src/meta/sync.js';

function played(shadows = 300) {
  const p = newProfile();
  p.shadows = shadows;
  p.stats.runs = 3;
  p.stats.bestFloor = 4;
  return p;
}

test('profil vierge : jamais joué et rien acheté', () => {
  assert.equal(isBlankProfile(newProfile()), true);
  assert.equal(isBlankProfile(played()), false);
  const spent = newProfile();
  spent.shadows = 40;
  buyLevel(spent, 'ares'); // toutes les Ombres dépensées : pas vierge pour autant
  assert.equal(spent.shadows, 0);
  assert.equal(isBlankProfile(spent), false);
});

test('connexion : compte vide -> on envoie ; appareil vierge ou identique -> on prend le compte ; sinon le joueur choisit', () => {
  assert.equal(loginAction(played(), null), 'push');
  assert.equal(loginAction(newProfile(), played()), 'adopt');
  assert.equal(loginAction(played(), played()), 'adopt');
  assert.equal(loginAction(played(100), played(200)), 'conflict');
});

test('ouverture du jeu : on suit le compte sauf si cet appareil a aussi avancé', () => {
  const remote = played();
  assert.equal(refreshAction({ rev: 4, dirty: false }, 4, remote), 'none');
  assert.equal(refreshAction({ rev: 4, dirty: true }, 4, remote), 'push');
  assert.equal(refreshAction({ rev: 4, dirty: false }, 6, remote), 'adopt', 'un autre appareil a joué');
  assert.equal(refreshAction({ rev: 4, dirty: true }, 6, remote), 'conflict', 'les deux ont joué');
  assert.equal(refreshAction({ rev: 0, dirty: false }, 0, null), 'push');
});

test('résumé : Ombres dépensées comprises, niveaux gagnés', () => {
  const p = played(100);
  p.shadows += 40;
  buyLevel(p, 'ares');
  const s = profileSummary(p);
  assert.equal(s.shadows, 140);
  assert.equal(s.levels, 1);
  assert.equal(s.runs, 3);
  assert.equal(s.bestFloor, 4);
});
