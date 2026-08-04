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

// --- Sonde dictée en pourcentage explicite ("vingt-deux pour cent") ---

test('sonde + pourcentageExplicite : 22 nest pas hors limite', () => {
  const verdict = computeVerdict({ source: 'sonde', valeur: 22, humiditeMin: 25, taillePot: 'moyen', regime: 'mesure', pourcentageExplicite: true });
  assert.notEqual(verdict.type, 'hors_limite');
});

test('sonde + pourcentageExplicite : pas de multiplication par 10', () => {
  const verdict = computeVerdict({ source: 'sonde', valeur: 22, humiditeMin: 25, taillePot: 'moyen', regime: 'mesure', pourcentageExplicite: true });
  assert.equal(verdict.lectureNorm, 22);
});

test('sonde + pourcentageExplicite : garde-fou > 100 sapplique quand meme', () => {
  const verdict = computeVerdict({ source: 'sonde', valeur: 101, humiditeMin: 25, taillePot: 'moyen', regime: 'mesure', pourcentageExplicite: true });
  assert.equal(verdict.type, 'hors_limite');
});

test('sonde sans pourcentageExplicite : comportement 0-10 inchange', () => {
  const verdict = computeVerdict({ source: 'sonde', valeur: 22, humiditeMin: 25, taillePot: 'moyen', regime: 'mesure' });
  assert.equal(verdict.type, 'hors_limite'); // 22 > 10 sur l'echelle du cadran
});

test('buildResponse : sonde + pourcentageExplicite parle en pourcentage', () => {
  const params = { source: 'sonde', valeur: 22, humiditeMin: 45, taillePot: 'moyen', regime: 'mesure', pourcentageExplicite: true };
  const verdict = computeVerdict(params);
  const response = buildResponse({ source: params.source, valeur: params.valeur, verdict, pourcentageExplicite: true });
  assert.equal(response, '22 pour cent. Arroser un gros verre.');
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

// --- Plage cible annoncée (demande explicite de l'utilisateur : « je veux
// savoir c'est quoi le target pour le croton ») ---

test('buildResponse : capteur, la cible est annoncée en pourcentage', () => {
  const params = { source: 'wh51', valeur: 25, humiditeMin: 35, humiditeMax: 50, taillePot: 'moyen', regime: 'mesure' };
  const verdict = computeVerdict(params);
  const response = buildResponse({ ...params, verdict });
  assert.equal(response, '25 pour cent, cible 35 à 50. Arroser un gros verre.');
});

// Le cadran de l'humidimètre est gradué 0–10, la cible est stockée en % :
// l'annoncer telle quelle donnerait « 6 sur dix, cible 45 à 60 », deux
// échelles dans la même phrase. Elle est donc ramenée sur celle de la lecture.
test('buildResponse : sonde, la cible est ramenée sur l’échelle du cadran', () => {
  const params = { source: 'sonde', valeur: 6, humiditeMin: 45, humiditeMax: 60, taillePot: 'moyen', regime: 'mesure' };
  const verdict = computeVerdict(params);
  const response = buildResponse({ ...params, verdict });
  assert.equal(response, '6 sur dix, cible 4,5 à 6. Ne pas arroser.');
});

test('buildResponse : sonde dictée en pourcentage garde l’échelle pourcentage', () => {
  const params = { source: 'sonde', valeur: 22, humiditeMin: 45, humiditeMax: 60, taillePot: 'moyen', regime: 'mesure', pourcentageExplicite: true };
  const verdict = computeVerdict(params);
  const response = buildResponse({ ...params, verdict });
  assert.equal(response, '22 pour cent, cible 45 à 60. Arroser un gros verre.');
});

test('buildResponse : régime complet annonce la cible et le ruissellement', () => {
  const params = { source: 'wh51', valeur: 20, humiditeMin: 35, humiditeMax: 50, taillePot: 'grand', regime: 'complet' };
  const verdict = computeVerdict(params);
  const response = buildResponse({ ...params, verdict });
  assert.equal(response, "20 pour cent, cible 35 à 50. Arroser jusqu'au ruissellement, puis vider la soucoupe.");
});

test('templates.cible : pas de décimale inutile', () => {
  assert.equal(templates.cible(true, 30, 60), 'cible 3 à 6');
  assert.equal(templates.cible(true, 25, 45), 'cible 2,5 à 4,5');
  assert.equal(templates.cible(false, 45, 60), 'cible 45 à 60');
});

// La cible reste facultative : buildResponse doit rester appelable sans elle.
test('buildResponse : sans cible connue, formulation inchangée', () => {
  const params = { source: 'wh51', valeur: 32, humiditeMin: 45, taillePot: 'moyen', regime: 'mesure' };
  const verdict = computeVerdict(params);
  assert.equal(buildResponse({ source: params.source, valeur: params.valeur, verdict }), '32 pour cent. Arroser un gros verre.');
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
