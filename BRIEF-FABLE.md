# Ondee — brief de reprise à froid

Document autonome. Tu n'as pas besoin de l'historique de la conversation, mais
le dépôt et le `README.md` (section « Phase 6/7 ») contiennent le détail.

Écrit par Opus 5, après deux sessions de correctifs, à la demande de
l'utilisateur qui veut **un deuxième avis, pas une continuation**. Tout ce qui
suit est daté et vérifiable ; là où j'émets un avis, c'est marqué comme tel.
**Le mandat explicite est d'envisager des pistes différentes des miennes.**

---

## 1. Le besoin réel, reformulé par l'utilisateur aujourd'hui

Textuellement, après un test raté :

> « Ce que je veux savoir c'est : c'est quoi la cible pour mes plantes, arrose
> ou pas ? Si je dis "croton", je veux savoir c'est quoi le target pour le
> croton, et si j'arrose, de quelle quantité je dois arroser. »

C'est **plus simple que ce qui a été construit**. Il ne demande ni assistant
conversationnel, ni compréhension du langage naturel. Il demande, pour chacune
de ses 20 plantes d'intérieur, pendant qu'il fait sa tournée d'arrosage :

1. la plage d'humidité cible,
2. arroser ou non,
3. si oui, quelle quantité.

Contexte physique, qui contraint beaucoup : il a un humidimètre à sonde dans
une main, une plante devant lui, souvent un arrosoir. D'où l'idée initiale du
mains libres. **Cette prémisse mérite d'être remise en question — voir §7.**

Ses mots sur l'état actuel : *« le produit est hyper décevant »*, *« j'ai le
sentiment qu'on se bute à une technologie qui n'est pas mature pour ça »*.

---

## 2. Les données (stables, fiables, non contestées)

`plants.json` — 20 plantes, chacune avec :

| Champ | Exemple |
|---|---|
| `nom` + `noms_alternatifs` | « Ficus lyre », [« Ficus lyrata », « lyrata »…] |
| `piece` | Cuisine, Salon, Bureau, Chambre de Simone |
| `description` | emplacement + apparence |
| `source` | `wh51` (capteur auto, **6 plantes**) ou `sonde` (dictée, **14 plantes**) |
| `capteur_id` | `soil_ch1`…`soil_ch6` |
| `humidite_min` / `humidite_max` | 35 / 50 |
| `taille_pot`, `regime` | pour calculer la dose |

**Point important et sous-exploité : les 6 plantes `wh51` n'ont besoin
d'aucune entrée vocale.** Leur humidité est déjà connue du serveur, lue via
l'API Ecowitt (`GET /capteurs`, ~0,7 s, fiable, 7 canaux réels confirmés).

La logique de décision (`logic.js`, `templates.js`) est **déterministe, testée,
et n'a jamais causé un bug rapporté** — 30 tests. Elle prend une lecture et
rend un verdict + une dose. Ce n'est pas là qu'est le problème.

---

## 3. L'architecture actuelle

```
iPhone Safari (page statique, GitHub Pages)
  │  micro ouvert en continu
  │  VAD maison : RMS calculé dans un AudioWorklet, seuils d'énergie
  │  MediaRecorder démarre/arrête autour de chaque énoncé détecté
  ▼
Worker Cloudflare  POST /comprendre   (audio brut, ~1-3 s de son)
  ▼
Gemini Flash — un seul appel fait TOUT :
  transcrire + identifier laquelle des 20 plantes + extraire le chiffre
  ▼  JSON strict
logic.js (local, déterministe) → verdict + dose
  ▼
speechSynthesis (voix iOS) lit la réponse
```

Déploiement automatisé (GitHub Actions → Cloudflare) avec smoke test réseau
réel. `npm test` : 46 tests verts.

---

## 4. Ce qui marche, prouvé

