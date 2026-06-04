import {
  APP_VERSION,
  DEFAULT_A4,
  DEFAULT_TOLERANCE,
  DEFAULT_TUNING_ID,
  TUNINGS,
  centsOff,
  getStringsForTuning,
  getStringTargets,
  hzToNoteNumber,
  nearestGuitarString,
  noteNameFromNumber,
} from './tuner-config.js';
import { detectPitchYin, median, stdDev } from './pitch.js';
import { ReferenceTone } from './reference-tone.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  appVersion: $('#appVersion'),
  btnMic: $('#btnMic'),
  btnReset: $('#btnReset'),
  modeLabel: $('#modeLabel'),
  stringButtons: $('#stringButtons'),
  a4Input: $('#a4Input'),
  a4Value: $('#a4Value'),
  toleranceSelect: $('#toleranceSelect'),
  tuningSelect: $('#tuningSelect'),
  targetString: $('#targetString'),
  targetFrequency: $('#targetFrequency'),
  detectedNote: $('#detectedNote'),
  detectedFrequency: $('#detectedFrequency'),
  centsValue: $('#centsValue'),
  advice: $('#advice'),
  precisionText: $('#precisionText'),
  needle: $('#needle'),
  needleReadout: $('#needleReadout'),
  signalFill: $('#signalFill'),
  confidenceFill: $('#confidenceFill'),
  stabilityFill: $('#stabilityFill'),
  signalText: $('#signalText'),
  confidenceText: $('#confidenceText'),
  stabilityText: $('#stabilityText'),
  permissionHint: $('#permissionHint'),
  installHint: $('#installHint'),
  displayCard: $('#displayCard'),
  soundToggle: $('#soundToggle'),
  btnReference: $('#btnReference'),
  btnGuided: $('#btnGuided'),
  guidedPanel: $('#guidedPanel'),
  guidedProgress: $('#guidedProgress'),
  guidedInstruction: $('#guidedInstruction'),
};

const referenceTone = new ReferenceTone();

const state = {
  audioContext: null,
  analyser: null,
  source: null,
  highPass: null,
  lowPass: null,
  stream: null,
  buffer: null,
  animationId: null,
  running: false,
  selectedString: 'auto',
  a4: DEFAULT_A4,
  tolerance: DEFAULT_TOLERANCE,
  history: [],
  lastTargetKey: 'auto',
  lastUiUpdate: 0,
  needleCents: 0,
  needleTargetCents: 0,
  needleLocked: false,
  needleAnimId: null,
  lockFired: false,
  soundOn: true,
  fxCtx: null,
  referenceTimer: null,
  guidedActive: false,
  guidedStep: 0,
  guidedDone: [],
  guidedHold: 0,
  tuningId: DEFAULT_TUNING_ID,
};

// Cuerdas de la afinación activa (6ª → 1ª).
function currentStrings() {
  return getStringsForTuning(state.tuningId);
}

// Orden del modo guiado: de la 6ª (más grave) a la 1ª (más aguda).
const GUIDED_ORDER = [6, 5, 4, 3, 2, 1];
const GUIDED_HOLD_TARGET = 9; // ~0.4 s sostenida en afinación antes de marcar ✓

const HISTORY_LIMIT = 9;
const UI_INTERVAL_MS = 45;
const MIN_CONFIDENCE = 0.68;
const NEEDLE_EASE = 0.22;

// --- Geometría del dial radial ---
const SVG_NS = 'http://www.w3.org/2000/svg';
const DIAL_PIVOT_X = 160;
const DIAL_PIVOT_Y = 190;
const DIAL_ANGLE_MAX = 78; // grados a ±50 cents
const DIAL_R_RIM = 150;
const DIAL_R_TICK_OUT = 150;
const DIAL_R_TICK_MINOR = 138;
const DIAL_R_TICK_MAJOR = 126;
const DIAL_R_LABEL = 112;
const DIAL_ZONE_CENTS = 6; // banda verde central de referencia

