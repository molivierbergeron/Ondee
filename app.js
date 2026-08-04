import { computeVerdict, buildResponse } from './logic.js';
import { templates } from './templates.js';

// --- Proxy Cloudflare Worker (section 5.4 du brief) ---
// SHARED_TOKEN est volontairement visible côté client (le brief l'accepte
// pour un produit personnel) ; c'est GEMINI_API_KEY, connu seulement du
// Worker, qui protège réellement l'accès à Gemini.
const WORKER_URL = 'https://TON-SOUS-DOMAINE.workers.dev';
const SHARED_TOKEN = 'c31c2a2a9f543b6c260853699730e8589e5d8c0bf677096b';

// --- Constantes VAD (à calibrer sur l'appareil réel — voir section 9.2 du brief) ---
const ENERGY_THRESHOLD = 0.02;      // RMS (0–1) au-delà duquel on considère qu'un énoncé commence
const SILENCE_DURATION_MS = 1200;   // silence continu requis pour clore un énoncé
const MIN_UTTERANCE_MS = 300;       // ignore les pics trop courts (bruit, frottement)
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

energyThresholdMarker.style.left = `${ENERGY_THRESHOLD * 100}%`;

let wakeLock = null;
let audioCtx = null;
let vadNode = null;
let mediaRecorder = null;
let recordedChunks = [];
let recording = false;
let silenceStartedAt = null;
let utteranceStartedAt = null;
let ttsSpeaking = false;
let ttsWatchdogId = null;
let frenchVoice = null;
let currentUtterance = null; // référence forte : évite le GC prématuré qui empêche 'end' de se déclencher (bug WebKit connu)
let processing = false; // true pendant l'appel au Worker, pour ne pas démarrer un nouvel enregistrement par-dessus
let lastSpokenText = null; // pour la commande "répète" (rejouée sans appel API, section 5.2)
let plants = [];

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

function endTtsSpeaking() {
  ttsSpeaking = false;
  currentUtterance = null;
  if (ttsWatchdogId !== null) {
    clearTimeout(ttsWatchdogId);
    ttsWatchdogId = null;
  }
  setStatus(statusVad, 'en attente…', null);
}

function estimateSpeechDurationMs(text) {
  const estimate = SPEECH_BASE_OVERHEAD_MS + (text.length / SPEECH_CHARS_PER_SECOND) * 1000 + SPEECH_TRAIL_BUFFER_MS;
  return Math.min(estimate, SPEECH_MAX_MS);
}

function speak(text) {
  lastSpokenText = text;
  speechSynthesis.cancel(); // vide toute file bloquée d'un essai précédent

  const utterance = new SpeechSynthesisUtterance(text);
  if (frenchVoice) utterance.voice = frenchVoice;
  utterance.lang = 'fr-FR';
  currentUtterance = utterance; // sans cette référence, WebKit peut GC l'objet et ne jamais émettre 'end'
  ttsSpeaking = true;
  setStatus(statusVad, 'réponse…', null);
  // 'end'/'error' servent de raccourci s'ils se déclenchent, mais le timer
  // estimé ci-dessous est ce qui referme réellement l'état dans la majorité
  // des cas — voir la note sur la fiabilité de 'end' plus haut.
  utterance.addEventListener('end', endTtsSpeaking);
  utterance.addEventListener('error', endTtsSpeaking);
  ttsWatchdogId = setTimeout(endTtsSpeaking, estimateSpeechDurationMs(text));
  speechSynthesis.speak(utterance);
}

// --- Micro + VAD par énergie ---
async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  setStatus(statusMic, 'actif', 'ok');

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const workletBlob = new Blob([VAD_WORKLET_SOURCE], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(workletBlob);
  await audioCtx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  const source = audioCtx.createMediaStreamSource(stream);
  vadNode = new AudioWorkletNode(audioCtx, 'vad-processor');
  source.connect(vadNode);

  // Certains moteurs (Safari) ne maintiennent le traitement du worklet que
  // si son graphe rejoint la destination ; on le fait à volume nul.
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  vadNode.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  vadNode.port.onmessage = (event) => handleEnergyReading(event.data);

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.addEventListener('stop', onUtteranceComplete);
}

function handleEnergyReading(rms) {
  energyFill.style.width = `${Math.min(rms / (ENERGY_THRESHOLD * 4), 1) * 100}%`;

  if (ttsSpeaking || processing) return;

  const aboveThreshold = rms > ENERGY_THRESHOLD;

  if (!recording && aboveThreshold) {
    beginUtterance();
  } else if (recording) {
    if (aboveThreshold) {
      silenceStartedAt = null;
    } else if (silenceStartedAt === null) {
      silenceStartedAt = performance.now();
    } else if (performance.now() - silenceStartedAt >= SILENCE_DURATION_MS) {
      endUtterance();
    }
  }
}

function beginUtterance() {
  recording = true;
  silenceStartedAt = null;
  utteranceStartedAt = performance.now();
  recordedChunks = [];
  mediaRecorder.start();
  setStatus(statusVad, 'écoute…', 'ok');
}

function endUtterance() {
  recording = false;
  silenceStartedAt = null;
  mediaRecorder.stop();
}

async function comprendreUtterance(blob, mimeType) {
  const response = await fetch(`${WORKER_URL}/comprendre`, {
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

function handleResult(result) {
  if (result.commande === 'repete') {
    speak(lastSpokenText || templates.nonReconnu());
    return;
  }

  if (result.plante_id == null) {
    if (Array.isArray(result.ambigus) && result.ambigus.length > 0) {
      const pieces = [...new Set(result.ambigus.map((id) => findPlant(id)?.piece).filter(Boolean))];
      speak(pieces.length > 0 ? templates.ambiguite(pieces) : templates.nonReconnu());
    } else {
      speak(templates.nonReconnu());
    }
    return;
  }

  const plant = findPlant(result.plante_id);
  if (!plant || typeof result.valeur !== 'number' || Number.isNaN(result.valeur)) {
    speak(templates.nonReconnu());
    return;
  }

  const verdict = computeVerdict({
    source: plant.source,
    valeur: result.valeur,
    humiditeMin: plant.humidite_min,
    taillePot: plant.taille_pot,
    regime: plant.regime,
  });
  const response = buildResponse({ source: plant.source, valeur: result.valeur, verdict });
  addLogEntry(plant.nom, response);
  speak(response);
}

async function onUtteranceComplete() {
  const durationMs = performance.now() - utteranceStartedAt - SILENCE_DURATION_MS;

  if (durationMs < MIN_UTTERANCE_MS) {
    setStatus(statusVad, 'en attente…', null);
    return;
  }

  const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
  processing = true;
  setStatus(statusVad, 'traitement…', null);

  try {
    const result = await comprendreUtterance(blob, mediaRecorder.mimeType);
    handleResult(result);
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

// --- Démarrage (geste utilisateur unique) ---
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusSection.hidden = false;
  pickFrenchVoice();

  await acquireWakeLock();

  try {
    await loadPlants();
    await startMic();
  } catch (err) {
    setStatus(statusMic, `échec: ${err.message}`, 'error');
  }

  startBtn.textContent = 'Session en cours';
});
