// --- Constantes VAD (à calibrer sur l'appareil réel — voir section 9.2 du brief) ---
const ENERGY_THRESHOLD = 0.02;      // RMS (0–1) au-delà duquel on considère qu'un énoncé commence
const SILENCE_DURATION_MS = 1200;   // silence continu requis pour clore un énoncé
const MIN_UTTERANCE_MS = 300;       // ignore les pics trop courts (bruit, frottement)
const ENERGY_BLOCK_SAMPLES = 1024;  // taille du bloc RMS calculé côté thread audio
const TTS_WATCHDOG_MS = 8000;       // filet de sécurité si 'end' ne se déclenche pas (iOS, app en arrière-plan)

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

// --- Voix française pour le TTS de test ---
function pickFrenchVoice() {
  const voices = speechSynthesis.getVoices();
  frenchVoice = voices.find(v => v.lang.startsWith('fr')) || null;
}
speechSynthesis.addEventListener('voiceschanged', pickFrenchVoice);

function endTtsSpeaking() {
  ttsSpeaking = false;
  if (ttsWatchdogId !== null) {
    clearTimeout(ttsWatchdogId);
    ttsWatchdogId = null;
  }
  setStatus(statusVad, 'en attente…', null);
}

function speakTest(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  if (frenchVoice) utterance.voice = frenchVoice;
  utterance.lang = 'fr-FR';
  ttsSpeaking = true;
  setStatus(statusVad, 'réponse…', null);
  utterance.addEventListener('end', endTtsSpeaking);
  utterance.addEventListener('error', endTtsSpeaking);
  // Filet de sécurité : sur iOS, l'événement 'end' peut ne jamais se
  // déclencher si la synthèse a été interrompue en arrière-plan.
  ttsWatchdogId = setTimeout(endTtsSpeaking, TTS_WATCHDOG_MS);
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

  if (ttsSpeaking) return;

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

function onUtteranceComplete() {
  const durationMs = performance.now() - utteranceStartedAt - SILENCE_DURATION_MS;

  if (durationMs < MIN_UTTERANCE_MS) {
    setStatus(statusVad, 'en attente…', null);
    return;
  }

  const seconds = (durationMs / 1000).toFixed(1);
  addLogEntry('Énoncé détecté', `${seconds} s`);
  speakTest(`Énoncé détecté, ${seconds.replace('.', ',')} secondes.`);
}

// --- Démarrage (geste utilisateur unique) ---
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusSection.hidden = false;
  pickFrenchVoice();

  await acquireWakeLock();

  try {
    await startMic();
  } catch (err) {
    setStatus(statusMic, `échec: ${err.message}`, 'error');
  }

  startBtn.textContent = 'Session en cours';
});