- Wake Lock, micro en poche, AirPods, 15 min — validé en usage réel.
- Ecowitt : vraies lectures, 0,7 s, fiable.
- `logic.js` : grille verdict/dose, 30 tests.
- CI/CD : déploiement + smoke test automatiques.
- **Le pipeline complet a fonctionné, au moins une fois.** Extrait du journal
  utilisateur d'aujourd'hui :
  ```
  Entendu              « Calathea White Star »        13:08:09
  Calathea White Star  57 pour cent. Ne pas arroser.  13:08:09
  ```
  Reconnaissance juste, verdict juste. **Le concept n'est pas invalidé.**

---

## 5. Ce qui ne marche pas — le journal d'aujourd'hui, verbatim

Version `v2026-08-04.14`, la plus récente, avec tous les correctifs.

```
Voix           erreur: canceled                                    14:06:55
Erreur Worker  Gemini 400 : {"error":{"code":400,"message":
               "Request contains an invalid argument.",
               "status":"INVALID_ARGUMENT"}}                       14:06:55
VAD débloquée  coincée 22 s                                        13:08:23
Voix           speak() sans effet                                  13:08:10
Voix           erreur: canceled                                    13:08:09
```

Cinq pannes distinctes, en deux minutes d'usage :

| Symptôme | Lecture |
|---|---|
| **Gemini 400 INVALID_ARGUMENT** | Mon hypothèse forte, non vérifiée : **blob audio vide ou quasi vide envoyé**. Le cycle pré-armement peut démarrer et arrêter `MediaRecorder` en < 700 ms sans qu'aucun `dataavailable` ne soit émis → `recordedChunks` vide → `inlineData.data: ""` → 400. **Il n'y a aucun garde-fou sur `blob.size` avant l'envoi.** Correctif probable : 3 lignes. |
| **VAD coincée 22 s** | Mon watchdog l'a débloquée (il fonctionne), mais un drapeau (`processing` ou `ttsSpeaking`) reste bloqué. Cause non identifiée. |
| **`speak() sans effet`** | La synthèse n'a rien lancé. Le son marche parfois, pas toujours. |
| **`erreur: canceled` ×2** | Un énoncé en annule un autre — réponses tronquées. |
| **Voix robotique** | Voix iOS française par défaut. Voir §8, il y a un gain gratuit. |

Et le reproche le plus constant de l'utilisateur : **ça déraille dès la
deuxième plante.** Impossible d'enchaîner une séquence.

---

## 6. Les mesures de latence — le chiffre qui manquait

Mesuré sur un clip **d'une seconde de silence** (donc un plancher absolu, un
vrai énoncé ne fera jamais mieux), depuis un runner GitHub :

| Appel | Durée |
|---|---|
| `POST /comprendre` → Gemini Flash | **2,9 s / 4,6 s / 6,3 s** (3 mesures) |
| `GET /capteurs` → Ecowitt | 0,7 s |

**L'appel Gemini *est* la latence.** La cible du brief d'origine (< 3 s
bout-en-bout) n'est pas atteignable avec lui : il consomme le budget entier,
parfois le double. S'y ajoutaient 1,2 s de détection de fin de parole,
ramenées à 0,8 s.

---

## 7. Ce qui a déjà été essayé et a échoué — **ne pas refaire**

1. **`generationConfig` (`thinkingConfig`, `maxOutputTokens`)** pour réduire la
   latence → **400 INVALID_ARGUMENT en prod**, reverté. Non retenté depuis.
   `responseSchema` + `propertyOrdering` reste une piste, mais **à déployer
   seule**, jamais avec autre chose.

2. **Trois formulations de prompt successives** pour empêcher Gemini
   d'halluciner sur un audio sans parole. Sur un clip **strictement
   silencieux**, il invente une plante avec confiance « haute », à chaque
   fois en recrachant l'exemple le plus récent des instructions :
   ```
   prompt d'origine        → "transcription":"Sansevieria 4."
   + règle « audio muet »  → "transcription":"Ficus lyre"     plante_id 14
   + transcription d'abord → "transcription":"Le croton est à 4."  plante_id 16
   ```
   **Conclusion : le prompt n'est pas un outil fiable contre ça.** Chaque
   consigne ajoutée fournit surtout un nouvel exemple à recracher.