// Punto sobre el arco para un valor en cents y un radio dado.
function dialPolar(cents, radius) {
  const rad = (clamp(cents, -50, 50) / 50) * DIAL_ANGLE_MAX * (Math.PI / 180);
  return {
    x: DIAL_PIVOT_X + radius * Math.sin(rad),
    y: DIAL_PIVOT_Y - radius * Math.cos(rad),
  };
}

function dialArcPath(centsFrom, centsTo, radius) {
  const a = dialPolar(centsFrom, radius);
  const b = dialPolar(centsTo, radius);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function buildDial() {
  const rim = document.querySelector('#dialRim');
  const zone = document.querySelector('#dialZone');
  const ticks = document.querySelector('#dialTicks');
  if (!rim || !ticks) return;

  rim.setAttribute('d', dialArcPath(-50, 50, DIAL_R_RIM));
  zone.setAttribute('d', dialArcPath(-DIAL_ZONE_CENTS, DIAL_ZONE_CENTS, DIAL_R_RIM));

  ticks.innerHTML = '';
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0;
    const inner = dialPolar(c, major ? DIAL_R_TICK_MAJOR : DIAL_R_TICK_MINOR);
    const outer = dialPolar(c, DIAL_R_TICK_OUT);
    ticks.appendChild(svgEl('line', {
      x1: inner.x.toFixed(2), y1: inner.y.toFixed(2),
      x2: outer.x.toFixed(2), y2: outer.y.toFixed(2),
      class: major ? 'tick major' : 'tick',
    }));
    if (major) {
      const labelPos = dialPolar(c, DIAL_R_LABEL);
      const label = svgEl('text', {
        x: labelPos.x.toFixed(2), y: (labelPos.y + 4).toFixed(2), class: 'tick-label',
      });
      label.textContent = c > 0 ? `+${c}` : `${c}`;
      ticks.appendChild(label);
    }
  }
}

function setNeedle(cents) {
  state.needleTargetCents = clamp(cents, -50, 50);
  ui.needleReadout.textContent = `${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cents`;
}

function setNeedleLocked(locked) {
  if (state.needleLocked === locked) return;
  state.needleLocked = locked;
  ui.needle.classList.toggle('is-locked', locked);
}

// Loop continuo: interpola el ángulo de la aguja hacia el objetivo cada frame.
// Convierte la precisión sub-cent en un barrido suave tipo aguja analógica.
function needleLoop() {
  state.needleCents += (state.needleTargetCents - state.needleCents) * NEEDLE_EASE;
  if (Math.abs(state.needleTargetCents - state.needleCents) < 0.01) {
    state.needleCents = state.needleTargetCents;
  }
  const angle = (state.needleCents / 50) * DIAL_ANGLE_MAX;
  ui.needle.setAttribute('transform', `rotate(${angle.toFixed(2)} ${DIAL_PIVOT_X} ${DIAL_PIVOT_Y})`);
  state.needleAnimId = requestAnimationFrame(needleLoop);
}

function formatHz(value) {
  return `${value.toFixed(2)} Hz`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clearHistory() {
  state.history = [];
}

function ensureFxAudio() {
  if (!state.fxCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) state.fxCtx = new Ctx();
  }
  if (state.fxCtx && state.fxCtx.state === 'suspended') state.fxCtx.resume();
  return state.fxCtx;
}

// Confirmación al quedar afinada: háptico + tono suave opcional.
// Permite afinar "a ciegas", sin mirar la pantalla.
function triggerInTuneFeedback() {
  if (navigator.vibrate) navigator.vibrate(28);
  if (!state.soundOn) return;
  const ctx = ensureFxAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.26);
}

function setBars({ signal = 0, confidence = 0, stability = 0 }) {
  ui.signalFill.style.width = `${clamp(signal, 0, 100)}%`;
  ui.confidenceFill.style.width = `${clamp(confidence, 0, 100)}%`;
  ui.stabilityFill.style.width = `${clamp(stability, 0, 100)}%`;
}

