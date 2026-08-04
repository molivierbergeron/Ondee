import { computeVerdict, buildResponse } from './logic.js';
import { templates } from './templates.js';

// --- Proxy Cloudflare Worker (section 5.4 du brief) ---
// SHARED_TOKEN est volontairement visible côté client (le brief l'accepte
// pour un produit personnel) ; c'est GEMINI_API_KEY, connu seulement du
// Worker, qui protège réellement l'accès à Gemini.
const WORKER_URL = 'https://ondee-proxy.mo-bergeron.workers.dev';
const SHARED_TOKEN = 'c31c2a2a9f543b6c260853699730e8589e5d8c0bf677096b';

// --- Constantes VAD (à calibrer sur l'appareil réel — voir section 9.2 du brief) ---
const ENERGY_THRESHOLD = 0.02;      // RMS (0–1) au-delà duquel on considère qu'un énoncé commence
// L'enregistrement ne démarrait qu'une fois ENERGY_THRESHOLD franchi, donc
// après l'attaque du mot : une consonne sourde ("c" de "cuisine") passe sous
// le seuil pendant 100–200 ms et se retrouvait coupée. Sur une phrase, sans
// importance ; sur une réponse d'un seul mot — exactement le cas de la
// désambiguïsation — il ne reste plus grand-chose à reconnaître. On arme donc
// le magnétophone bien plus bas, et on décide seulement après coup si ce qui
// a été capté était un vrai énoncé ou du bruit à jeter.
const ENERGY_PREARM_THRESHOLD = 0.008;
const PREARM_MAX_WAIT_MS = 700;     // sans franchissement du vrai seuil dans ce délai, c'était du bruit
const SILENCE_DURATION_MS = 1200;   // silence continu requis pour clore un énoncé
const MIN_UTTERANCE_MS = 200;       // ignore les pics trop courts (bruit, frottement) — assez bas pour ne pas avaler une réponse d'un mot ("bureau", "répète")
const ENERGY_BLOCK_SAMPLES = 512;   // taille du bloc RMS calculé côté thread audio (plus petit = barre plus réactive)

// L'événement 'end' de speechSynthesis ne se déclenche pas de façon fiable
// sur iOS quand un micro est actif en parallèle (bug WebKit connu). On
// estime donc la durée de parole à partir du texte plutôt que d'attendre
// cet événement — il ne sert plus que de raccourci si jamais il se déclenche.
const SPEECH_CHARS_PER_SECOND = 13; // ~130 mots/min, rythme d'élocution FR normal
const SPEECH_BASE_OVERHEAD_MS = 300; // latence de démarrage de la synthèse
const SPEECH_TRAIL_BUFFER_MS = 200;  // marge avant de rouvrir l'écoute, pour ne pas capter la fin de sa propre voix
const SPEECH_MAX_MS = 6000;          // plafond de sécurité si le texte est anormalement long

// Le calcul d'énergie tourne dans un AudioWorklet (thread audio), pas dans
// requestAnimationFrame : rAF s'arrête complètement dès que la page n'est
// plus au premier plan (écran verrouillé, app changée), ce qui gelait toute
// la boucle de décision VAD. Le thread audio, lui, continue.
const VAD_WORKLET_SOURCE = `
class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sumSquares = 0;
    this.count = 0;
    this.blockTarget = ${ENERGY_BLOCK_SAMPLES};
  }
  process(inputs) {
    const channel = inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.sumSquares += channel[i] * channel[i];
        this.count++;
      }
      if (this.count >= this.blockTarget) {
        this.port.postMessage(Math.sqrt(this.sumSquares / this.count));
        this.sumSquares = 0;
        this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('vad-processor', VadProcessor);
`;

const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || 'inconnue';
document.getElementById('version-tag').textContent = `v${APP_VERSION}`;

const startBtn = document.getElementById('start-btn');
const statusSection = document.getElementById('status');
const statusWakelock = document.getElementById('status-wakelock');
const statusMic = document.getElementById('status-mic');
const statusVad = document.getElementById('status-vad');
const energyFill = document.getElementById('energy-fill');
const energyThresholdMarker = document.getElementById('energy-threshold-marker');
const log = document.getElementById('log');
const refreshBtn = document.getElementById('refresh-btn');
const stopBtn = document.getElementById('stop-btn');
const statusVoice = document.getElementById('status-voice');
const testVoiceBtn = document.getElementById('test-voice-btn');
const lastResponseEl = document.getElementById('last-response');
const etatPrincipal = document.getElementById('etat-principal');
const etatTexte = document.getElementById('etat-texte');
const etatPoint = document.getElementById('etat-point');

