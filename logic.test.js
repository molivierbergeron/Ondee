import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict, buildResponse } from './logic.js';
import { templates } from './templates.js';

// --- Grille 4.2 : verdict selon l'écart ---

test('ecart <= 0 -> ne pas arroser', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 40, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.type, 'ne_pas_arroser');
});

test('ecart == 0 (limite) -> ne pas arroser', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 35, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.type, 'ne_pas_arroser');
});

test('0 < ecart <= 5 -> bientot', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 31, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.type, 'bientot');
});

test('ecart == 5 (limite) -> bientot', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 30, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.type, 'bientot');
});

test('ecart == 5.0001 (juste au-dessus) -> arroser', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 29.9999, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.type, 'arroser');
});

// --- Dose selon taille de pot ---

test('dose petit pot -> un verre', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 20, humiditeMin: 35, taillePot: 'petit', regime: 'mesure' });
  assert.equal(verdict.dose, 'un verre');
});

test('dose moyen pot -> un gros verre', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 20, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.dose, 'un gros verre');
});

test('dose grand pot, ecart <= 15 -> un litre', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 20, humiditeMin: 35, taillePot: 'grand', regime: 'mesure' }); // ecart=15
  assert.equal(verdict.dose, 'un litre');
});

test('dose grand pot, ecart > 15 -> un litre et demi', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 19, humiditeMin: 35, taillePot: 'grand', regime: 'mesure' }); // ecart=16
  assert.equal(verdict.dose, 'un litre et demi');
});

// --- Régime complet ---

test('regime complet -> pas de dose, message ruissellement', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 20, humiditeMin: 35, taillePot: 'moyen', regime: 'complet' });
  assert.equal(verdict.type, 'arroser_ruissellement');
  assert.equal(verdict.dose, undefined);
});

test('regime complet mais ecart <= 5 -> reste bientot (pas de dose concernee)', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 30, humiditeMin: 35, taillePot: 'moyen', regime: 'complet' });
  assert.equal(verdict.type, 'bientot');
});

// --- Normalisation (4.1) ---

test('normalisation sonde : lecture x10', () => {
  const verdict = computeVerdict({ source: 'sonde', valeur: 3, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.lectureNorm, 30);
});

test('normalisation wh51 : lecture inchangee', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 42, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.lectureNorm, 42);
});

// --- Garde-fou ---

test('garde-fou : sonde > 10 -> hors limite', () => {
  const verdict = computeVerdict({ source: 'sonde', valeur: 11, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.type, 'hors_limite');
});

test('garde-fou : sonde == 10 est valide', () => {
  const verdict = computeVerdict({ source: 'sonde', valeur: 10, humiditeMin: 5, taillePot: 'moyen', regime: 'mesure' });
  assert.notEqual(verdict.type, 'hors_limite');
});

test('garde-fou : valeur > 100 -> hors limite quelle que soit la source', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 101, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.type, 'hors_limite');
});

test('garde-fou : 100 est valide', () => {
  const verdict = computeVerdict({ source: 'wh51', valeur: 100, humiditeMin: 35, taillePot: 'moyen', regime: 'mesure' });
  assert.notEqual(verdict.type, 'hors_limite');
});

// --- Assemblage de la réponse (4.3 / exemples de la section 7) ---

test('buildResponse : capteur, arroser', () => {
  const params = { source: 'wh51', valeur: 32, humiditeMin: 45, taillePot: 'moyen', regime: 'mesure' };
  const verdict = computeVerdict(params);
  const response = buildResponse({ source: params.source, valeur: params.valeur, verdict });
  assert.equal(response, '32 pour cent. Arroser un gros verre.');
});

test('buildResponse : sonde, ne pas arroser', () => {
  const params = { source: 'sonde', valeur: 6, humiditeMin: 50, taillePot: 'moyen', regime: 'mesure' };
  const verdict = computeVerdict(params);
  const response = buildResponse({ source: params.source, valeur: params.valeur, verdict });
  assert.equal(response, '6 sur dix. Ne pas arroser.');
});

test('buildResponse : hors limite', () => {
  const params = { source: 'sonde', valeur: 23, humiditeMin: 50, taillePot: 'moyen', regime: 'mesure' };
  const verdict = computeVerdict(params);
  const response = buildResponse({ source: params.source, valeur: params.valeur, verdict });
  assert.equal(response, templates.horsLimite());
});

// --- Gabarits ---

test('ambiguite : une seule piece', () => {
  assert.equal(templates.ambiguite(['Salon']), 'Salon ?');
});

test('ambiguite : deux pieces', () => {
  assert.equal(templates.ambiguite(['Salon', 'Chambre']), 'Salon ou Chambre ?');
});

test('ambiguite : trois pieces', () => {
  assert.equal(templates.ambiguite(['Salon', 'Chambre', 'Bureau']), 'Salon, Chambre, ou Bureau ?');
});

test('nonReconnu', () => {
  assert.equal(templates.nonReconnu(), "Je n'ai pas reconnu. Répète.");
});

test('capteurIndisponible', () => {
  assert.equal(templates.capteurIndisponible(), 'Pas de lecture capteur pour cette plante.');
});