function getReferenceTarget() {
  const targets = getStringTargets(state.a4, currentStrings());
  if (state.guidedActive) {
    const index = GUIDED_ORDER[state.guidedStep];
    return targets.find((t) => t.index === index) || targets[0];
  }
  if (state.selectedString !== 'auto') {
    return targets.find((t) => String(t.index) === String(state.selectedString)) || targets[0];
  }
  return targets[0];
}

function setReferenceButtonState(active) {
  if (!ui.btnReference) return;
  ui.btnReference.classList.toggle('is-playing', active);
  ui.btnReference.textContent = active ? '⏸ Sonando' : '▶ Tono guía';
}

function playReference() {
  const target = getReferenceTarget();
  const playing = referenceTone.toggle(target.hz);
  setReferenceButtonState(playing);

  if (state.referenceTimer) clearTimeout(state.referenceTimer);
  if (playing) {
    // Auto-apagado para no interferir con la detección del micrófono.
    state.referenceTimer = setTimeout(() => {
      referenceTone.stop();
      setReferenceButtonState(false);
    }, 3500);
  }
}

function stopReference() {
  referenceTone.stop();
  setReferenceButtonState(false);
  if (state.referenceTimer) clearTimeout(state.referenceTimer);
}

function renderGuidedProgress() {
  if (!ui.guidedProgress) return;
  ui.guidedProgress.innerHTML = '';
  GUIDED_ORDER.forEach((index, step) => {
    const string = currentStrings().find((s) => s.index === index);
    const dot = document.createElement('div');
    dot.className = 'guided-dot';
    if (state.guidedDone.includes(index)) dot.classList.add('done');
    if (state.guidedActive && step === state.guidedStep) dot.classList.add('current');
    dot.innerHTML = `<strong>${string.short}</strong><small>${string.note}</small>`;
    ui.guidedProgress.appendChild(dot);
  });
}

function updateGuidedInstruction() {
  if (!ui.guidedInstruction) return;
  if (state.guidedDone.length === GUIDED_ORDER.length) {
    ui.guidedInstruction.textContent = '¡Las 6 cuerdas afinadas! Guitarra lista.';
    return;
  }
  const index = GUIDED_ORDER[state.guidedStep];
  const string = currentStrings().find((s) => s.index === index);
  ui.guidedInstruction.textContent = `Toca la ${string.label} cuerda (${string.note}) y afínala.`;
}

function focusGuidedString() {
  const index = GUIDED_ORDER[state.guidedStep];
  state.selectedString = String(index);
  state.guidedHold = 0;
  clearHistory();
  updateStringButtons();
  updateTarget(getReferenceTarget());
}

function startGuided() {
  state.guidedActive = true;
  state.guidedStep = 0;
  state.guidedDone = [];
  state.guidedHold = 0;
  ui.guidedPanel.hidden = false;
  ui.btnGuided.classList.add('is-active');
  ui.btnGuided.textContent = 'Salir del modo guiado';
  focusGuidedString();
  renderGuidedProgress();
  updateGuidedInstruction();
  ui.advice.textContent = 'Modo guiado: afina cada cuerda en orden, te aviso al pasar a la siguiente.';
}

function stopGuided() {
  state.guidedActive = false;
  state.guidedHold = 0;
  ui.guidedPanel.hidden = true;
  ui.btnGuided.classList.remove('is-active');
  ui.btnGuided.textContent = 'Modo guiado';
  renderGuidedProgress();
}

function advanceGuided() {
  const index = GUIDED_ORDER[state.guidedStep];
  if (!state.guidedDone.includes(index)) state.guidedDone.push(index);

  if (state.guidedDone.length === GUIDED_ORDER.length) {
    renderGuidedProgress();
    updateGuidedInstruction();
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    return;
  }

  // Avanza al siguiente paso pendiente.
  do {
    state.guidedStep = (state.guidedStep + 1) % GUIDED_ORDER.length;
  } while (state.guidedDone.includes(GUIDED_ORDER[state.guidedStep]));

  focusGuidedString();
  renderGuidedProgress();
  updateGuidedInstruction();
}

