// Logique locale déterministe (section 4 du brief). Le LLM ne fait
// qu'identifier la plante et extraire la valeur ; tout ce qui suit —
// plage cible, verdict, dose, formulation — vit ici, en code testable.

import { templates } from './templates.js';

function isOutOfRange(source, valeur) {
  if (source === 'sonde' && valeur > 10) return true;
  if (valeur > 100) return true;
  return false;
}

function computeDose(taillePot, ecart) {
  if (taillePot === 'petit') return 'un verre';
  if (taillePot === 'moyen') return 'un gros verre';
  if (taillePot === 'grand') return ecart > 15 ? 'un litre et demi' : 'un litre';
  throw new Error(`taille_pot inconnue : ${taillePot}`);
}

// { source, valeur, humiditeMin, taillePot, regime } -> verdict
export function computeVerdict({ source, valeur, humiditeMin, taillePot, regime }) {
  if (isOutOfRange(source, valeur)) {
    return { type: 'hors_limite' };
  }

  const lectureNorm = source === 'sonde' ? valeur * 10 : valeur;
  const ecart = humiditeMin - lectureNorm;

  if (ecart <= 0) {
    return { type: 'ne_pas_arroser', lectureNorm, ecart };
  }
  if (ecart <= 5) {
    return { type: 'bientot', lectureNorm, ecart };
  }
  if (regime === 'complet') {
    return { type: 'arroser_ruissellement', lectureNorm, ecart };
  }
  return { type: 'arroser', lectureNorm, ecart, dose: computeDose(taillePot, ecart) };
}

// { source, valeur, verdict } -> texte à énoncer
export function buildResponse({ source, valeur, verdict }) {
  if (verdict.type === 'hors_limite') {
    return templates.horsLimite();
  }

  const lecture = templates.lecture(source, valeur);
  switch (verdict.type) {
    case 'ne_pas_arroser':
      return `${lecture} ${templates.nePasArroser()}`;
    case 'bientot':
      return `${lecture} ${templates.bientot()}`;
    case 'arroser_ruissellement':
      return `${lecture} ${templates.arroserRuissellement()}`;
    case 'arroser':
      return `${lecture} ${templates.arroserDose(verdict.dose)}`;
    default:
      throw new Error(`type de verdict inconnu : ${verdict.type}`);
  }
}