// Vocabulaire technique -> phrase calme affichée en gros. Le détail
// technique (état exact, wake lock, micro…) reste dans <details>, replié
// par défaut — utile en test, pas nécessaire en usage mains libres normal.
const ETAT_FR = {
  'écoute…': 'À l’écoute',
  'traitement…': 'Je réfléchis…',
  'réponse…': 'Je réponds…',
  'en attente…': 'Prêt',
  'arrêté': 'Session arrêtée',
};

function setEtat(text, kind) {
  setStatus(statusVad, text, kind);
  etatTexte.textContent = ETAT_FR[text] || text;
  etatPoint.className = 'etat-point';
  if (kind) etatPoint.classList.add(kind);
  etatPoint.classList.toggle('pulse', text === 'écoute…');
}

energyThresholdMarker.style.left = `${ENERGY_THRESHOLD * 100}%`;

let wakeLock = null;
let audioCtx = null;
let vadNode = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recording = false;
let silenceStartedAt = null;
let utteranceStartedAt = null;
let armed = false;              // magnétophone démarré, énoncé pas encore confirmé
let armedAt = null;
let rearmBlocked = false;       // attend un retour sous le seuil bas avant de réarmer
let discardingRecording = false; // ce 'stop' ferme du bruit, pas un énoncé
let ttsSpeaking = false;
let ttsWatchdogId = null;
let frenchVoice = null;
let currentUtterance = null; // référence forte : évite le GC prématuré qui empêche 'end' de se déclencher (bug WebKit connu)
let processing = false; // true pendant l'appel au Worker, pour ne pas démarrer un nouvel enregistrement par-dessus
let lastSpokenText = null; // pour la commande "répète" (rejouée sans appel API, section 5.2)
let plants = [];
let sensorReadings = {}; // capteur_id -> valeur, chargé une fois au démarrage (section 6)

// Tour de désambiguïsation en attente : { candidateIds, valeur } le temps
// d'un seul énoncé de réponse ("bureau", "le lyre"...), puis réinitialisé
// que ça résolve ou non — pas de relance en boucle.
let pendingDisambiguation = null;

function findPlant(id) {
  return plants.find((p) => p.id === id);
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.classList.remove('ok', 'error');
  if (kind) el.classList.add(kind);
}

function addLogEntry(label, detail) {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString('fr-CA', { hour12: false });
  li.innerHTML = `<span>${label}</span><span>${detail} · ${time}</span>`;
  log.prepend(li);
  log.hidden = false;
}

// --- Wake Lock ---
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) {
    setStatus(statusWakelock, 'non supporté', 'error');
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    setStatus(statusWakelock, 'actif', 'ok');
    wakeLock.addEventListener('release', () => {
      setStatus(statusWakelock, 'libéré', 'error');
    });
  } catch (err) {
    setStatus(statusWakelock, `échec: ${err.message}`, 'error');
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await acquireWakeLock();
  }
});

// --- Voix française pour la synthèse vocale ---
function pickFrenchVoice() {
  const voices = speechSynthesis.getVoices();
  frenchVoice = voices.find(v => v.lang.startsWith('fr')) || null;
}
speechSynthesis.addEventListener('voiceschanged', pickFrenchVoice);

// Chaque appel à speak() incrémente ce compteur ; les handlers d'un énoncé
// capturent leur génération et se taisent si une autre a démarré depuis.
// Sans ça, le 'end' d'un énoncé qu'on vient d'annuler venait refermer l'état
// de son remplaçant, à peine commencé.
let ttsGeneration = 0;

function endTtsSpeaking(generation) {
  if (generation !== ttsGeneration) return;
  ttsSpeaking = false;
  currentUtterance = null;
  if (ttsWatchdogId !== null) {
    clearTimeout(ttsWatchdogId);
    ttsWatchdogId = null;
  }
  setEtat('en attente…', null);
}

