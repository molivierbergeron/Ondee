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

function buildSystemPrompt(plants) {
  const liste = plants
    .map((p) => `- id ${p.id} : ${p.nom} (${p.piece}) — ${p.description} [${p.source}]`)
    .join('\n');

  return `Tu identifies une plante d'intérieur et extrais une lecture d'humidité à partir d'un énoncé vocal en français, prononcé par une seule personne faisant sa tournée d'arrosage.

Liste des plantes :
${liste}

Note sur [wh51] vs [sonde] : les plantes [wh51] ont un capteur automatique —
l'utilisateur ne dit que le nom de la plante, sans chiffre, et c'est normal.
Les plantes [sonde] nécessitent une valeur dictée pour être un identification complète.

Règles de sortie, JSON strict uniquement, sans texte autour :
- Commande "répète" (ou équivalent proche, ex. "répète ça") : {"commande": "repete"}
- Plante [sonde] identifiée clairement (nom, description visuelle, ou pièce) avec une valeur numérique énoncée : {"plante_id": <id>, "valeur": <nombre>, "confiance": "haute"|"moyenne"}
- Plante [wh51] identifiée clairement, avec ou sans valeur énoncée : {"plante_id": <id>, "confiance": "haute"|"moyenne"} (ajoute "valeur" seulement si un chiffre a été dit)
- Plusieurs plantes correspondent également (ambiguïté réelle, pas un cas limite) : {"plante_id": null, "ambigus": [<id>, <id>, ...]}
- Aucune plante ne correspond, ou une plante [sonde] est nommée sans valeur : {"plante_id": null}

Ne devine jamais une plante en cas de doute : préfère l'ambiguïté ou le non-reconnu à une identification incertaine.`;
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

async function handleComprendre(request, env) {
  const plantsResponse = await fetch(env.PLANTS_URL);
  if (!plantsResponse.ok) {
    return jsonResponse({ plante_id: null }, env, 502);
  }
  const plants = await plantsResponse.json();

  const mimeType = request.headers.get('Content-Type') || 'audio/webm';
  const audioBuffer = await request.arrayBuffer();
  const base64Audio = base64FromArrayBuffer(audioBuffer);

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  const geminiResponse = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt(plants) }] },
      contents: [{ parts: [{ inlineData: { mimeType, data: base64Audio } }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!geminiResponse.ok) {
    return jsonResponse({ plante_id: null }, env);
  }

  const data = await geminiResponse.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  try {
    const parsed = JSON.parse(text);
    return jsonResponse(parsed, env);
  } catch {
    return jsonResponse({ plante_id: null }, env);
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
        return await handleComprendre(request, env);
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
