// Gabarits de réponse vocale (section 4.3 du brief). Ton : court, sans préambule.
// Les valeurs numériques sont interpolées telles quelles ("32", pas "trente-deux") :
// la synthèse vocale prononce les chiffres correctement en français, pas besoin
// de les épeler ici.

function formatListeFr(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ou ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ou ${items[items.length - 1]}`;
}

// Un nombre dit à voix haute en français : virgule décimale, et pas de
// décimale inutile ("6" plutôt que "6,0").
function nombreFr(valeur) {
  return (Math.round(valeur * 10) / 10).toString().replace('.', ',');
}

export const templates = {
  // surDix : true pour une lecture sonde dictée sur l'échelle 0–10 du cadran ;
  // false pour un pourcentage (capteur wh51, ou sonde dictée explicitement en %).
  lecture: (surDix, valeur) => (surDix ? `${valeur} sur dix` : `${valeur} pour cent`),
  // La plage cible, demandée explicitement par l'utilisateur : sans elle, la
  // réponse dit quoi faire mais jamais pourquoi, et il n'a aucun moyen de
  // juger si le verdict est plausible. Exprimée sur la MÊME échelle que la
  // lecture qu'elle accompagne — annoncer « 6 sur dix, cible 30 à 45 »
  // mélangerait deux échelles et ne voudrait rien dire.
  cible: (surDix, min, max) =>
    surDix
      ? `cible ${nombreFr(min / 10)} à ${nombreFr(max / 10)}`
      : `cible ${nombreFr(min)} à ${nombreFr(max)}`,
  nePasArroser: () => 'Ne pas arroser.',
  bientot: () => 'Bientôt. Revérifie dans quelques jours.',
  arroserDose: (dose) => `Arroser ${dose}.`,
  arroserRuissellement: () => "Arroser jusqu'au ruissellement, puis vider la soucoupe.",
  ambiguite: (pieces) => `${formatListeFr(pieces)} ?`,
  nonReconnu: () => "Je n'ai pas reconnu. Répète.",
  horsLimite: () => 'Valeur surprenante. Confirme le chiffre.',
  capteurIndisponible: () => 'Pas de lecture capteur pour cette plante.',
};