function estimateSpeechDurationMs(text) {
  const estimate = SPEECH_BASE_OVERHEAD_MS + (text.length / SPEECH_CHARS_PER_SECOND) * 1000 + SPEECH_TRAIL_BUFFER_MS;
  return Math.min(estimate, SPEECH_MAX_MS);
}

// Le silence total rapporté en test réel a trois causes possibles qu'aucune
// relecture de code ne permet de départager sans l'appareil. On traite les
// trois d'un coup, et on ajoute un témoin (ligne « Voix ») qui, lui, permet
// de trancher au prochain test :
//   1. cancel() suivi immédiatement de speak() : WebKit laisse sa file dans
//      un état intermédiaire et avale l'énoncé suivant. C'est le seul écart
//      entre le code d'ici et celui de la Phase 0, qui était audible.
//   2. Session audio iOS : une fois getUserMedia actif, la sortie de la
//      synthèse peut être coupée. On amorce donc la synthèse à l'intérieur
//      même du geste « Démarrer », avant tout await et avant le micro.
//   3. Interrupteur silencieux / volume à zéro : indistinguable d'un bug JS
//      sans témoin. Si 'start' se déclenche mais qu'on n'entend rien, c'est
//      cette piste-là ; si 'start' ne se déclenche jamais, c'est l'API.
function speakNow(text, generation) {
  const utterance = new SpeechSynthesisUtterance(text);
  if (frenchVoice) utterance.voice = frenchVoice;
  utterance.lang = 'fr-FR';
  currentUtterance = utterance; // sans cette référence, WebKit peut GC l'objet et ne jamais émettre 'end'

  utterance.addEventListener('start', () => {
    setStatus(statusVoice, frenchVoice ? `parle · ${frenchVoice.name}` : 'parle · voix par défaut', 'ok');
  });
  utterance.addEventListener('end', () => endTtsSpeaking(generation));
  utterance.addEventListener('error', (event) => {
    const raison = event.error || 'inconnue';
    setStatus(statusVoice, `erreur: ${raison}`, 'error');
    addLogEntry('Voix', `erreur: ${raison}`);
    endTtsSpeaking(generation);
  });

  speechSynthesis.resume(); // iOS laisse parfois la file en pause après un changement d'app
  speechSynthesis.speak(utterance);

  // Si ni 'start' ni speechSynthesis.speaking après une seconde, l'API n'a
  // rien lancé du tout — ce n'est alors pas une question de volume.
  setTimeout(() => {
    if (generation !== ttsGeneration) return;
    if (!speechSynthesis.speaking && !speechSynthesis.pending) {
      setStatus(statusVoice, 'aucun son émis par l’API', 'error');
      addLogEntry('Voix', 'speak() sans effet');
    }
  }, 1000);
}

function speak(text) {
  lastSpokenText = text;
  lastResponseEl.textContent = text;
  lastResponseEl.hidden = false;

  const generation = ++ttsGeneration;
  ttsSpeaking = true;
  setEtat('réponse…', null);
  // 'end'/'error' servent de raccourci s'ils se déclenchent, mais le timer
  // estimé ci-dessous est ce qui referme réellement l'état dans la majorité
  // des cas — voir la note sur la fiabilité de 'end' plus haut.
  if (ttsWatchdogId !== null) clearTimeout(ttsWatchdogId);
  ttsWatchdogId = setTimeout(() => endTtsSpeaking(generation), estimateSpeechDurationMs(text));

  if (speechSynthesis.speaking || speechSynthesis.pending) {
    // On ne coupe que s'il y a vraiment quelque chose à couper, et on laisse
    // un tour de boucle à WebKit pour vider sa file avant de reparler.
    speechSynthesis.cancel();
    setTimeout(() => speakNow(text, generation), 0);
  } else {
    speakNow(text, generation);
  }
}

// --- Micro + VAD par énergie ---
async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  setStatus(statusMic, 'actif', 'ok');

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const workletBlob = new Blob([VAD_WORKLET_SOURCE], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(workletBlob);
  await audioCtx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  const source = audioCtx.createMediaStreamSource(micStream);
  vadNode = new AudioWorkletNode(audioCtx, 'vad-processor');
  source.connect(vadNode);

  // Certains moteurs (Safari) ne maintiennent le traitement du worklet que
  // si son graphe rejoint la destination ; on le fait à volume nul.
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  vadNode.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  vadNode.port.onmessage = (event) => handleEnergyReading(event.data);

  mediaRecorder = new MediaRecorder(micStream);
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.addEventListener('stop', onUtteranceComplete);
}

