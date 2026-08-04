// Proxy minimal (section 5.4 du brief) : détient la clé Gemini côté serveur,
// relaie l'audio de la tournée d'arrosage vers Gemini Flash, et ne renvoie au
// client que le JSON strict {plante_id, valeur} (ou ambiguïté / non-reconnu /
// répète). La clé Gemini n'existe que comme secret Cloudflare (GEMINI_API_KEY),
// jamais dans ce fichier ni dans le dépôt.

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

Règles de sortie, JSON strict uniquement, sans texte autour :
- Commande "répète" (ou équivalent proche, ex. "répète ça") : {"commande": "repete"}
- Une seule plante correspond clairement (nom, description visuelle, ou pièce) et une valeur numérique est énoncée : {"plante_id": <id>, "valeur": <nombre>, "confiance": "haute"|"moyenne"}
- Plusieurs plantes correspondent également (ambiguïté réelle, pas un cas limite) : {"plante_id": null, "ambigus": [<id>, <id>, ...]}
- Aucune plante ne correspond, ou la valeur est absente/incompréhensible : {"plante_id": null}

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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/comprendre') {
      return new Response('Not found', { status: 404, headers: corsHeaders(env) });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!env.SHARED_TOKEN || token !== env.SHARED_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders(env) });
    }

    try {
      return await handleComprendre(request, env);
    } catch (err) {
      return jsonResponse({ plante_id: null, erreur: String(err) }, env, 500);
    }
  },
};
