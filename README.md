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

## Phase 1 — Données

`plants.json` structuré à partir de la page Notion « 🌿 Mes plantes — Identification & entretien » (table d'arrosage pratique, 20 plantes d'intérieur — les cèdres extérieurs en pleine terre en sont exclus, hors sujet pour une tournée mains libres en pot).

Mapping direct depuis Notion : `humidite_min`/`humidite_max` = la colonne « Sol cible » (pas « Arroser si ≤ », qui est un second seuil propre à la pratique manuelle de l'utilisateur — la grille du brief a déjà sa propre zone tampon de 5 points intégrée, donc les deux ne doivent pas se cumuler). `source` = 📱→`wh51`, ✋→`sonde`, directement depuis la table « usage quotidien ».

**Décisions restant à confirmer :**

- `capteur_id` est `null` pour les 7 plantes en `wh51` (Pothos hawaïen, Monstera, Ficus pleureur, Ficus lyre, Croton, Plante-araignée, Calathea White Star). La page Notion liste des assignations (« WH51 #1 », « WH51L »…) mais elles ne concordent pas toujours avec la table d'usage quotidien (ex. Calathea lignes roses apparaît en ✋ dans un tableau et en WH51 #2 dans l'autre) — plutôt que deviner le canal `soil_ch1`–`soil_ch8` réel, à confirmer directement dans l'app Ecowitt en Phase 4.
- `taille_pot` dérivé du diamètre de pot en pouces avec un seuil que j'ai choisi moi-même (petit ≤ 5", moyen 6–9", grand ≥ 10"), faute de seuil donné dans le brief. Ajustable si les doses ne semblent pas justes à l'usage.

**`regime` mis à jour d'après description directe de l'utilisateur :** `complet` pour les 16 plantes en double pot (pot en plastique avec trous, posé dans un pot décoratif plus grand — parfois au contact du fond, parfois avec un jeu d'environ 0,5 cm), `mesure` pour les 4 sans ce montage (ZZ, Monstera, Dracaena, Plante-araignée). Point de vigilance non tranché par manque de précision par-plante : sur les pots qui touchent le fond sans jeu, l'eau de ruissellement n'a nulle part où aller — un risque réel pour les succulentes du lot (Sansevieria ×2, Aloe vera, Haworthia, Jade, Gasteria), plus sensibles à la pourriture des racines que les Pothos/Ficus/Calathea/Croton/Hypoestes du même groupe. Si un de ces pots-succulentes est de type « au contact », vaut la peine d'ajouter un petit espaceur (pied de pot, coupelle inversée) plutôt que de compter sur le ruissellement.

`piece` simplifié à un seul mot par pièce (`Cuisine` plutôt que « Cuisine / Salle à manger ») pour matcher le style de désambiguïsation de la section 7 du brief (« Salon, chambre, ou bureau ? »).

## Phase 2 — Logique déterministe

`logic.js` (normalisation, grille verdict/dose de la section 4.2) et `templates.js` (gabarits vocaux de la section 4.3). Tests unitaires sur toute la grille (limites d'écart, dose par taille de pot, régime complet, garde-fou de normalisation) :

```
npm test
```

## Phase 3 — LLM + proxy

`worker/` contient le Worker Cloudflare (`index.js` + `wrangler.toml`) qui détient la clé Gemini côté serveur et relaie l'audio. `app.js` est câblé dessus : chaque énoncé enregistré part vers `${WORKER_URL}/comprendre`, la réponse JSON (`plante_id`/`valeur`, ambiguïté, non-reconnu, ou `répète`) passe par `logic.js` pour le verdict, puis `speak()`.

**La clé Gemini ne va jamais dans le dépôt ni dans le chat** — uniquement dans le secret Cloudflare du Worker. `SHARED_TOKEN`, lui, est volontairement visible côté client (accepté par le brief pour un produit personnel) ; c'est la clé Gemini, connue seulement du Worker, qui protège réellement l'accès à l'API.

## Phase 4 — Ecowitt

Endpoint `GET /capteurs` ajouté au même Worker (section 6 du brief) : appelle `api.ecowitt.net/api/v3/device/real_time` avec les clés Ecowitt côté serveur, renvoie `{ readings: { soil_ch1: 32, ... } }`. `app.js` l'appelle une seule fois au démarrage de la session (l'humidité du sol évolue sur des heures, pas par énoncé) et un bouton discret « rafraîchir les capteurs » permet de le refaire en cas de doute.

Pour une plante `wh51` dont le `capteur_id` est renseigné, la lecture vient de ce cache plutôt que d'un chiffre dicté — l'utilisateur n'a qu'à nommer la plante. Le prompt système envoyé à Gemini distingue déjà les deux cas (voir `buildSystemPrompt` dans `worker/index.js`).

**Ne fonctionnera pour aucune des 7 plantes wh51 tant que leurs `capteur_id` restent à `null`** (voir Phase 1) — en attendant, elles retombent sur `capteurIndisponible()` si aucun chiffre n'est dicté non plus.

### Forme de réponse Ecowitt non confirmée

Je n'ai pas pu vérifier la forme exacte du JSON renvoyé par `real_time` (documentation officielle inaccessible en recherche depuis cette session, plusieurs pages ont renvoyé des 403). Le parsing dans `extractSoilValue()` (`worker/index.js`) suppose `data.data.soil_chN.soilmoisture.value`, avec deux chemins de repli, et ignore silencieusement un canal illisible plutôt que de faire échouer toute la lecture. **À vérifier au premier vrai appel** — si les lectures reviennent vides, c'est probablement là.

## Phase 5 — Finition

- PWA installable : `manifest.json` + icônes (`icon-180.png` pour iOS, `icon-192.png`/`icon-512.png` pour le manifest) — générées localement (feuille simple vert sauge, cohérente avec le style existant), pas de service worker (le brief n'en demande pas — la page a besoin du réseau de toute façon pour l'API).
- Dernière réponse affichée en gros sous le bouton, en plus du journal détaillé.
- Accès guidé et édition du JSON déjà documentés dans ce README (Phase 0 et Phase 1).

## Déploiement du Worker

### Voie recommandée : GitHub Actions (aucun terminal requis)

`.github/workflows/deploy-worker.yml` déploie automatiquement le Worker et met à jour ses 5 secrets à chaque changement dans `worker/`. La seule chose à faire : coller 7 valeurs dans les secrets GitHub du dépôt, une seule fois.

**GitHub → ce dépôt → Settings → Secrets and variables → Actions → New repository secret**, une fois par ligne :

| Nom du secret | Où le trouver |
|---|---|
| `CLOUDFLARE_API_TOKEN` | [dash.cloudflare.com](https://dash.cloudflare.com) → icône profil (en haut à droite) → **My Profile** → **API Tokens** → **Create Token** → modèle **Edit Cloudflare Workers** → Continue → Create Token → copier (affiché une seule fois) |
| `CLOUDFLARE_ACCOUNT_ID` | [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → l'Account ID est affiché dans la colonne de droite |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) |
| `SHARED_TOKEN` | Coller exactement : `c31c2a2a9f543b6c260853699730e8589e5d8c0bf677096b` |
| `ECOWITT_APPLICATION_KEY` | [ecowitt.net](https://www.ecowitt.net) |
| `ECOWITT_API_KEY` | [ecowitt.net](https://www.ecowitt.net) |
| `ECOWITT_MAC` | [ecowitt.net](https://www.ecowitt.net) (adresse MAC de la passerelle) |

Une fois les 7 secrets ajoutés : **GitHub → Actions → Deploy Worker → Run workflow** (bouton à droite) pour déclencher le premier déploiement sans attendre un nouveau push.

Le run affiche l'URL du Worker déployé dans ses logs (ligne du type `https://ondee-proxy.<ton-sous-domaine>.workers.dev`) — donne-la-moi, je la mets dans `WORKER_URL` en tête de `app.js` et je republie.

### Voie alternative : `wrangler` en local

Si un terminal est plus simple pour toi que la page des secrets GitHub :

1. `cd worker && npm install`
2. `npx wrangler login`
3. `npx wrangler deploy`
4. Coller chaque secret au prompt interactif (jamais dans un fichier, jamais dans l'historique) :
   `npx wrangler secret put GEMINI_API_KEY`, puis `SHARED_TOKEN`, `ECOWITT_APPLICATION_KEY`, `ECOWITT_API_KEY`, `ECOWITT_MAC`.
5. Copier l'URL affichée dans `WORKER_URL` en tête de `app.js`, commiter, pousser.

### Non testé

Rien depuis la Phase 2 n'a pu être testé en conditions réelles (pas d'accès à un compte Cloudflare, à une clé Gemini, ni à des clés Ecowitt dans cette session) : ni le format exact attendu par l'API Gemini (modèle `gemini-flash-latest`, `responseMimeType: application/json`), ni celui d'Ecowitt (voir Phase 4), ni la latence bout-en-bout (cible < 3 s, section 9), ni la qualité réelle d'identification par le LLM. À valider comme la Phase 0 — probable itération d'ajustement une fois testé sur l'appareil.
