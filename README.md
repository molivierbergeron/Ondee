# Ondee — Assistant vocal d'arrosage de plantes

Page web unique, mains libres, pour faire la tournée d'arrosage sans toucher le téléphone. Voir le brief complet pour l'architecture et les phases.

## Phase 0 — Test de faisabilité

Cette phase ne fait qu'une chose : vérifier que le trio **Wake Lock + micro en poche + détection d'énoncé (VAD)** tient 15 minutes sur iPhone avec AirPods, avant de construire quoi que ce soit d'autre.

Aucune reconnaissance vocale, aucun appel LLM, aucune base de plantes ici — seulement un bouton, une détection d'énergie sonore, et une voix de test qui confirme chaque énoncé détecté.

### Déployer pour tester

La page doit être servie en HTTPS (`getUserMedia` et `navigator.wakeLock` l'exigent). Le plus simple : activer GitHub Pages sur ce dépôt (Settings → Pages → Deploy from branch) et ouvrir l'URL générée sur l'iPhone.

### Protocole de test (~15 min, téléphone en poche)

1. Ouvrir la page dans Safari sur iPhone, connecter les AirPods.
2. Activer l'**Accès guidé** : triple-clic sur le bouton latéral → Démarrer. (Réglable à l'avance dans Réglages → Accessibilité → Accès guidé.)
3. Appuyer sur **Démarrer** — ce geste unique déclenche à la fois le micro et la synthèse vocale.
4. Mettre le téléphone en poche, écran allumé.
5. Marcher, parler à voix normale par intervalles (phrases de 2 à 5 secondes), et écouter la confirmation vocale après chaque énoncé.
6. Après 15 minutes, sortir de l'Accès guidé (triple-clic + code) et vérifier l'écran : le journal doit lister les énoncés détectés, l'écran doit être resté allumé tout du long.

### Calibrage

Les seuils de détection sont en constantes en tête de `app.js` :

```js
const ENERGY_THRESHOLD = 0.02;      // niveau RMS déclenchant l'enregistrement
const SILENCE_DURATION_MS = 1200;   // silence requis pour clore un énoncé
const MIN_UTTERANCE_MS = 300;       // ignore les bruits trop courts
```

La barre d'énergie affichée à l'écran (avant de mettre le téléphone en poche) aide à voir où se situe la voix par rapport au seuil, pour ajuster `ENERGY_THRESHOLD` si besoin.

### Critères d'acceptation (bloquants pour la suite)

