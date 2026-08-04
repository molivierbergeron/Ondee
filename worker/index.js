// Proxy minimal (sections 5.4 et 6 du brief) : détient les clés Gemini et
// Ecowitt côté serveur, relaie l'audio de la tournée d'arrosage vers Gemini
// Flash et les lectures de capteurs sol vers l'API Ecowitt, et ne renvoie au
// client que du JSON. Les clés n'existent que comme secrets Cloudflare
// (GEMINI_API_KEY, ECOWITT_APPLICATION_KEY, ECOWITT_API_KEY), jamais dans ce
// fichier ni dans le dépôt.

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

function jsonResponse(body, env, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}

// Sur un clip silencieux, Gemini s'est mis à recracher les exemples du prompt
// comme s'il les avait entendus ("Cuisine", confiance haute, sur du silence
// pur). En usage réel ça veut dire qu'une toux, une porte ou une voix de fond
// peuvent produire une identification confiante et fausse — donc arroser la
// mauvaise plante sans jamais le dire. Les deux prompts commencent maintenant
// par cette règle, et le smoke test échoue si elle n'est pas respectée.
const REGLE_AUDIO_MUET = `Procède toujours dans cet ordre, sans exception :

1. Écris d'abord "transcription" : ce que tu entends réellement dans l'audio, mot à mot. Si tu n'entends aucune parole intelligible — silence, bruit seul, souffle, musique — écris "transcription": "". N'y écris jamais un mot qui n'a pas été prononcé, et ne va jamais y chercher un nom de plante, de pièce ou d'exemple lu dans ces instructions : elles servent à comprendre l'audio, jamais à le remplacer.
2. Décide ensuite, à partir de cette transcription seule. Si elle est vide, la réponse est {"transcription": "", "plante_id": null} et rien d'autre.

Un audio sans parole n'est pas un cas d'erreur : c'est un cas normal et fréquent (bruit de pas, porte, toux). Le signaler est la bonne réponse, pas un échec.`;

// Exportés uniquement pour worker/prompt.test.js — le Worker lui-même
// n'utilise que l'export default plus bas.
export function describePlant(p) {
  const alias = p.noms_alternatifs?.length ? ` (aussi appelé : ${p.noms_alternatifs.join(', ')})` : '';
  return `- id ${p.id} : ${p.nom}${alias} — ${p.piece} — ${p.description} [${p.source}]`;
}

// Les noms génériques réellement partagés, calculés depuis la liste plutôt
// qu'écrits en dur : la version en dur annonçait "Pothos correspond à 4
// plantes" alors qu'il n'y en a que 3, ce qui invitait Gemini à compter un
// candidat qui n'existe pas.
export function genericNameGroups(plants) {
  const groups = new Map();
  for (const p of plants) {
    const premier = p.nom.split(' ')[0];
    if (!groups.has(premier)) groups.set(premier, []);
    groups.get(premier).push(p);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([nom, list]) => `« ${nom} » correspond à ${list.length} plantes (id ${list.map((p) => p.id).join(', ')})`);
}

