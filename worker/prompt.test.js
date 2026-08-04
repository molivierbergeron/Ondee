// Le prompt système est la seule partie du Worker qui soit du code pur : le
// reste est du réseau. Ces tests verrouillent précisément les deux erreurs
// trouvées en relecture après la session de test vocal ratée — un décompte de
// plantes écrit en dur et devenu faux, et des noms latins absents de la liste
// alors que c'est ce que l'utilisateur prononce.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSystemPrompt, genericNameGroups, describePlant } from './index.js';

const plants = JSON.parse(readFileSync(new URL('../plants.json', import.meta.url)));

test('chaque plante a des noms alternatifs', () => {
  for (const p of plants) {
    assert.ok(Array.isArray(p.noms_alternatifs) && p.noms_alternatifs.length > 0, `id ${p.id} sans noms_alternatifs`);
  }
});

// Un synonyme porté par deux plantes ferait choisir la première au lieu de
// signaler l'ambiguïté — c'est-à-dire arroser la mauvaise plante en silence.
test('aucun nom alternatif n’est partagé par deux plantes', () => {
  const vus = new Map();
  for (const p of plants) {
    for (const alias of p.noms_alternatifs) {
      const clef = alias.toLowerCase();
      assert.equal(vus.get(clef), undefined, `« ${alias} » partagé par id ${vus.get(clef)} et ${p.id}`);
      vus.set(clef, p.id);
    }
  }
});

test('un nom alternatif ne répète pas un nom principal d’une autre plante', () => {
  const noms = new Map(plants.map((p) => [p.nom.toLowerCase(), p.id]));
  for (const p of plants) {
    for (const alias of p.noms_alternatifs) {
      const collision = noms.get(alias.toLowerCase());
      assert.ok(collision === undefined || collision === p.id, `« ${alias} » (id ${p.id}) est le nom de la plante ${collision}`);
    }
  }
});

test('les noms latins que l’utilisateur prononce sont dans le prompt', () => {
  const prompt = buildSystemPrompt(plants, null);
  for (const latin of ['Ficus lyrata', 'Ficus benjamina', 'Ficus elastica', 'Monstera deliciosa', 'Calathea ornata']) {
    assert.ok(prompt.includes(latin), `${latin} absent du prompt`);
  }
});

test('les groupes de noms génériques sont comptés depuis la liste réelle', () => {
  const groupes = genericNameGroups(plants);
  // La version écrite en dur annonçait 4 Pothos alors qu'il y en a 3.
  assert.ok(groupes.some((g) => g.startsWith('« Pothos » correspond à 3 plantes')), groupes.join(' | '));
  assert.ok(groupes.some((g) => g.startsWith('« Ficus » correspond à 3 plantes')), groupes.join(' | '));
  assert.ok(groupes.some((g) => g.startsWith('« Calathea » correspond à 2 plantes')), groupes.join(' | '));
  assert.ok(groupes.some((g) => g.startsWith('« Sansevieria » correspond à 2 plantes')), groupes.join(' | '));
  // Un nom porté par une seule plante n'est pas une ambiguïté.
  assert.ok(!groupes.some((g) => g.startsWith('« Monstera »')), groupes.join(' | '));
});

test('le prompt de désambiguïsation ne parle que des candidats', () => {
  const candidats = plants.filter((p) => [19, 20].includes(p.id));
  const prompt = buildSystemPrompt(candidats, [19, 20]);
  assert.ok(prompt.includes('Calathea White Star'));
  assert.ok(prompt.includes('Calathea lignes roses'));
  assert.ok(!prompt.includes('Monstera'), 'une plante hors candidats a fui dans le prompt réduit');
  // Répondre « cuisine » doit pouvoir trancher : les deux pièces sont citées.
  assert.ok(prompt.includes('Cuisine') && prompt.includes('Salon'));
});

test('les deux prompts réclament une transcription', () => {
  assert.ok(buildSystemPrompt(plants, null).includes('"transcription"'));
  assert.ok(buildSystemPrompt(plants.slice(0, 2), [1, 2]).includes('"transcription"'));
});

test('chaque plante décrite porte sa pièce, sa source et ses synonymes', () => {
  const ligne = describePlant(plants.find((p) => p.id === 14));
  assert.match(ligne, /id 14 : Ficus lyre \(aussi appelé : .*Ficus lyrata.*\) — Bureau — .* \[wh51\]/);
});

// Garde-fou de données : une plante wh51 sans capteur_id resterait bloquée sur
// « pas de lecture capteur », une plante sonde avec capteur_id lirait un
// capteur qui ne la concerne pas.
test('source et capteur_id sont cohérents', () => {
  for (const p of plants) {
    if (p.source === 'wh51') assert.ok(p.capteur_id, `id ${p.id} wh51 sans capteur_id`);
    else assert.equal(p.capteur_id, null, `id ${p.id} ${p.source} avec un capteur_id`);
  }
  const capteurs = plants.map((p) => p.capteur_id).filter(Boolean);
  assert.equal(new Set(capteurs).size, capteurs.length, 'un capteur_id est assigné à deux plantes');
});
