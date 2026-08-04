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

**`capteur_id` confirmé** en croisant les canaux réels de la passerelle Ecowitt (Phase 4) avec la liste des capteurs donnée par l'utilisateur : `soil_ch1`→Calathea White Star, `soil_ch2`→Croton, `soil_ch3`→Ficus pleureur (*benjamina*), `soil_ch4`→Ficus lyre (*lyrata*), `soil_ch5`→Pothos hawaïen, `soil_ch6`→Monstera. `soil_ch7` est les cèdres extérieurs, hors sujet, non assigné.

**Correction importante :** Plante-araignée était marquée `wh51` en Phase 1 (c'est ce que disait la table Notion), mais elle n'apparaît dans aucun des 7 canaux réels — son capteur fait partie d'un « 2e vague » de capteurs optionnelle mentionnée dans Notion, jamais installée en pratique. Repassée en `source: sonde` (dictée), sinon elle serait restée bloquée sur « pas de lecture capteur » indéfiniment.

**Décision restant à confirmer :** `taille_pot` dérivé du diamètre de pot en pouces avec un seuil que j'ai choisi moi-même (petit ≤ 5", moyen 6–9", grand ≥ 10"), faute de seuil donné dans le brief. Ajustable si les doses ne semblent pas justes à l'usage.

**`regime` mis à jour d'après description directe de l'utilisateur :** `complet` pour les 16 plantes en double pot (pot en plastique avec trous, posé dans un pot décoratif plus grand — parfois au contact du fond, parfois avec un jeu d'environ 0,5 cm), `mesure` pour les 4 sans ce montage (ZZ, Monstera, Dracaena, Plante-araignée). Point de vigilance non tranché par manque de précision par-plante : sur les pots qui touchent le fond sans jeu, l'eau de ruissellement n'a nulle part où aller — un risque réel pour les succulentes du lot (Sansevieria ×2, Aloe vera, Haworthia, Jade, Gasteria), plus sensibles à la pourriture des racines que les Pothos/Ficus/Calathea/Croton/Hypoestes du même groupe. Si un de ces pots-succulentes est de type « au contact », vaut la peine d'ajouter un petit espaceur (pied de pot, coupelle inversée) plutôt que de compter sur le ruissellement.

`piece` simplifié à un seul mot par pièce (`Cuisine` plutôt que « Cuisine / Salle à manger ») pour matcher le style de désambiguïsation de la section 7 du brief (« Salon, chambre, ou bureau ? »).

## Phase 2 — Logique déterministe

`logic.js` (normalisation, grille verdict/dose de la section 4.2) et `templates.js` (gabarits vocaux de la section 4.3). Tests unitaires sur toute la grille (limites d'écart, dose par taille de pot, régime complet, garde-fou de normalisation) :

```
npm test
```

**Écart avec le brief, ajouté après test réel :** le brief suppose qu'une plante `sonde` est toujours dictée sur l'échelle 0–10 du cadran de l'humidimètre. En pratique, l'utilisateur donne parfois directement un pourcentage à voix haute ("22%"). Gemini détecte maintenant ce cas (champ `pourcentage: true` dans sa réponse quand un "%"/"pour cent" est explicitement énoncé) et `computeVerdict`/`buildResponse` sautent la multiplication ×10 et parlent en pourcentage plutôt qu'en "X sur dix" — voir `pourcentageExplicite` dans `logic.js`. Sans ce signal explicite, le comportement 0–10 par défaut du brief reste inchangé.

## Phase 3 — LLM + proxy

`worker/` contient le Worker Cloudflare (`index.js` + `wrangler.toml`) qui détient la clé Gemini côté serveur et relaie l'audio. `app.js` est câblé dessus : chaque énoncé enregistré part vers `${WORKER_URL}/comprendre`, la réponse JSON (`plante_id`/`valeur`, ambiguïté, non-reconnu, ou `répète`) passe par `logic.js` pour le verdict, puis `speak()`.

**La clé Gemini ne va jamais dans le dépôt ni dans le chat** — uniquement dans le secret Cloudflare du Worker. `SHARED_TOKEN`, lui, est volontairement visible côté client (accepté par le brief pour un produit personnel) ; c'est la clé Gemini, connue seulement du Worker, qui protège réellement l'accès à l'API.

Tuyauterie confirmée par un appel réel (clip silencieux) : auth, clé API, nom de modèle, mode JSON et parsing fonctionnent — Gemini a correctement répondu `{"plante_id": null}` pour du silence. **Ce qui reste non testé : la qualité de reconnaissance sur un vrai énoncé** (nom flou, bruit ambiant, accent) et la latence bout-en-bout réelle — ça ne peut se valider qu'avec une vraie voix sur l'appareil.

## Phase 4 — Ecowitt

Endpoint `GET /capteurs` ajouté au même Worker (section 6 du brief) : appelle `api.ecowitt.net/api/v3/device/real_time` avec les clés Ecowitt côté serveur, renvoie `{ readings: { soil_ch1: 32, ... } }`. `app.js` l'appelle une seule fois au démarrage de la session (l'humidité du sol évolue sur des heures, pas par énoncé) et un bouton discret « rafraîchir les capteurs » permet de le refaire en cas de doute.

Pour une plante `wh51` dont le `capteur_id` est renseigné, la lecture vient de ce cache plutôt que d'un chiffre dicté — l'utilisateur n'a qu'à nommer la plante. Le prompt système envoyé à Gemini distingue déjà les deux cas (voir `buildSystemPrompt` dans `worker/index.js`).

**`capteur_id` maintenant renseigné pour les 6 plantes réellement équipées** (voir Phase 1) — Pothos hawaïen, Monstera, Ficus pleureur, Ficus lyre, Croton, Calathea White Star. Prêt à être testé en conditions réelles.

### Forme de réponse Ecowitt — confirmée

La forme supposée (`data.data.soil_chN.soilmoisture.value`) était la bonne : validée par un vrai appel post-déploiement, 7 canaux actifs (`soil_ch1`–`soil_ch7`) ont renvoyé des lectures réelles (57, 50, 41, 42, 29, 28, 51). `soil_ch7` correspond aux cèdres extérieurs (hors sujet, pas dans `plants.json`) ; les 6 autres sont maintenant assignés à leur plante.

## Phase 5 — Finition

- PWA installable : `manifest.json` + icônes (`icon-180.png` pour iOS, `icon-192.png`/`icon-512.png` pour le manifest) — générées localement (feuille simple vert sauge, cohérente avec le style existant), pas de service worker (le brief n'en demande pas — la page a besoin du réseau de toute façon pour l'API).
- Dernière réponse affichée en gros sous le bouton, en plus du journal détaillé.
- Accès guidé et édition du JSON déjà documentés dans ce README (Phase 0 et Phase 1).

## Phase 6 — Reprise après la première tournée vocale réelle

La première vraie tournée à la voix a échoué sur quatre points. Ce qui suit dit
pour chacun ce qui a été corrigé, et surtout **ce qui est prouvé contre ce qui
n'est qu'une hypothèse plausible** — la distinction a manqué à la session
précédente, où des changements « corrects à la relecture » ont cassé la prod.

### 1. Aucun son, jamais (priorité absolue)

Relire le code n'a pas suffi à trancher, et la comparaison avec la Phase 0 —
seul état confirmé audible — dit quelque chose d'utile : à la Phase 0 aussi,
`speak()` était appelé hors geste utilisateur, donc **l'hypothèse « iOS exige
un geste » n'explique pas à elle seule la régression**. Le seul écart réel
entre les deux versions est le `speechSynthesis.cancel()` ajouté juste avant
`speak()`.

Trois causes restent possibles et aucune n'est distinguable des autres sans
l'appareil. Elles sont donc traitées ensemble :

1. **`cancel()` immédiatement suivi de `speak()`** — WebKit laisse sa file
   dans un état intermédiaire et avale l'énoncé. On ne coupe plus que s'il y a
   vraiment quelque chose à couper, et on laisse alors un tour de boucle avant
   de reparler. *C'est la cause la plus probable : c'est la seule différence
   avec l'état audible connu.*
2. **Session audio iOS** — une fois `getUserMedia` actif, la sortie de la
   synthèse peut être coupée. La synthèse est maintenant amorcée dans le geste
   « Démarrer » lui-même, avant tout `await` et avant le micro (« Ondée est
   prête. »).
3. **Interrupteur silencieux / volume** — Safari respecte l'interrupteur
   physique pour `speechSynthesis`, sans erreur JS. **À vérifier sur le
   téléphone avant tout le reste.**

Et parce qu'aucune de ces trois n'est prouvée, un témoin a été ajouté pour
trancher au prochain test, au lieu de tourner en rond une session de plus :

- **Bouton « Tester le son »**, visible sans démarrer de session : une phrase
  canée, sans VAD ni Gemini. S'il est muet, le problème est dans la synthèse
  et rien d'autre n'est à déboguer.
- **Ligne « Voix »** dans les détails techniques, alimentée par les vrais
  événements :
  - `parle · <nom de voix>` → l'API a bien démarré. Si rien ne s'entend
    malgré ça, c'est le matériel : interrupteur silencieux, volume, ou routage
    AirPods. **Pas un bug JS.**
  - `aucun son émis par l'API` → `speak()` n'a rien lancé du tout. Là c'est
    bien le code (ou iOS qui le bloque), et ce n'est pas une question de
    volume.
  - `erreur: <raison>` → la synthèse a échoué explicitement.

**Statut : non prouvé.** Le silence ne peut être confirmé résolu que par toi,
sur le téléphone. Le témoin est là pour que, s'il persiste, la prochaine
session parte d'un fait et non d'une quatrième hypothèse.

### 2. « Ficus lyrata » jamais reconnu — corrigé, cause confirmée

L'hypothèse du brief de reprise était la bonne : `plants.json` ne contenait que
les noms français (« Ficus lyre »), jamais les noms latins que tu prononces.
Gemini ne pouvait pas faire le lien sans deviner, et le prompt lui interdisait
justement de deviner.

Chaque plante porte maintenant un champ `noms_alternatifs` (nom latin +
synonymes courants), repris dans le prompt sous forme de « aussi appelé », avec
la consigne explicite que **le nom latin vaut le nom français**. Les synonymes
sont volontairement *distinctifs* : « Epipremnum aureum » seul n'est attribué à
aucun Pothos en particulier, sinon un nom d'espèce partagé par trois plantes en
désignerait une seule à tort.

Deux tests verrouillent ça (`worker/prompt.test.js`) : aucun synonyme n'est
partagé par deux plantes, et aucun ne reprend le nom principal d'une autre.

### 3. La « 3e option » du Calathea — cause trouvée

Le prompt annonçait en dur : *« "Pothos" correspond à 4 plantes »*. **Il n'y en
a que 3.** Un décompte faux écrit à la main, jamais remis à jour. Rien ne
garantit que c'est ce que tu as entendu, mais c'était une invitation directe à
compter un candidat qui n'existe pas.

Ces décomptes sont maintenant **calculés depuis `plants.json`** au lieu d'être
écrits en dur, avec un test qui les vérifie. Côté client, les id renvoyés dans
`ambigus` sont filtrés contre `plants.json` avant de poser la question : un id
inventé ajoutait sinon une option fantôme à laquelle aucune réponse ne pouvait
correspondre. S'il ne reste qu'un candidat réel après filtrage, la question
n'est plus posée du tout.

Autre défaut trouvé au passage : la question ne citait que les **pièces**. Deux
plantes de la même pièce donnaient un « Salon ? » indécidable. La question se
pose maintenant par nom de plante dès que les pièces ne suffisent pas à
distinguer les candidats.

### 4. Répondre « cuisine » échouait — deux corrections, aucune prouvée

Le tour de désambiguïsation n'a jamais été confirmé fonctionnel par un vrai
test vocal. Deux causes plausibles, corrigées toutes les deux :

- **L'audio était tronqué.** L'enregistrement ne démarrait qu'une fois
  `ENERGY_THRESHOLD` franchi, donc *après* l'attaque du mot. Une consonne
  sourde — le « c » de « cuisine » — reste sous le seuil 100 à 200 ms et se
  faisait couper. Sur une phrase, sans importance ; sur une réponse d'un seul
  mot, il ne reste plus grand-chose à reconnaître. Le magnétophone s'arme
  maintenant à un seuil bien plus bas (`ENERGY_PREARM_THRESHOLD`) et on décide
  seulement après coup si ce qui a été capté était un énoncé ou du bruit à
  jeter. *Cette correction bénéficie à toute la reconnaissance, pas seulement
  à la désambiguïsation.*
- **Le prompt réduit était trop prudent.** Il héritait du « ne devine jamais »
  du prompt principal alors que la liste est déjà réduite aux candidats et que
  l'utilisateur vient de répondre à la question. Il donne maintenant un ordre
  de résolution explicite (pièce unique → nom/synonyme/détail → null) et dit
  qu'un seul candidat qui colle suffit.

### La correction la plus utile des cinq : voir ce que Gemini a entendu

Gemini renvoie maintenant un champ `transcription` — mot à mot ce qu'il a cru
entendre — journalisé sous « Entendu » à chaque énoncé.

Jusqu'ici un échec était une boîte noire : impossible de savoir si le nom avait
été **mal entendu** (problème d'audio : VAD, micro, troncature) ou **bien
entendu puis mal associé** (problème de prompt ou de données). Ce sont deux
bugs opposés qui se corrigent à deux endroits différents, et deux sessions ont
été passées à deviner lequel des deux était en cause. **C'est la première chose
à regarder dans le journal au prochain test.**

### Hallucination sur audio muet — constat, pas correction

Sur le clip **strictement silencieux** du smoke test, Gemini invente une plante
avec confiance « haute ». Trois formulations de prompt successives, trois
hallucinations, chaque fois en recrachant l'exemple le plus récent des
instructions :

```
prompt d'origine        → {"ambigus":[1,2],"valeur":4,"transcription":"Sansevieria 4."}
+ règle « audio muet »  → {"plante_id":14,"confiance":"haute","transcription":"Ficus lyre"}
+ transcription d'abord → {"plante_id":16,"valeur":4,"confiance":"haute",
                           "transcription":"Le croton est à 4."}
```

« Sansevieria » venait de la liste des noms génériques, « Ficus lyre » de
l'exemple sur les noms latins, « Croton » du prompt d'après. **Le prompt n'est
pas le bon outil contre ça** — chaque consigne ajoutée fournit surtout un
nouvel exemple à recracher. J'ai arrêté après trois essais plutôt que de
continuer à en écrire un quatrième.

**Portée réelle, à ne pas surestimer :** `silence.wav` n'est pas une entrée que
l'app produit. La VAD n'envoie un clip qu'après franchissement d'un seuil
d'énergie, donc jamais du silence pur. Le vrai risque équivalent est un audio
qui a de l'énergie mais pas de nom de plante — une toux, une porte, la
télévision — qui donnerait alors une identification confiante et fausse.

**Ce qui protège aujourd'hui**, par ordre d'efficacité :

1. Le nom de la plante est **annoncé à voix haute avant le verdict**
   (« Croton. 4 sur dix… »). En mains libres, c'est ce qui permet d'entendre
   que l'identification est fausse avant d'arroser. Cette annonce, ajoutée à
   une session précédente, prend ici toute son importance.
2. `assainirResultat()` dans le Worker : un `plante_id` absent de
   `plants.json` est rejeté, un `ambigus` inventé est filtré, et une
   transcription vide force `plante_id` à null. Du code, pas une consigne.
3. La VAD, qui n'envoie pas d'audio sans énergie.

**Ce qui le corrigerait vraiment** est architectural, pas cosmétique : avec une
transcription d'abord et un appariement déterministe ensuite (voir plus bas),
un transcript qui ne contient aucun nom de plante ne peut mécaniquement rien
apparier. Il n'y a pas de place où halluciner.

**Une piste non essayée, volontairement :** `generationConfig.responseSchema`
avec `propertyOrdering` imposerait l'ordre des champs bien plus fermement que
du texte — le modèle a ignoré ma demande de mettre `transcription` en premier.
C'est exactement la famille de changement (`generationConfig`) qui a cassé la
prod à la session précédente, donc elle doit être déployée **seule**, vérifiée
par le smoke test, avant d'être combinée à quoi que ce soit d'autre. Pas
pendant une session qui livre par ailleurs un correctif urgent.

### Ce que le smoke test vérifie, et ce qu'il ne fait que signaler

Un check qui échoue pour une raison sur laquelle il n'a aucune prise finit
ignoré ou désactivé. La distinction est donc explicite :

- **Assertions bloquantes** — le contrat du Worker, la partie qu'on contrôle :
  401 sans jeton, `/capteurs` renvoie au moins une lecture, `/comprendre`
  renvoie 200 + JSON parsable + champ `transcription`, et tout `plante_id`
  renvoyé existe dans `plants.json`.
- **Signalé sans bloquer** (`::warning::`) — le clip silencieux qui identifie
  quand même une plante. Visible à chaque déploiement, jamais rouge.

### Couverture de test

`npm test` — 39 tests, dont 9 nouveaux sur le prompt et l'intégrité de
`plants.json` (synonymes non ambigus, décomptes génériques exacts, cohérence
`source`/`capteur_id`). Ils tournent maintenant **sur tout push**
(`.github/workflows/tests.yml`), pas seulement quand `worker/` change :
`plants.json` et `logic.js` cassent la reconnaissance aussi sûrement que le
Worker. Le smoke test réseau réel couvre en plus le chemin
`?candidats=` (désambiguïsation), qui n'était jamais exercé en CI.

Ce que les tests **ne** couvrent pas, et ne peuvent pas couvrir ici : la
synthèse vocale (pas de navigateur en CI), et la reconnaissance sur une vraie
voix (pas d'enregistrement de référence). Ces deux-là ne se valident que sur
l'appareil.

## Phase 7 — après le premier test vocal réussi

**Le son fonctionne.** Confirmé par l'utilisateur sur l'appareil. La correction
la plus probable était la bonne : `cancel()` immédiatement suivi de `speak()`,
seul écart avec la Phase 0 audible. Le témoin (bouton « Tester le son », ligne
« Voix ») reste en place, il ne coûte rien et servira à la prochaine panne.

Deux problèmes rapportés en revanche, tous deux réels.

### Le micro mourait à la deuxième plante — bug introduit par le pré-armement

Régression de ma propre correction précédente. `rearmBlocked` était un
**verrou levé uniquement par un retour de l'énergie sous `ENERGY_PREARM_THRESHOLD`**
(0.008). Téléphone en poche, en marchant, le frottement du tissu maintient le
niveau au-dessus de ce seuil en permanence :

1. Un bruit dépasse le seuil bas → armement.
2. Aucune parole dans les 700 ms → armement jeté, `rearmBlocked = true`.
3. Le niveau ne redescend jamais sous 0.008 → **le verrou ne se lève jamais**.
4. Micro mort pour le reste de la session, sans rien afficher.

En mains libres, c'est le pire mode de panne possible : on parle à une app
morte sans le savoir.

Corrections :

- **Le réarmement attend un délai, plus un seuil** (`PREARM_COOLDOWN_MS`).
  Un délai s'écoule toujours ; un seuil peut ne jamais revenir. Cette classe
  de bug est éliminée, pas juste ce cas-ci.
- `ENERGY_PREARM_THRESHOLD` relevé de 0.008 à **0.012**, au-dessus du bruit de
  poche, pour ne pas s'armer sur du frottement en continu.
- `discardingRecording` n'est plus armé que si `stop()` est réellement appelé.
  Sinon le drapeau restait levé et avalait l'énoncé suivant, bien réel.

### Filet de dernier recours : `unstickVad()`

Ce bug a coûté une tournée entière parce que rien ne le signalait. Plutôt que
de parier sur l'absence d'un autre drapeau coincé, la VAD se remet maintenant
en marche de force si elle reste neutralisée par `ttsSpeaking`/`processing`
plus de 20 s — bien au-delà de tout appel réseau plausible — avec une entrée
au journal. Une session ne peut plus mourir en silence.

Et une ligne **« Détecteur »** affiche en continu `arm0 rec0 proc0 tts0`.
Tant qu'elle bouge, le thread audio vit ; si elle se fige, c'est
l'`AudioContext` qui est mort et non la machine à états — deux pannes
identiques à l'oreille, opposées à corriger.

### Latence : la mesure existe enfin

Les logs du smoke test donnent le chiffre qui manquait, sur un clip **d'une
seconde de silence** (donc plancher absolu, un vrai énoncé ne fera pas mieux) :

| Appel | Durée mesurée |
|---|---|
| `/comprendre` (run 12) | **6,3 s** |
| `/comprendre` (run 15) | **4,6 s** |
| `/comprendre?candidats=` (run 15) | **2,9 s** |
| `/capteurs` (Ecowitt, pour comparaison) | 0,7 s |

**L'appel Gemini est la latence.** Tout le reste est du bruit à côté. La cible
du brief (< 3 s bout-en-bout, section 9) n'est pas atteignable avec cet appel :
il consomme à lui seul le budget entier, et jusqu'à deux fois plus.

Une seule part était récupérable côté client, et elle l'a été :
`SILENCE_DURATION_MS` passe de 1200 à **800 ms**. C'est de la latence pure et
garantie, ajoutée à chaque réponse avant même que la requête ne parte. Presque
une demi-seconde par tour, sans rien changer au modèle.

Le reste ne se corrige pas par réglage. Whisper turbo transcrit un clip de 3 s
en 300–600 ms, et l'appariement déterministe est instantané — soit environ un
ordre de grandeur sous ce qu'on mesure ici. **Ce qui était une hypothèse dans
la recommandation ci-dessous est maintenant appuyé par des mesures.**

## Phase 8 — corrections tirées du journal réel

Cinq pannes distinctes lues dans une capture d'écran du journal utilisateur,
version `v2026-08-04.14`. Toutes dans la couche audio/voix du navigateur,
aucune dans la logique métier — c'est le constat qui a motivé le brief de
reprise (`BRIEF-FABLE.md`).

### `Gemini 400 : INVALID_ARGUMENT`

Deux causes possibles, corrigées toutes les deux parce qu'elles sont
indistinguables depuis le journal :

- **Type MIME avec paramètres de codec.** Safari annonce
  `audio/mp4;codecs=mp4a.40.2`. Relayé tel quel à Gemini comme `mimeType`, ça
  peut ressortir en 400. Seul le type de base est envoyé désormais.
- **Blob audio vide.** Un enregistrement armé puis refermé en moins de 700 ms
  (cycle de pré-armement) peut n'émettre aucun `dataavailable` : le corps part
  vide et Gemini répond 400 au lieu de « rien reconnu ». En dessous de
  `MIN_AUDIO_BYTES`, l'énoncé n'est plus envoyé du tout — un aller-retour de
  moins, et une entrée au journal qui le dit.

### `Voix : erreur: canceled` — la boucle qui se déclenchait elle-même

La fenêtre « la voix parle » était dimensionnée par une **estimation** de la
durée de parole (`estimateSpeechDurationMs`). Quand cette estimation était trop
courte — voix plus lente, phrase plus longue que prévu — la VAD rouvrait
pendant que la synthèse parlait encore :

1. Le micro capte la fin de la propre réponse de l'app.
2. Cet énoncé fantôme part vers Gemini.
3. Sa réponse appelle `speak()`, qui annule la phrase toujours en cours.
4. → `erreur: canceled`, réponse tronquée, appel Gemini gaspillé.

`speechSynthesis.speaking` et `.pending` font maintenant foi **en plus** de
l'estimation. Le cas inverse (`end` qui ne se déclenche jamais, le bug WebKit
qui avait motivé l'estimation) reste couvert par `unstickVad()`, qui annule
désormais aussi la file de synthèse.

### Deuxième voie de « micro mort »

`armRecorder()` refusait d'armer si `mediaRecorder.state !== 'inactive'`, et
repartait en silence. Si un `stop()` se perdait, l'état restait `recording`
pour toujours : plus aucun armement, micro mort — **sans passer par
`ttsSpeaking`/`processing`, donc invisible pour `unstickVad()`**. Le
magnétophone est maintenant refermé de force, avec entrée au journal.

### La plage cible est annoncée

Demande explicite de l'utilisateur : *« si je dis "croton", je veux savoir
c'est quoi le target pour le croton »*. Les données étaient déjà là, jamais
énoncées.

```
avant :  « Calathea White Star. 57 pour cent. Ne pas arroser. »
après :  « Calathea White Star. 57 pour cent, cible 45 à 60. Ne pas arroser. »
```

La cible est ramenée **sur l'échelle de la lecture** : le cadran de
l'humidimètre est gradué 0–10 alors que `plants.json` stocke des pourcentages.
Annoncer « 6 sur dix, cible 45 à 60 » mélangerait deux échelles dans la même
phrase ; c'est « 6 sur dix, cible 4,5 à 6 ». Six tests couvrent les deux
échelles, l'arrondi sans décimale inutile, et le repli quand la cible est
inconnue.

### Voix robotique — réglage appareil, pas code

Réglages → Accessibilité → Contenu énoncé → Voix → Français → télécharger une
voix **« Améliorée »** ou **« Premium »**. `speechSynthesis` la sélectionne
automatiquement. Aucune ligne de code ne peut remplacer ça.

## Est-ce qu'on est sur la bonne voie ? — recommandation

Question posée en ouverture de cette session. Réponse courte : **ce n'est pas
un trou de lapin, mais l'architecture actuelle doit changer sur un point
précis, et pour une raison différente de celle qu'on supposait.**

### Aucun des quatre bugs ne vient de l'architecture

C'est le constat qui devrait rassurer, parce qu'il est vérifiable ligne par
ligne :

| Bug rapporté | Cause réelle | Aurait été identique en STT + LLM ? |
|---|---|---|
| Aucun son | `speechSynthesis` côté client | Oui — sans rapport |
| « Ficus lyrata » | noms latins absents de `plants.json` | Oui — mêmes données manquantes |
| 3e option fantôme | décompte écrit en dur et devenu faux | Oui — même erreur de prompt |
| « cuisine » échoue | audio tronqué à l'attaque du mot | Oui — pire, même |

**Basculer vers le repli STT n'aurait corrigé aucun des quatre.** Le sentiment
de tourner en rond était réel, mais il venait du processus, pas de la
conception : cinq sessions de changements invérifiables sur l'étape la plus
fragile du pipeline, la seule sans aucune couverture de test.

### Le vrai défaut est la testabilité, pas la précision

`logic.js` a 30 tests et n'a jamais causé un bug rapporté. L'identification de
plante en a zéro — non par négligence, mais parce qu'elle n'est **pas
testable** : sa seule entrée est de l'audio, et sa seule sortie vient d'un
modèle distant. « Est-ce que "Ficus lyrata" donne l'id 14 ? » ne peut pas
s'écrire en test, alors que c'est exactement la question qui a fait échouer la
tournée.

L'épisode de l'hallucination sur silence enfonce le clou : trois formulations
de prompt, trois résultats différents, aucun moyen de vérifier lequel est bon
autrement qu'en déployant. C'est un langage de programmation dans lequel on ne
peut ni tester ni raisonner.

### Recommandation : transcription d'abord, appariement déterministe ensuite

Pas le repli du brief tel quel (« STT + LLM texte léger »), mais un cran plus
loin — **retirer le LLM du chemin d'identification** :

1. Audio → texte (Whisper via Groq, ou Gemini en mode transcription seule).
2. Texte → `plante_id` par **appariement déterministe** sur `nom`,
   `noms_alternatifs`, `piece` et `description`, en code local et testé.
3. LLM en second recours uniquement, si l'appariement reste ambigu.

Ce que ça change concrètement :

- **Testable** : cinquante formulations réelles en `npm test`, hors ligne, en
  millisecondes. « lyrata », « le lyre », « celui du bureau » deviennent des
  cas de test, pas des paris.
- **Pas d'hallucination possible** : un transcript sans nom de plante
  n'apparie rien. Le problème disparaît par construction.
- **Probablement plus rapide**, contrairement à ce que supposait la note de
  reprise : Whisper turbo sur un clip de 3 s tourne autour de 300–600 ms, et
  l'appariement est instantané. L'appel actuel envoie l'audio **plus** les 20
  plantes et tout le règlement à chaque énoncé.
- **Débogable** : le transcript est déjà journalisé (« Entendu »), et
  l'appariement devient inspectable pas à pas.

Coût honnête : un service de plus, une clé de plus, et l'appariement flou du
français parlé (liaisons, accents, « le fiscus lira ») est un vrai morceau de
travail — pas une après-midi.

### Séquence recommandée, dans cet ordre

1. **Confirmer le son.** Rien d'autre ne compte tant que le readback est muet.
2. **Une tournée réelle avec le journal « Entendu ».** C'est la donnée qui
   manque depuis le début : les transcriptions sont-elles justes ? Si oui, le
   problème est l'appariement et l'étape 3 est une quasi-certitude. Si non,
   c'est la qualité STT, et il faut comparer Whisper à Gemini sur de vrais
   clips avant de choisir.
3. **Puis seulement** migrer vers l'appariement déterministe, avec ces
   transcriptions réelles comme cas de test.

Migrer avant l'étape 2, ce serait refaire exactement ce qui a coûté les
sessions précédentes : changer l'architecture sur une hypothèse plutôt que sur
une mesure.

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

### État réel après déploiement

Le Worker est déployé et validé par de vrais appels (voir `.github/workflows/deploy-worker.yml`, étape « Vérifier le déploiement », qui tourne à chaque déploiement) :

- `/capteurs` → vraies lectures Ecowitt (7 canaux).
- `/comprendre` → réponse JSON correcte sur un clip silencieux.

**Ce qui reste à valider sur l'appareil, pas depuis un environnement de dev :** la qualité de reconnaissance vocale sur de vrais énoncés (nom flou, bruit ambiant), la latence bout-en-bout ressentie (cible < 3 s, section 9), et — une fois les `capteur_id` renseignés — que la bonne lecture capteur arrive à la bonne plante.