function getManualTarget() {
  const targets = getStringTargets(state.a4, currentStrings());
  return targets.find((target) => String(target.index) === String(state.selectedString)) || targets[0];
}

function getTargetForPitch(pitch) {
  if (state.selectedString === 'auto') {
    return nearestGuitarString(pitch, state.a4, currentStrings()).target;
  }
  return getManualTarget();
}

function getTargetKey(target) {
  return `${state.selectedString}:${target.index}:${state.a4}:${state.tuningId}`;
}

function updateStringButtons(activeTarget = null) {
  $$('.string-button').forEach((button) => {
    const isAuto = button.dataset.string === 'auto' && state.selectedString === 'auto';
    const isManualSelected = button.dataset.string === String(state.selectedString);
    const isDetected = activeTarget && button.dataset.string === String(activeTarget.index);

    button.classList.toggle('selected', isAuto || isManualSelected);
    button.classList.toggle('detected', isDetected);
  });

  ui.modeLabel.textContent = state.selectedString === 'auto'
    ? 'Automático: toca una cuerda y la app la reconoce.'
    : `Manual: afinando la ${getManualTarget().label} cuerda.`;
}

function updateTarget(target) {
  ui.targetString.textContent = `${target.label} cuerda · ${target.note}`;
  ui.targetFrequency.textContent = formatHz(target.hz);
}

function setVisualState(type) {
  ui.displayCard.classList.remove('is-in-tune', 'is-low', 'is-high', 'is-listening', 'is-quiet', 'is-unstable');
  ui.displayCard.classList.add(type);
}

function setIdle(message = 'Activa el micrófono y toca una sola cuerda.') {
  ui.detectedNote.textContent = '--';
  ui.detectedFrequency.textContent = '0.00 Hz';
  ui.centsValue.textContent = '0.0';
  ui.precisionText.textContent = 'Esperando señal';
  ui.advice.textContent = message;
  setNeedle(0);
  setBars({ signal: 0, confidence: 0, stability: 0 });
  ui.signalText.textContent = 'sin señal';
  ui.confidenceText.textContent = 'sin lectura';
  ui.stabilityText.textContent = 'sin estabilidad';
  setNeedleLocked(false);
  state.lockFired = false;
  setVisualState('is-quiet');
}

function setWeakSignal(result) {
  clearHistory();
  const signalScore = Math.round(clamp(result.rms * 1500, 0, 100));
  setBars({ signal: signalScore, confidence: 0, stability: 0 });
  ui.signalText.textContent = signalScore < 18 ? 'señal baja' : 'ruido o cuerda poco clara';
  ui.confidenceText.textContent = 'sin tono confiable';
  ui.stabilityText.textContent = 'esperando cuerda';
  ui.detectedNote.textContent = '--';
  ui.detectedFrequency.textContent = '0.00 Hz';
  ui.centsValue.textContent = '0.0';
  ui.precisionText.textContent = 'Toca una cuerda clara';
  ui.advice.textContent = signalScore < 18
    ? 'Acerca la guitarra al micrófono y toca una sola cuerda.'
    : 'Evita hablar o rozar varias cuerdas al tiempo. Sí, el micrófono también se confunde, qué sorpresa.';
  setNeedle(0);
  setNeedleLocked(false);
  state.lockFired = false;
  setVisualState('is-quiet');
  updateStringButtons(null);
}

function pushHistory(sample, targetKey) {
  if (targetKey !== state.lastTargetKey) {
    clearHistory();
    state.lastTargetKey = targetKey;
  }

  state.history.push(sample);
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
}

function computeStableReading() {
  const usable = state.history.filter((item) => item.confidence >= MIN_CONFIDENCE);
  if (!usable.length) return null;

  const recent = usable.slice(-Math.min(6, usable.length));
  const centsValues = recent.map((item) => item.cents);
  const hzValues = recent.map((item) => item.pitch);
  const confidenceValues = recent.map((item) => item.confidence);

  const cents = median(centsValues);
  const pitch = median(hzValues);
  const confidence = median(confidenceValues);
  const spread = stdDev(centsValues);
  const stability = clamp(100 - spread * 13, 0, 100);

  return {
    cents,
    pitch,
    confidence,
    stability,
    sampleCount: recent.length,
    isStable: recent.length >= 3 && spread <= 4.8 && confidence >= MIN_CONFIDENCE,
  };
}