// Arrête tout ce que startMic()/acquireWakeLock() ont ouvert : le brief
// prévoyait "terminer = fermer la page" (section 2), mais en usage réel il
// faut un moyen de couper le micro sans recharger toute la session.
async function stopSession() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.removeEventListener('stop', onUtteranceComplete);
    mediaRecorder.stop();
  }
  mediaRecorder = null;

  speechSynthesis.cancel();
  if (ttsWatchdogId !== null) {
    clearTimeout(ttsWatchdogId);
    ttsWatchdogId = null;
  }

  if (vadNode) {
    vadNode.port.onmessage = null;
    vadNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (audioCtx) {
    await audioCtx.close();
    audioCtx = null;
  }
  if (wakeLock) {
    const lock = wakeLock;
    wakeLock = null; // avant release() : évite que le handler visibilitychange ne le rallume
    await lock.release();
  }

  ttsGeneration++; // neutralise les handlers de l'énoncé en cours
  ttsSpeaking = false;
  processing = false;
  recording = false;
  armed = false;
  rearmBlocked = false;
  discardingRecording = false;
  pendingDisambiguation = null;

  setStatus(statusMic, 'arrêté', null);
  setEtat('arrêté', null);
  energyFill.style.width = '0%';
  stopBtn.hidden = true;
  refreshBtn.hidden = true;
  startBtn.disabled = false;
  startBtn.textContent = 'Démarrer';
}

function handleEnergyReading(rms) {
  energyFill.style.width = `${Math.min(rms / (ENERGY_THRESHOLD * 4), 1) * 100}%`;

  if (ttsSpeaking || processing) return;

  const aboveThreshold = rms > ENERGY_THRESHOLD;
  const abovePrearm = rms > ENERGY_PREARM_THRESHOLD;

  if (recording) {
    if (aboveThreshold) {
      silenceStartedAt = null;
    } else if (silenceStartedAt === null) {
      silenceStartedAt = performance.now();
    } else if (performance.now() - silenceStartedAt >= SILENCE_DURATION_MS) {
      endUtterance();
    }
    return;
  }

  // Le réarmement attend un vrai retour au calme : sans ça, un bruit de fond
  // stable juste au-dessus du seuil bas ferait démarrer/arrêter le
  // magnétophone en boucle pendant toute la tournée.
  if (!abovePrearm) {
    rearmBlocked = false;
  }

  if (!armed && abovePrearm && !rearmBlocked) {
    armRecorder();
  } else if (armed && aboveThreshold) {
    confirmUtterance();
  } else if (armed && performance.now() - armedAt >= PREARM_MAX_WAIT_MS) {
    discardArmedRecording();
  }
}

function armRecorder() {
  if (!mediaRecorder || mediaRecorder.state !== 'inactive') return;
  armed = true;
  armedAt = performance.now();
  discardingRecording = false;
  recordedChunks = [];
  mediaRecorder.start();
}

// L'énoncé a franchi le vrai seuil : ce qui est déjà dans le tampon depuis
// l'armement en fait partie, attaque du premier mot comprise.
function confirmUtterance() {
  armed = false;
  recording = true;
  silenceStartedAt = null;
  utteranceStartedAt = performance.now();
  setEtat('écoute…', 'ok');
}

