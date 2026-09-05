/**
 * Marquage partagé — identique dans tous les sites.
 *
 * Tout passe par track() : aucun attribut `data-goatcounter-click` nulle part,
 * parce qu'un attribut ne se réachemine pas vers GA4 le jour où on l'ajoute.
 * Chaque appel porte déjà son objet `props` — GoatCounter l'ignore, GA4 s'en
 * servira sans qu'il faille repasser dans tous les sites.
 *
 * Jamais de nom, d'identifiant ni de texte libre dans un nom d'événement ou
 * dans `props` : les noms sont des étiquettes fixes, en minuscules, de la
 * forme app-action-objet.
 */

// localStorage lève dans certains contextes (Safari en navigation privée,
// iframe sans cookies tiers). Une exception ici casserait le geste de
// l'utilisateur, pas seulement la mesure.
const isOwner = () => {
  try { return !!localStorage.getItem('gc-owner'); } catch { return false; }
};

export function track(name, props = {}) {
  const prefix = isOwner() ? 'owner-' : '';
  // count.js est chargé en `async` : avant son arrivée, `goatcounter.count`
  // n'existe pas encore. Sans ce report, tout événement tiré au chargement
  // — la visite, justement — serait perdu.
  const envoyer = () => window.goatcounter?.count?.({ path: prefix + name, event: true });
  if (window.goatcounter?.count) envoyer();
  else window.addEventListener('load', envoyer, { once: true });
  // Phase 2 (GA4), à activer quand gtag est chargé :
  // window.gtag?.('event', name, { ...props, owner: isOwner() });
}

/**
 * Première visite vs visite de retour, par app, sur un booléen localStorage.
 * Bâti sur track() comme tout le reste.
 */
export function trackVisit(app, props = {}) {
  const cle = `gc-vu-${app}`;
  let dejaVenu = false;
  try {
    dejaVenu = !!localStorage.getItem(cle);
    localStorage.setItem(cle, '1');
  } catch {
    // Stockage refusé : on compte la visite comme une première. Mieux vaut
    // une répétition mal classée qu'une visite qui n'est jamais comptée.
  }
  track(`${app}-visit-${dejaVenu ? 'repeat' : 'first'}`, props);
}

// Les pages dont le script principal n'est pas un module (Foil, Marstoy,
// Recharge) appellent `window.track?.(…)` : même fonction, rien d'autre.
window.track = track;
window.trackVisit = trackVisit;