function renderReading(result) {
  const target = getTargetForPitch(result.pitch);
  const targetKey = getTargetKey(target);
  const cents = centsOff(result.pitch, target.hz);

  pushHistory({
    pitch: result.pitch,
    cents,
    confidence: result.confidence,
    time: performance.now(),
  }, targetKey);

  const stable = computeStableReading();
  if (!stable) {
    setWeakSignal(result);
    return;
  }

  const absCents = Math.abs(stable.cents);
  const isInTune = absCents <= state.tolerance && stable.isStable;
  const isClose = absCents <= state.tolerance && !stable.isStable;
  const isLow = stable.cents < -state.tolerance;
  const isHigh = stable.cents > state.tolerance;

  updateTarget(target);
  updateStringButtons(target);

  ui.detectedNote.textContent = noteNameFromNumber(hzToNoteNumber(stable.pitch, state.a4));
  ui.detectedFrequency.textContent = formatHz(stable.pitch);
  ui.centsValue.textContent = `${stable.cents >= 0 ? '+' : ''}${stable.cents.toFixed(1)}`;
  setNeedle(stable.cents);

  const signalScore = Math.round(clamp(result.rms * 1500, 0, 100));
  const confidenceScore = Math.round(stable.confidence * 100);
  const stabilityScore = Math.round(stable.stability);
  setBars({ signal: signalScore, confidence: confidenceScore, stability: stabilityScore });

  ui.signalText.textContent = signalScore > 75 ? 'señal fuerte' : signalScore > 35 ? 'señal buena' : 'señal suave';
  ui.confidenceText.textContent = confidenceScore > 85 ? 'tono claro' : confidenceScore > 70 ? 'tono usable' : 'tono dudoso';
  ui.stabilityText.textContent = stable.isStable ? 'lectura estable' : 'estabilizando';

  if (isInTune) {
    ui.precisionText.textContent = `Afinada · ±${state.tolerance} cents`;
    ui.advice.textContent = 'Afinada. Suelta esa cuerda antes de que la humanidad decida sobreafinarla por ansiedad.';
    setNeedleLocked(true);
    if (!state.lockFired) {
      triggerInTuneFeedback();
      state.lockFired = true;
    }
    setVisualState('is-in-tune');

    if (state.guidedActive && String(target.index) === String(GUIDED_ORDER[state.guidedStep])) {
      state.guidedHold += 1;
      if (state.guidedHold >= GUIDED_HOLD_TARGET && !state.guidedDone.includes(target.index)) {
        advanceGuided();
      }
    }
    return;
  }

  setNeedleLocked(false);
  state.lockFired = false;
  state.guidedHold = 0;

  if (isClose) {
    ui.precisionText.textContent = `Casi afinada · ±${state.tolerance} cents`;
    ui.advice.textContent = 'Está en zona correcta, mantén el sonido un momento para confirmar.';
    setVisualState('is-unstable');
    return;
  }

  if (isLow) {
    ui.precisionText.textContent = absCents > 18 ? 'Baja' : 'Un poco baja';
    ui.advice.textContent = absCents > 18
      ? 'Está baja: sube la tensión de la cuerda poco a poco.'
      : 'Un poquito baja: ajusta suave hacia arriba.';
    setVisualState('is-low');
    return;
  }

  if (isHigh) {
    ui.precisionText.textContent = absCents > 18 ? 'Alta' : 'Un poco alta';
    ui.advice.textContent = absCents > 18
      ? 'Está alta: baja la tensión de la cuerda poco a poco.'
      : 'Un poquito alta: ajusta suave hacia abajo.';
    setVisualState('is-high');
  }
}

