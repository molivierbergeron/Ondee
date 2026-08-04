// Logique locale déterministe (section 4 du brief). Le LLM ne fait
// qu'identifier la plante et extraire la valeur ; tout ce qui suit —
// plage cible, verdict, dose, formulation — vit ici, en code testable.

import { templates } from './templates.js';

// Une sonde "sonde" dicte normalement sur une échelle 0–10 (le cadran de
// l'humidimètre), mais certains utilisateurs donnent directement un
// pourcentage à voix haute ("vingt-deux pour cent") — dans ce cas Gemini le
// signale via pourcentageExplicite et on ne multiplie pas par 10.
function estPourcentage(source, pourcentageExplicite) {
  return source !== 'sonde' || pourcentageExplicite === true;
}

function isOutOfRange(source, valeur, pourcentageExplicite) {
  if (!estPourcentage(source, pourcentageExplicite) && valeur > 10) return true;
  if (valeur > 100) return true;
  return false;
}

function computeDose(taillePot, ecart) {
  if (taillePot === 'petit') return 'un verre';
  if (taillePot === 'moyen') return 'un gros verre';
  if (taillePot === 'grand') return ecart > 15 ? 'un litre et demi' : 'un litre';
  throw new Error(`taille_pot inconnue : ${taillePot}`);
}

// { source, valeur, humiditeMin, taillePot, regime, pourcentageExplicite } -> verdict
export function computeVerdict({ source, valeur, humiditeMin, taillePot, regime, pourcentageExplicite }) {
  if (isOutOfRange(source, valeur, pourcentageExplicite)) {
    return { type: 'hors_limite' };
  }

  const lectureNorm = estPourcentage(source, pourcentageExplicite) ? valeur : valeur * 10;
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

// { source, valeur, verdict, pourcentageExplicite } -> texte à énoncer
export function buildResponse({ source, valeur, verdict, pourcentageExplicite }) {
  if (verdict.type === 'hors_limite') {
    return templates.horsLimite();
  }

  const lecture = templates.lecture(!estPourcentage(source, pourcentageExplicite), valeur);
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