3. **Corriger la VAD maison par réglages successifs.** Chaque correction a
   créé un bug d'état différent : un verrou de réarmement qui ne se levait
   jamais (micro mort pour toute la session), un drapeau de rejet qui avalait
   l'énoncé suivant. **C'est un signal sur l'approche, pas sur les réglages.**

---

## 8. Deux gains immédiats, indépendants de toute décision d'architecture

À faire quelle que soit la direction retenue.

- **Voix robotique → réglage iOS, gratuit.** Réglages → Accessibilité →
  Contenu énoncé → Voix → Français → télécharger une voix **« Améliorée »** ou
  **« Premium »**. `speechSynthesis` la prend automatiquement. Écart de qualité
  considérable, zéro ligne de code.

- **Dire la cible.** L'app dit aujourd'hui « 57 pour cent. Ne pas arroser. »
  L'utilisateur veut entendre la **plage cible** — « Croton, cible 35 à 50, tu
  es à 57, ne pas arroser ». `humidite_min`/`humidite_max` sont déjà dans
  `plants.json` et déjà passés à `logic.js`. **C'est une modification de
  `templates.js`, quelques lignes.** Ça répond directement à sa demande
  explicite, et personne ne l'a fait.

---

## 9. Mon diagnostic — à contester

**Ce n'est pas Gemini le problème. C'est la boucle vocale mains libres dans
Safari iOS.**

Quand ça a marché, ça a bien marché (§4). Ce qui casse systématiquement, c'est
la couche autour : VAD maison à seuils d'énergie, `MediaRecorder`
démarré/arrêté à la volée, `speechSynthesis` qui s'annule ou ne part pas, une
machine à états à cinq drapeaux dont chaque correction crée le bug suivant.
Cinq pannes distinctes en deux minutes (§5), toutes dans cette couche, aucune
dans la logique métier.

Le deuxième problème est que **l'étape la plus fragile est aussi la seule non
testable** : identifier laquelle des 20 plantes. `logic.js` a 30 tests et zéro
bug ; l'identification n'en a aucun, parce que son entrée est de l'audio et sa
sortie vient d'un modèle distant. On ne peut pas écrire « "Ficus lyrata" doit
donner l'id 14 » en test — alors que c'est exactement ce qui a échoué.

**Mon avis (à challenger) :** la piste la plus prometteuse n'est pas
d'améliorer la reconnaissance, mais de **supprimer le besoin de
reconnaissance**. Voir piste C ci-dessous.

---

## 10. Pistes — dont plusieurs que je n'ai pas explorées

Classées par ce qu'elles suppriment, pas par effort.

### A. `webkitSpeechRecognition` au lieu d'envoyer l'audio
Safari iOS expose la reconnaissance vocale d'Apple depuis iOS 14.5. Elle rend
**du texte directement dans le navigateur**, sans upload, sans Gemini, quasi
instantanément. Puis appariement **déterministe** sur `nom` /
`noms_alternatifs` / `piece`.

Supprime d'un coup : la VAD maison, `MediaRecorder`, les seuils d'énergie,
l'upload audio, l'appel Gemini, et l'hallucination (un transcript sans nom de
plante n'apparie rien). Rend l'identification **testable en `npm test`**.

Réserves honnêtes : `continuous` est capricieux sur Safari (tend à s'arrêter
après chaque résultat, il faut le relancer sur `onend`), comportement en
arrière-plan/écran verrouillé à vérifier, qualité sur les noms latins inconnue.
**Je n'ai pas pu le tester — ça mérite un prototype de 30 lignes avant tout
le reste.** À mon sens la piste technique la plus sous-évaluée du dossier.

### B. Changer de fournisseur pour l'audio
Groq Whisper turbo (~300-600 ms pour 3 s), Deepgram (streaming, sub-seconde).
Règle la latence, **pas** la fragilité de la couche navigateur. Coût : un
service et une clé de plus.

### C. Inverser l'interaction — l'app mène la tournée *(ma préférée)*
Au lieu que l'utilisateur nomme la plante, **l'app déroule un itinéraire fixe**
et il ne fait qu'avancer :