function analysisLoop(timestamp = 0) {
  if (!state.running || !state.analyser) return;

  if (timestamp - state.lastUiUpdate >= UI_INTERVAL_MS) {
    state.analyser.getFloatTimeDomainData(state.buffer);
    const result = detectPitchYin(state.buffer, state.audioContext.sampleRate, {
      minFrequency: 60,
      maxFrequency: 420,
      threshold: 0.115,
      minRms: 0.006,
    });

    if (result.pitch && result.confidence >= 0.45) {
      renderReading(result);
    } else {
      setWeakSignal(result);
    }

    state.lastUiUpdate = timestamp;
  }

  state.animationId = requestAnimationFrame(analysisLoop);
}

async function requestMicrophone() {
  const constraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

async function startTuner() {
  if (state.running) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    ui.permissionHint.textContent = 'Este navegador no permite micrófono web. Usa Chrome, Edge o Safari actualizado.';
    return;
  }

  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    ui.permissionHint.textContent = 'El micrófono requiere HTTPS. Sube el proyecto a GitHub Pages o ábrelo en localhost.';
    return;
  }

  try {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    state.stream = await requestMicrophone();

    if (state.audioContext.state === 'suspended') await state.audioContext.resume();

    state.source = state.audioContext.createMediaStreamSource(state.stream);
    state.highPass = state.audioContext.createBiquadFilter();
    state.highPass.type = 'highpass';
    state.highPass.frequency.value = 55;
    state.highPass.Q.value = 0.7;

    state.lowPass = state.audioContext.createBiquadFilter();
    state.lowPass.type = 'lowpass';
    state.lowPass.frequency.value = 900;
    state.lowPass.Q.value = 0.7;

    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 4096;
    state.analyser.smoothingTimeConstant = 0;
    state.buffer = new Float32Array(state.analyser.fftSize);

    state.source.connect(state.highPass);
    state.highPass.connect(state.lowPass);
    state.lowPass.connect(state.analyser);

    state.running = true;
    state.lastUiUpdate = 0;
    ui.btnMic.textContent = 'Micrófono activo';
    ui.btnMic.classList.add('is-active');
    ui.permissionHint.textContent = 'Toca una cuerda a la vez. Para mayor precisión, deja que la nota suene limpia.';
    setVisualState('is-listening');
    analysisLoop();
  } catch (error) {
    console.error(error);
    ui.permissionHint.textContent = 'No se pudo activar el micrófono. Revisa permisos del navegador y vuelve a intentarlo.';
    setIdle('No se pudo activar el micrófono. Cosas de navegadores, esos seres temperamentales.');
  }
}

function stopTuner() {
  if (state.animationId) cancelAnimationFrame(state.animationId);
  state.animationId = null;
  state.running = false;
  clearHistory();

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }

  if (state.audioContext && state.audioContext.state !== 'closed') {
    state.audioContext.close();
  }

  state.audioContext = null;
  state.analyser = null;
  state.source = null;
  state.highPass = null;
  state.lowPass = null;
  state.stream = null;
  state.buffer = null;

  ui.btnMic.textContent = 'Activar micrófono';
  ui.btnMic.classList.remove('is-active');
  setIdle();
}

function buildStringButtons() {
  ui.stringButtons.innerHTML = '';

  const autoButton = document.createElement('button');
  autoButton.type = 'button';
  autoButton.className = 'string-button';
  autoButton.dataset.string = 'auto';
  autoButton.innerHTML = '<span>Auto</span><strong>Reconocer</strong>';
  ui.stringButtons.appendChild(autoButton);

  currentStrings().forEach((string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'string-button';
    button.dataset.string = String(string.index);
    button.innerHTML = `
      <span>${string.label} · ${string.note}</span>
      <strong>${string.short}</strong>
      <small>${string.hint}</small>
    `;
    ui.stringButtons.appendChild(button);
  });
}