// Bruit : on ferme sans rien envoyer. Le 'stop' déclenche quand même
// onUtteranceComplete, d'où le drapeau qu'il y consulte.
function discardArmedRecording() {
  armed = false;
  rearmBlocked = true;
  discardingRecording = true;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function endUtterance() {
  recording = false;
  silenceStartedAt = null;
  mediaRecorder.stop();
}

async function comprendreUtterance(blob, mimeType, candidateIds) {
  const url = new URL(`${WORKER_URL}/comprendre`);
  if (candidateIds) {
    url.searchParams.set('candidats', candidateIds.join(','));
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SHARED_TOKEN}`,
      'Content-Type': mimeType,
    },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`Worker : ${response.status}`);
  }
  return response.json();
}

function resoudrePlante(result, valeurDeSecours, pourcentageDeSecours) {
  const plant = findPlant(result.plante_id);
  if (!plant) {
    speak(templates.nonReconnu());
    return;
  }

  // Pour une plante à capteur (wh51), la lecture vient de la session Ecowitt
  // chargée au démarrage, pas de l'énoncé — l'utilisateur ne dit qu'un nom.
  const estWh51 = plant.source === 'wh51';
  const valeur = estWh51 && plant.capteur_id
    ? sensorReadings[plant.capteur_id] ?? result.valeur ?? valeurDeSecours
    : result.valeur ?? valeurDeSecours;
  // "sonde" dicte normalement sur l'échelle 0-10 du cadran, mais l'utilisateur
  // peut aussi donner un pourcentage explicitement ("22%") — Gemini le signale.
  const pourcentageExplicite = result.pourcentage ?? pourcentageDeSecours;

  if (typeof valeur !== 'number' || Number.isNaN(valeur)) {
    speak(estWh51 ? `${plant.nom}. ${templates.capteurIndisponible()}` : templates.nonReconnu());
    return;
  }

  const verdict = computeVerdict({
    source: plant.source,
    valeur,
    humiditeMin: plant.humidite_min,
    taillePot: plant.taille_pot,
    regime: plant.regime,
    pourcentageExplicite,
  });
  const response = buildResponse({ source: plant.source, valeur, verdict, pourcentageExplicite });
  // Le nom est annoncé en premier : sans ça, en mains libres, aucun moyen de
  // détecter que Gemini a identifié la mauvaise plante avant d'arroser.
  addLogEntry(plant.nom, response);
  speak(`${plant.nom}. ${response}`);
}

// resolvingDisambiguation : cet énoncé répondait à "Salon, chambre, ou
// bureau ?" — le tour de désambiguïsation se termine ici quoi qu'il arrive
// (résolu ou pas), pas de relance automatique en boucle.
function handleResult(result, resolvingDisambiguation) {
  // Diagnostic uniquement : le Worker peut joindre "erreur" (Gemini en échec,
  // JSON invalide, quota…) même quand plante_id est null — on ne le dit pas
  // à voix haute (resterait "je n'ai pas reconnu"), mais on le journalise
  // pour ne plus confondre un vrai bug avec une non-reconnaissance normale.
  if (result.erreur) {
    addLogEntry('Erreur Worker', result.erreur);
  }

  // Ce que Gemini a cru entendre, mot à mot. Sans ça, un échec est une boîte
  // noire : impossible de savoir si le nom a été mal entendu ou bien entendu
  // puis mal associé — deux bugs opposés qui se corrigent à deux endroits
  // différents. C'est la première chose à regarder dans le journal.
  if (result.transcription) {
    addLogEntry('Entendu', `« ${result.transcription} »`);
  }

  if (result.commande === 'repete') {
    speak(lastSpokenText || templates.nonReconnu());
    return; // garde pendingDisambiguation intact : "répète" ne consomme pas le tour
  }

  const valeurDeSecours = resolvingDisambiguation ? pendingDisambiguation.valeur : undefined;
  const pourcentageDeSecours = resolvingDisambiguation ? pendingDisambiguation.pourcentage : undefined;
  if (resolvingDisambiguation) {
    pendingDisambiguation = null;
  }

  if (result.plante_id == null) {
    if (!resolvingDisambiguation && Array.isArray(result.ambigus)) {
      // Les id renvoyés sont filtrés contre plants.json avant tout : un id
      // inventé ajoutait sinon une option fantôme à la question posée, sans
      // qu'aucune réponse ne puisse jamais y correspondre.
      const proposes = [...new Set(result.ambigus)];
      const candidats = proposes.map(findPlant).filter(Boolean);
      if (candidats.length !== proposes.length) {
        addLogEntry('Ambiguïté', `id inconnus ignorés : ${JSON.stringify(result.ambigus)}`);
      }
      if (candidats.length === 1) {
        // Une seule option réelle : il n'y a plus rien à désambiguïser.
        resoudrePlante({ ...result, plante_id: candidats[0].id }, valeurDeSecours, pourcentageDeSecours);
        return;
      }
      if (candidats.length > 1) {
        // La question se pose par pièce quand les pièces suffisent à
        // distinguer les candidats. Deux plantes de la même pièce donnaient
        // sinon un « Salon ? » auquel aucune réponse ne pouvait trancher.
        const pieces = candidats.map((p) => p.piece);
        const etiquettes = new Set(pieces).size === candidats.length ? pieces : candidats.map((p) => p.nom);
        pendingDisambiguation = {
          candidateIds: candidats.map((p) => p.id),
          valeur: result.valeur,
          pourcentage: result.pourcentage,
        };
        addLogEntry('Ambiguïté', etiquettes.join(' / '));
        speak(templates.ambiguite(etiquettes));
        return;
      }
    }
    speak(templates.nonReconnu());
    return;
  }

  resoudrePlante(result, valeurDeSecours, pourcentageDeSecours);
}

async function onUtteranceComplete() {
  if (discardingRecording) {
    discardingRecording = false;
    recordedChunks = [];
    return;
  }

  const durationMs = performance.now() - utteranceStartedAt - SILENCE_DURATION_MS;

  if (durationMs < MIN_UTTERANCE_MS) {
    setEtat('en attente…', null);
    return;
  }

  const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
  const resolvingDisambiguation = pendingDisambiguation !== null;
  const candidateIds = resolvingDisambiguation ? pendingDisambiguation.candidateIds : null;
  processing = true;
  setEtat('traitement…', null);

  try {
    const result = await comprendreUtterance(blob, mediaRecorder.mimeType, candidateIds);
    handleResult(result, resolvingDisambiguation);
  } catch (err) {
    addLogEntry('Erreur', err.message);
    speak(templates.nonReconnu());
  } finally {
    processing = false;
  }
}

async function loadPlants() {
  const response = await fetch('plants.json');
  plants = await response.json();
}

// Un seul appel au démarrage de la session (section 6) — l'humidité du sol
// évolue sur des heures, pas la peine de recharger à chaque énoncé. Le
// bouton « rafraîchir » permet de le refaire manuellement en cas de doute.
async function loadSensorReadings() {
  try {
    const response = await fetch(`${WORKER_URL}/capteurs`, {
      headers: { Authorization: `Bearer ${SHARED_TOKEN}` },
    });
    if (!response.ok) return;
    const data = await response.json();
    sensorReadings = data.readings || {};
    refreshBtn.hidden = false;
  } catch {
    // Pas bloquant : les plantes wh51 retomberont sur capteurIndisponible().
  }
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  await loadSensorReadings();
  refreshBtn.disabled = false;
});

stopBtn.addEventListener('click', () => {
  stopBtn.disabled = true;
  stopSession().finally(() => {
    stopBtn.disabled = false;
  });
});

// Test du son isolé du reste de la chaîne : une phrase canée, déclenchée par
// un vrai geste utilisateur, sans VAD ni Gemini. Si elle s'entend et qu'un
// énoncé reconnu reste muet, le problème est en aval ; si elle est muette
// elle aussi, il est dans la synthèse et rien d'autre n'est à déboguer.
testVoiceBtn.addEventListener('click', () => {
  statusSection.hidden = false;
  statusSection.open = true; // la ligne « Voix » est le résultat du test
  etatPrincipal.hidden = false;
  pickFrenchVoice();
  speak('Test du son. Si tu entends cette phrase, la voix fonctionne.');
});

// --- Démarrage (geste utilisateur unique) ---
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusSection.hidden = false;
  etatPrincipal.hidden = false;
  setEtat('en attente…', null);
  pickFrenchVoice();

  // Amorçage de la synthèse dans le geste lui-même, avant tout await et avant
  // getUserMedia — la seule fenêtre où iOS l'autorise à coup sûr. Sert aussi
  // de confirmation audible que la session démarre.
  speak('Ondée est prête.');

  await acquireWakeLock();

  try {
    await loadPlants();
    await loadSensorReadings();
    await startMic();
    stopBtn.hidden = false;
  } catch (err) {
    setStatus(statusMic, `échec: ${err.message}`, 'error');
  }

  startBtn.textContent = 'Session en cours';
});