export function buildSystemPrompt(plants, candidateIds) {
  const liste = plants.map(describePlant).join('\n');

  if (candidateIds) {
    // Tour de désambiguïsation : l'énoncé précédent avait identifié plusieurs
    // candidats (ex. "Ficus" correspond à 3 plantes) et l'app a demandé de
    // préciser. Cet énoncé-ci est la réponse — courte, souvent un seul mot
    // (nom de pièce, détail visuel) — à faire correspondre à l'un d'eux.
    return `Tu identifies laquelle de ces ${plants.length} plantes l'utilisateur désigne. On vient de lui poser une question de désambiguïsation et cet audio est sa réponse : elle est courte, souvent un seul mot, parfois juste un nom de pièce.

Candidats :
${liste}

${REGLE_AUDIO_MUET}

Comment trancher, quand une réponse est bien prononcée, dans cet ordre :
1. La réponse nomme une pièce qui n'appartient qu'à un seul candidat → c'est ce candidat.
2. La réponse reprend le nom d'un candidat, un de ses noms alternatifs, ou un détail de sa description (couleur, forme, emplacement) → c'est ce candidat.
3. Sinon seulement : {"plante_id": null}.

La liste est déjà réduite aux seuls candidats plausibles et l'utilisateur vient de répondre à la question : dès qu'un seul candidat colle, réponds-le. Ne renvoie null que si la réponse ne désigne vraiment aucun d'eux ou en désigne plusieurs.

Si une valeur numérique est énoncée avec "%" ou "pour cent", ajoute "pourcentage": true.

Règles de sortie, JSON strict uniquement, sans texte autour. "transcription" est toujours le premier champ.
- Rien d'intelligible : {"transcription": "", "plante_id": null}
- Commande "répète" : {"transcription": "...", "commande": "repete"}
- Un candidat correspond : {"transcription": "...", "plante_id": <id>, "valeur": <nombre>|absent si non énoncé, "pourcentage": true|absent, "confiance": "haute"|"moyenne"}
- Aucun candidat ne correspond, ou plusieurs correspondent également : {"transcription": "...", "plante_id": null}

N'invente jamais un id absent de la liste ci-dessus.`;
  }

  return `Tu identifies une plante d'intérieur et extrais une lecture d'humidité à partir d'un énoncé vocal en français, prononcé par une seule personne faisant sa tournée d'arrosage.

Liste des plantes :
${liste}

${REGLE_AUDIO_MUET}

Note sur [wh51] vs [sonde] : les plantes [wh51] ont un capteur automatique —
l'utilisateur ne dit que le nom de la plante, sans chiffre, et c'est normal.
Les plantes [sonde] nécessitent une valeur dictée pour être un identification complète.

Pour une plante [sonde], la valeur est normalement dictée sur l'échelle 0 à
10 du cadran de l'humidimètre (ex. "six" = 6). Mais certains utilisateurs
donnent directement un pourcentage à voix haute (ex. "vingt-deux pour
cent" ou "22%") — dans ce cas, ajoute "pourcentage": true dans la sortie.
Sans "%", ni "pour cent" explicitement énoncé, ne mets pas ce champ (défaut :
échelle 0 à 10).

Les "aussi appelé" sont des synonymes de plein droit — surtout les noms
latins, que l'utilisateur emploie couramment à la place du nom français.
Un nom listé en "aussi appelé" désigne son entrée avec exactement la même
certitude que le nom principal : traite-les à égalité, n'exige jamais le nom
français.

Attention en revanche aux noms génériques réellement partagés par plusieurs
plantes de la liste :
${genericNameGroups(plants).map((g) => `- ${g}`).join('\n')}
Si l'énoncé s'arrête à ce nom générique sans rien qui distingue laquelle,
c'est une ambiguïté à signaler, pas un match à deviner. Mais dès que
l'énoncé ajoute de quoi trancher (nom complet, nom latin, pièce, couleur,
emplacement), il n'y a plus d'ambiguïté : réponds la plante.

Règles de sortie, JSON strict uniquement, sans texte autour. "transcription" est toujours le premier champ, et tout ce qui suit se déduit de lui seul.
- Rien d'intelligible : {"transcription": "", "plante_id": null}
- Commande "répète" (ou équivalent proche) : {"transcription": "...", "commande": "repete"}
- Plante [sonde] identifiée sans ambiguïté (nom précis, nom latin, description visuelle, ou pièce) avec une valeur numérique énoncée : {"transcription": "...", "plante_id": <id>, "valeur": <nombre>, "pourcentage": true|absent, "confiance": "haute"|"moyenne"}
- Plante [wh51] identifiée sans ambiguïté, avec ou sans valeur énoncée : {"transcription": "...", "plante_id": <id>, "confiance": "haute"|"moyenne"} (ajoute "valeur" seulement si un chiffre a été dit)
- Plusieurs plantes correspondent également (nom générique partagé, ou description qui colle à plus d'une) : {"transcription": "...", "plante_id": null, "ambigus": [<id>, <id>, ...], "valeur": <nombre>|absent si non énoncé, "pourcentage": true|absent}
- Aucune plante ne correspond, ou une plante [sonde] est nommée sans valeur : {"transcription": "...", "plante_id": null}

Ne mets dans "ambigus" que des id présents dans la liste ci-dessus, et
seulement ceux qui correspondent vraiment à l'énoncé — jamais de candidat
ajouté par précaution.

Ne devine jamais entre plusieurs plantes qui collent également bien :
préfère l'ambiguïté ou le non-reconnu à une identification au hasard.`;
}

// Filet déterministe, parce que les consignes de prompt ne suffisent pas :
// même en lui interdisant explicitement, Gemini a identifié une plante avec
// confiance « haute » à partir d'un clip strictement silencieux, deux fois de
// suite, en recrachant chaque fois l'exemple le plus récent du prompt. Ce qui
// suit ne se négocie pas avec le modèle.
export function assainirResultat(parsed, plants) {
  const ids = new Set(plants.map((p) => p.id));

  // Une transcription vide et une plante identifiée sont contradictoires :
  // le modèle dit lui-même n'avoir rien entendu. On tranche pour le silence.
  const transcription = typeof parsed.transcription === 'string' ? parsed.transcription.trim() : '';
  if (!transcription) {
    return { transcription: '', plante_id: null, ...(parsed.commande ? { commande: parsed.commande } : {}) };
  }

  const resultat = { ...parsed, transcription };

  if (resultat.plante_id != null && !ids.has(resultat.plante_id)) {
    resultat.erreur = `id inventé : ${resultat.plante_id}`;
    resultat.plante_id = null;
  }
  if (Array.isArray(resultat.ambigus)) {
    resultat.ambigus = [...new Set(resultat.ambigus)].filter((id) => ids.has(id));
    if (resultat.ambigus.length === 0) delete resultat.ambigus;
  }
  return resultat;
}