> « Calathea White Star, cuisine. 57 %, cible 45 à 60. Ne pas arroser. »
> — *suivant* —
> « Croton, bureau. Cible 35 à 50. Donne-moi la lecture. »
> — *six* —
> « 60 %. Arroser jusqu'au ruissellement. »

Conséquences :
- **L'identification de plante disparaît complètement.** C'est l'étape la plus
  fragile de tout le système, et elle devient sans objet.
- Les **6 plantes à capteur sont entièrement automatiques** — zéro parole.
- Pour les 14 autres, il ne reste qu'à reconnaître **un nombre entre 0 et 10**.
  Passer d'une classification à 20 classes + un nombre, à juste un nombre,
  change l'ordre de grandeur de la fiabilité.
- « suivant » / « répète » / un chiffre : trois intentions au lieu d'un
  langage ouvert.
- L'ordre de la tournée est un vrai gain d'usage (itinéraire par pièce).

Compatible avec A ou B, et même avec un simple bouton.

### D. Assumer le tactile — push-to-talk, ou pas de voix en entrée
Une pression par plante au lieu du micro ouvert. Supprime la VAD entièrement.
Question à poser franchement : **le mains libres est-il vraiment nécessaire ?**
Il tient déjà une sonde et un arrosoir ; il doit de toute façon manipuler la
plante. Une liste tactile qui énonce le verdict au toucher réglerait peut-être
son besoin réel (§1) avec un dixième de la complexité.

### E. Application native
Vraie VAD, vraie TTS, audio en arrière-plan, plus aucune limite Safari.
Coût élevé (Xcode, re-signature tous les 7 jours sans compte développeur —
déjà identifié comme repli dans le brief d'origine).

### F. Images / caméra
Évoqué par l'utilisateur. À mon avis la moins bonne : plus lente que la voix,
et l'identification visuelle entre 3 Ficus ou 3 Pothos est plus dure que par
le nom. Mentionnée pour être complète.

---

## 11. Questions ouvertes pour toi

1. Le **mains libres** est-il une exigence réelle ou une hypothèse de départ
   jamais remise en question ? Tout le coût de complexité vient de là.
2. `webkitSpeechRecognition` sur iOS 18 tient-il la route pour une session de
   15 min ? (piste A — à prototyper, pas à raisonner)
3. L'inversion de l'interaction (piste C) résout-elle le besoin de §1 sans rien
   perdre d'important ?
4. Y a-t-il une lecture des cinq pannes de §5 qui pointe vers une cause unique
   plutôt que cinq bugs séparés ?
5. Le 400 INVALID_ARGUMENT est-il bien un blob vide ? (facile à confirmer :
   journaliser `blob.size` avant l'envoi)
6. **Quelque chose que personne n'a envisagé.** C'est la raison d'être de ce
   document.

---

## 12. Contraintes techniques à connaître

- Cible unique : **iPhone, Safari, PWA**. Pas de multi-plateforme.
- Pas d'accès réseau direct à `*.workers.dev` depuis l'environnement de dev :
  **toute validation réelle du Worker passe par le CI** (`.github/workflows/deploy-worker.yml`,
  smoke test à chaque déploiement, logs lisibles).
- GitHub Pages sert la branche `claude/plant-watering-voice-assistant-yq8f7x`.
  C'est la prod.
- Clés Gemini + Ecowitt : secrets Cloudflare uniquement, jamais dans le dépôt.
- Facturation Gemini activée (le quota gratuit a été épuisé une fois).
- `npm test` : 46 tests. `logic.js` et `plants.json` sont solides — construire
  dessus, pas les refaire.
- Utilisateur **francophone québécois**, tout le produit est en français.

---

## 13. Ce que l'utilisateur attend de cette relecture

Pas un correctif de plus. Il a vu cinq cycles de « ça devrait marcher » suivis
de bugs réels en test vocal, et il a raison d'être méfiant. Il veut savoir
**s'il faut changer d'approche, et laquelle**, avant d'investir davantage.

Une recommandation claire vaut mieux qu'un catalogue d'options. Si ton analyse
contredit la mienne, dis-le franchement — c'est exactement pour ça qu'il te
consulte.
