// Gabarits de réponse vocale (section 4.3 du brief). Ton : court, sans préambule.
// Les valeurs numériques sont interpolées telles quelles ("32", pas "trente-deux") :
// la synthèse vocale prononce les chiffres correctement en français, pas besoin
// de les épeler ici.

function formatListeFr(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ou ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ou ${items[items.length - 1]}`;
}

export const templates = {
  // surDix : true pour une lecture sonde dictée sur l'échelle 0–10 du cadran ;
  // false pour un pourcentage (capteur wh51, ou sonde dictée explicitement en %).
  lecture: (surDix, valeur) => (surDix ? `${valeur} sur dix.` : `${valeur} pour cent.`),
  nePasArroser: () => 'Ne pas arroser.',
  bientot: () => 'Bientôt. Revérifie dans quelques jours.',
  arroserDose: (dose) => `Arroser ${dose}.`,
  arroserRuissellement: () => "Arroser jusqu'au ruissellement, puis vider la soucoupe.",
  ambiguite: (pieces) => `${formatListeFr(pieces)} ?`,
  nonReconnu: () => "Je n'ai pas reconnu. Répète.",
  horsLimite: () => 'Valeur surprenante. Confirme le chiffre.',
  capteurIndisponible: () => 'Pas de lecture capteur pour cette plante.',
};
