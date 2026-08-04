// --- Constantes VAD (à calibrer sur l'appareil réel — voir section 9.2 du brief) ---
const ENERGY_THRESHOLD = 0.02;      // RMS (0–1) au-delà duquel on considère qu'un énoncé commence
const SILENCE_DURATION_MS = 1200;   // silence continu requis pour clore un énoncé
const MIN_UTTERANCE_MS = 300;       // ignore les pics trop courts (bruit, frottement)
const FFT_SIZE = 2048;

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
let analyser = null;
let mediaRecorder = null;
let recordedChunks = [];
let rafId = null;
let recording = false;
let silenceStartedAt = null;
let utteranceStartedAt = null;
let ttsSpeaking = false;
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

function speakTest(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  if (frenchVoice) utterance.voice = frenchVoice;
  utterance.lang = 'fr-FR';
  ttsSpeaking = true;
  setStatus(statusVad, 'réponse…', null);
  utterance.addEventListener('end', () => {
    ttsSpeaking = false;
  });
  utterance.addEventListener('error', () => {
    ttsSpeaking = false;
  });
  speechSynthesis.speak(utterance);
}

// --- Micro + VAD par énergie ---
async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  setStatus(statusMic, 'actif', 'ok');

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  source.connect(analyser);

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.addEventListener('stop', onUtteranceComplete);

  const buffer = new Uint8Array(analyser.fftSize);

  function tick() {
    analyser.getByteTimeDomainData(buffer);

    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      const normalized = (buffer[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);

    energyFill.style.width = `${Math.min(rms / (ENERGY_THRESHOLD * 4), 1) * 100}%`;

    if (!ttsSpeaking) {
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

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);
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