- [ ] Écran reste allumé 15 min sans intervention (Wake Lock tient, y compris après changement d'app / verrouillage)
- [ ] Le micro capte via AirPods, téléphone en poche, sur toute la durée
- [ ] La VAD détecte des énoncés de 2–5 s à voix normale et déclenche la confirmation vocale
- [ ] Zéro toucher accidentel traité (Accès guidé actif)

Si un de ces points échoue (micro coupé, wake lock instable), arrêter et documenter précisément ce qui a échoué — le plan de repli (app native + re-signature) sera arbitré séparément.

### Pièges iOS rencontrés en test réel

Deux comportements Safari non documentés dans le brief, découverts et corrigés pendant les tests sur appareil :

- `requestAnimationFrame` s'arrête complètement quand la page quitte le premier plan (écran verrouillé, app changée) — la boucle VAD tourne maintenant dans un `AudioWorkletNode` (thread audio), qui continue en arrière-plan.
- L'événement `end` de `speechSynthesis` ne se déclenche pas de façon fiable tant qu'un micro est actif en parallèle — la fenêtre « réponse » est maintenant dimensionnée par une estimation de la durée de parole (longueur du texte), pas par cet événement.

Le versioning affiché à l'écran (`v-tag` + `?v=` sur les fichiers) sert à confirmer sur l'appareil qu'on teste bien le dernier build et pas une copie mise en cache par Safari.

## Phase 2 — Logique déterministe

`logic.js` (normalisation, grille verdict/dose de la section 4.2) et `templates.js` (gabarits vocaux de la section 4.3), tous deux non liés à l'interface pour l'instant — le câblage arrive en Phase 3, une fois le LLM capable de fournir `{plante_id, valeur}`.

Tests unitaires sur toute la grille (limites d'écart, dose par taille de pot, régime complet, garde-fou de normalisation) :

```
npm test
```

## Phase 1 — Données

`plants.json` structuré à partir de la page Notion « 🌿 Mes plantes — Identification & entretien » (table d'arrosage pratique, 20 plantes d'intérieur — les cèdres extérieurs en pleine terre en sont exclus, hors sujet pour une tournée mains libres en pot).

Mapping direct depuis Notion : `humidite_min`/`humidite_max` = la colonne « Sol cible » (pas « Arroser si ≤ », qui est un second seuil propre à la pratique manuelle de l'utilisateur — la grille du brief a déjà sa propre zone tampon de 5 points intégrée, donc les deux ne doivent pas se cumuler). `source` = 📱→`wh51`, ✋→`sonde`, directement depuis la table « usage quotidien ».

**Trois décisions prises sans confirmation, à valider :**

- `capteur_id` est `null` pour les 7 plantes en `wh51` (Pothos hawaïen, Monstera, Ficus pleureur, Ficus lyre, Croton, Plante-araignée, Calathea White Star). La page Notion liste des assignations (« WH51 #1 », « WH51L »…) mais elles ne concordent pas toujours avec la table d'usage quotidien (ex. Calathea lignes roses apparaît en ✋ dans un tableau et en WH51 #2 dans l'autre) — plutôt que deviner le canal `soil_ch1`–`soil_ch8` réel, à confirmer directement dans l'app Ecowitt en Phase 4.
- `regime` mis à `mesure` partout par défaut (aucune de ces 20 plantes n'est explicitement documentée comme ayant drainage + soucoupe dans Notion). À corriger si certains pots ont vraiment un système de drainage complet.
- `taille_pot` dérivé du diamètre de pot en pouces avec un seuil que j'ai choisi moi-même (petit ≤ 5", moyen 6–9", grand ≥ 10"), faute de seuil donné dans le brief. Ajustable si les doses ne semblent pas justes à l'usage.

`piece` simplifié à un seul mot par pièce (`Cuisine` plutôt que « Cuisine / Salle à manger ») pour matcher le style de désambiguïsation de la section 7 du brief (« Salon, chambre, ou bureau ? »).

## Phase 3 — LLM + proxy

`worker/` contient le Worker Cloudflare (`index.js` + `wrangler.toml`) qui détient la clé Gemini côté serveur et relaie l'audio. `app.js` est câblé dessus : chaque énoncé enregistré part vers `${WORKER_URL}/comprendre`, la réponse JSON (`plante_id`/`valeur`, ambiguïté, non-reconnu, ou `répète`) passe par `logic.js` pour le verdict, puis `speak()`.

**La clé Gemini ne va jamais dans le dépôt ni dans le chat** — uniquement dans le secret Cloudflare du Worker. `SHARED_TOKEN`, lui, est volontairement visible côté client (accepté par le brief pour un produit personnel) ; c'est la clé Gemini, connue seulement du Worker, qui protège réellement l'accès à l'API.

### Déploiement

1. Obtenir une clé API Gemini sur [Google AI Studio](https://aistudio.google.com/apikey).
2. Dans `worker/wrangler.toml`, remplacer `TON-USERNAME` par le nom d'utilisateur GitHub réel (deux endroits : `ALLOWED_ORIGIN` et `PLANTS_URL`).
3. `cd worker && npm install`
4. `npx wrangler login`
5. `npx wrangler deploy`
6. `npx wrangler secret put GEMINI_API_KEY` — coller la clé au prompt interactif (jamais dans un fichier, jamais dans l'historique de commandes).
7. `npx wrangler secret put SHARED_TOKEN` — coller exactement la même valeur que `SHARED_TOKEN` dans `app.js`.
8. Copier l'URL du Worker affichée par `wrangler deploy` dans `WORKER_URL` en tête de `app.js`, commiter, pousser, republier GitHub Pages.

### Non testé

Contrairement aux Phases 0/1/2, ce câblage n'a pas pu être testé en conditions réelles (pas d'accès à un compte Cloudflare ni à une clé Gemini dans cette session) : ni le format exact attendu par l'API Gemini (modèle `gemini-flash-latest`, `responseMimeType: application/json`), ni la latence bout-en-bout (cible < 3 s, section 9), ni la qualité réelle d'identification par le LLM. À valider comme la Phase 0 — probable itération d'ajustement une fois testé sur l'appareil.

## Phases suivantes

- **Phase 4 — Ecowitt** : nécessite les clés API Ecowitt (`application_key`, `api_key`, `mac`) et la confirmation des `capteur_id` laissés `null` en Phase 1.
- **Phase 5 — Finition** : UI, PWA, README final.