function bindEvents() {
  ui.btnMic.addEventListener('click', () => {
    if (state.running) stopTuner();
    else startTuner();
  });

  ui.btnReset.addEventListener('click', () => {
    stopGuided();
    stopReference();
    state.a4 = DEFAULT_A4;
    state.tolerance = DEFAULT_TOLERANCE;
    state.selectedString = 'auto';
    state.tuningId = DEFAULT_TUNING_ID;
    ui.a4Input.value = String(DEFAULT_A4);
    ui.a4Value.textContent = String(DEFAULT_A4);
    ui.toleranceSelect.value = String(DEFAULT_TOLERANCE);
    if (ui.tuningSelect) ui.tuningSelect.value = DEFAULT_TUNING_ID;
    clearHistory();
    buildStringButtons();
    updateStringButtons();
    updateTarget(getStringTargets(state.a4, currentStrings())[0]);
    setIdle('Ajustes restablecidos. Ahora sí, de vuelta a la civilización tonal.');
  });

  ui.a4Input.addEventListener('input', (event) => {
    state.a4 = Number(event.target.value) || DEFAULT_A4;
    ui.a4Value.textContent = String(state.a4);
    clearHistory();
    const target = state.selectedString === 'auto' ? getStringTargets(state.a4, currentStrings())[0] : getManualTarget();
    updateTarget(target);
  });

  ui.toleranceSelect.addEventListener('change', (event) => {
    state.tolerance = Number(event.target.value) || DEFAULT_TOLERANCE;
    clearHistory();
  });

  ui.tuningSelect?.addEventListener('change', (event) => {
    state.tuningId = event.target.value;
    state.selectedString = 'auto';
    stopGuided();
    stopReference();
    clearHistory();
    buildStringButtons();
    updateStringButtons();
    updateTarget(getStringTargets(state.a4, currentStrings())[0]);
    const tuning = TUNINGS.find((t) => t.id === state.tuningId);
    ui.advice.textContent = `Afinación ${tuning.name} (${tuning.desc}). Toca una cuerda.`;
  });

  ui.soundToggle?.addEventListener('change', (event) => {
    state.soundOn = event.target.checked;
    if (state.soundOn) ensureFxAudio();
  });

  ui.btnReference?.addEventListener('click', playReference);

  ui.btnGuided?.addEventListener('click', () => {
    if (state.guidedActive) stopGuided();
    else startGuided();
  });

  ui.stringButtons.addEventListener('click', (event) => {
    const button = event.target.closest('.string-button');
    if (!button) return;
    if (state.guidedActive) stopGuided();
    state.selectedString = button.dataset.string;
    clearHistory();
    updateStringButtons();
    const target = state.selectedString === 'auto' ? getStringTargets(state.a4, currentStrings())[0] : getManualTarget();
    updateTarget(target);
    ui.advice.textContent = state.selectedString === 'auto'
      ? 'Modo automático activo: toca una sola cuerda.'
      : `Toca la ${target.label} cuerda (${target.note}).`;
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  try {
    await navigator.serviceWorker.register('./service-worker.js');
  } catch (error) {
    console.warn('No se pudo registrar el service worker:', error);
  }
}

function setupInstallHint() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.deferredInstallPrompt = event;
    ui.installHint.hidden = false;
  });

  ui.installHint?.addEventListener('click', async () => {
    const prompt = window.deferredInstallPrompt;
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    window.deferredInstallPrompt = null;
    ui.installHint.hidden = true;
  });
}

function populateTuningSelect() {
  if (!ui.tuningSelect) return;
  ui.tuningSelect.innerHTML = '';
  TUNINGS.forEach((tuning) => {
    const option = document.createElement('option');
    option.value = tuning.id;
    option.textContent = `${tuning.name} · ${tuning.desc}`;
    if (tuning.id === state.tuningId) option.selected = true;
    ui.tuningSelect.appendChild(option);
  });
}

function init() {
  ui.appVersion.textContent = `v${APP_VERSION}`;
  buildDial();
  populateTuningSelect();
  buildStringButtons();
  bindEvents();
  updateStringButtons();
  updateTarget(getStringTargets(state.a4, currentStrings())[0]);
  setIdle();
  setupInstallHint();
  registerServiceWorker();
  needleLoop();
}

init();