function base64FromArrayBuffer(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// plants.json est quasi statique (édité à la main, pas par énoncé) — le
// refetcher à chaque tour d'arrosage ajoutait un aller-retour réseau complet
// avant même d'appeler Gemini. Mis en cache en mémoire le temps que
// l'isolate Worker reste chaud (quelques minutes typiquement, largement
// assez pour une tournée de ~15 min).
let plantsCache = null;
let plantsCacheAt = 0;
const PLANTS_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchPlants(env) {
  const now = Date.now();
  if (plantsCache && now - plantsCacheAt < PLANTS_CACHE_TTL_MS) {
    return plantsCache;
  }
  const response = await fetch(env.PLANTS_URL);
  if (!response.ok) {
    throw new Error(`plants.json : ${response.status}`);
  }
  plantsCache = await response.json();
  plantsCacheAt = now;
  return plantsCache;
}

async function handleComprendre(request, env, candidateIds) {
  const mimeType = request.headers.get('Content-Type') || 'audio/webm';

  // Le fetch de plants.json (ou son cache) et la lecture du corps audio sont
  // indépendants — autant les faire en parallèle plutôt qu'en série.
  const [plantsResult, audioBuffer] = await Promise.all([
    fetchPlants(env).catch((err) => ({ erreur: err })),
    request.arrayBuffer(),
  ]);
  if (plantsResult && plantsResult.erreur) {
    return jsonResponse({ plante_id: null, erreur: String(plantsResult.erreur) }, env, 502);
  }

  let plants = plantsResult;
  if (candidateIds) {
    plants = plants.filter((p) => candidateIds.includes(p.id));
  }

  const base64Audio = base64FromArrayBuffer(audioBuffer);

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  const geminiResponse = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt(plants, candidateIds) }] },
      contents: [{ parts: [{ inlineData: { mimeType, data: base64Audio } }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!geminiResponse.ok) {
    const errorBody = await geminiResponse.text();
    return jsonResponse({ plante_id: null, erreur: `Gemini ${geminiResponse.status} : ${errorBody.slice(0, 300)}` }, env);
  }

  const data = await geminiResponse.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const blockReason = data.promptFeedback?.blockReason;
  const finishReason = data.candidates?.[0]?.finishReason;

  if (!text) {
    return jsonResponse({
      plante_id: null,
      erreur: `Pas de texte renvoyé (blockReason=${blockReason ?? 'aucun'}, finishReason=${finishReason ?? 'aucun'})`,
    }, env);
  }

  try {
    const parsed = JSON.parse(text);
    return jsonResponse(assainirResultat(parsed, plants), env);
  } catch {
    return jsonResponse({ plante_id: null, erreur: `JSON invalide reçu : ${text.slice(0, 300)}` }, env);
  }
}

const SOIL_CHANNELS = ['soil_ch1', 'soil_ch2', 'soil_ch3', 'soil_ch4', 'soil_ch5', 'soil_ch6', 'soil_ch7', 'soil_ch8'];

// Forme de réponse de l'API Cloud Ecowitt v3 non confirmée par un appel réel
// dans cette session (documentation officielle inaccessible en recherche) —
// on tente le chemin le plus courant (data.soil_chN.soilmoisture.value) avec
// des chemins de repli, et on ignore silencieusement un canal qu'on ne sait
// pas lire plutôt que de faire échouer toute la lecture. À vérifier au
// premier vrai appel (section "Non testé" du README) et ajuster si besoin.
function extractSoilValue(data, channelKey) {
  const node = data?.data?.[channelKey];
  const raw = node?.soilmoisture?.value ?? node?.soil_moisture?.value ?? node?.value;
  if (raw === undefined || raw === null) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

async function handleCapteurs(env) {
  const url = new URL('https://api.ecowitt.net/api/v3/device/real_time');
  url.searchParams.set('application_key', env.ECOWITT_APPLICATION_KEY);
  url.searchParams.set('api_key', env.ECOWITT_API_KEY);
  url.searchParams.set('mac', env.ECOWITT_MAC);
  url.searchParams.set('call_back', SOIL_CHANNELS.join(','));

  const response = await fetch(url.toString());
  if (!response.ok) {
    return jsonResponse({ readings: {}, erreur: `Ecowitt : ${response.status}` }, env, 502);
  }

  const data = await response.json();
  const readings = {};
  for (const channel of SOIL_CHANNELS) {
    const value = extractSoilValue(data, channel);
    if (value !== null) readings[channel] = value;
  }
  return jsonResponse({ readings }, env);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!env.SHARED_TOKEN || token !== env.SHARED_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders(env) });
    }

    try {
      if (request.method === 'POST' && url.pathname === '/comprendre') {
        const candidatsParam = url.searchParams.get('candidats');
        const candidateIds = candidatsParam
          ? candidatsParam.split(',').map(Number).filter((n) => !Number.isNaN(n))
          : null;
        return await handleComprendre(request, env, candidateIds);
      }
      if (request.method === 'GET' && url.pathname === '/capteurs') {
        return await handleCapteurs(env);
      }
      return new Response('Not found', { status: 404, headers: corsHeaders(env) });
    } catch (err) {
      return jsonResponse({ plante_id: null, erreur: String(err) }, env, 500);
    }
  },
};
