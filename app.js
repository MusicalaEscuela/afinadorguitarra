/*
  Interfaz del afinador: estado, eventos y pintado.
  Módulos: audio-engine.js (micrófono y análisis), pitch.js (detección),
  reading.js (lectura estable), dial.js (medidor), instruments.js (catálogo),
  tuner-config.js (matemática de notas), reference-tone.js (tono guía).
*/
import {
  APP_VERSION,
  DEFAULT_A4,
  DEFAULT_TOLERANCE,
  buildStrings,
  centsOff,
  hzToNoteNumber,
  nearestNote,
  nearestString,
  noteParts,
} from './tuner-config.js';
import { DEFAULT_INSTRUMENT_ID, INSTRUMENTS, getDetectionRange, getInstrument, getTuning } from './instruments.js';
import { TunerEngine } from './audio-engine.js';
import { ReadingStabilizer } from './reading.js';
import { Dial } from './dial.js';
import { ReferenceTone } from './reference-tone.js';

const $ = (selector) => document.querySelector(selector);

const ui = {
  appVersion: $('#appVersion'),
  btnSettings: $('#btnSettings'),
  settingsPanel: $('#settingsPanel'),
  instrumentChips: $('#instrumentChips'),
  tuningField: $('#tuningField'),
  tuningSelect: $('#tuningSelect'),
  toleranceSelect: $('#toleranceSelect'),
  a4Input: $('#a4Input'),
  a4Value: $('#a4Value'),
  namingSelect: $('#namingSelect'),
  soundToggle: $('#soundToggle'),
  btnReset: $('#btnReset'),
  displayCard: $('#displayCard'),
  targetEyebrow: $('#targetEyebrow'),
  targetLabel: $('#targetLabel'),
  targetFrequency: $('#targetFrequency'),
  btnReference: $('#btnReference'),
  detectedNote: $('#detectedNote'),
  detectedOctave: $('#detectedOctave'),
  detectedFrequency: $('#detectedFrequency'),
  centsValue: $('#centsValue'),
  precisionText: $('#precisionText'),
  advice: $('#advice'),
  guidedPanel: $('#guidedPanel'),
  guidedInstruction: $('#guidedInstruction'),
  stringsBlock: $('#stringsBlock'),
  stringButtons: $('#stringButtons'),
  modeLabel: $('#modeLabel'),
  btnMic: $('#btnMic'),
  btnMicLabel: $('#btnMicLabel'),
  btnGuided: $('#btnGuided'),
  permissionHint: $('#permissionHint'),
  signalFill: $('#signalFill'),
  confidenceFill: $('#confidenceFill'),
  stabilityFill: $('#stabilityFill'),
  installHint: $('#installHint'),
};

const STORAGE_KEY = 'musicala-tuner-v5';
const MIN_FRAME_CONFIDENCE = 0.45;
const HOLD_MS = 1500; // la última lectura se queda visible un momento al apagarse la nota
const GUIDED_HOLD_TARGET = 9; // ~0.4 s sostenida en afinación antes de marcar ✓
const REFERENCE_MS = 3500;
const VISUAL_STATES = ['is-in-tune', 'is-low', 'is-high', 'is-listening', 'is-quiet', 'is-unstable'];

const DEFAULT_SETTINGS = {
  instrumentId: DEFAULT_INSTRUMENT_ID,
  tuningId: 'standard',
  a4: DEFAULT_A4,
  tolerance: DEFAULT_TOLERANCE,
  latin: false,
  soundOn: true,
};

const state = {
  ...DEFAULT_SETTINGS,
  ...loadSettings(),
  selected: 'auto', // 'auto' o el índice de una cuerda
  guided: { active: false, step: 0, done: [], hold: 0 },
  lastTarget: null,
  lastReadingAt: -Infinity,
  lockFired: false,
  referenceTimer: null,
};

const dial = new Dial($('.dial'));
const stabilizer = new ReadingStabilizer();
const referenceTone = new ReferenceTone();
const engine = new TunerEngine({
  onResult: handleResult,
  onAttack: () => stabilizer.reset(),
});

// --- Ajustes guardados ----------------------------------------------------------

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (_) {
    return {};
  }
}

function saveSettings() {
  try {
    const { instrumentId, tuningId, a4, tolerance, latin, soundOn } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ instrumentId, tuningId, a4, tolerance, latin, soundOn }));
  } catch (_) { /* sin almacenamiento: la app funciona igual */ }
}

// --- Instrumento, cuerdas y objetivo --------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatHz(value) {
  return `${value.toFixed(2)} Hz`;
}

// Cuerdas de la afinación activa, o null en modo cromático.
function currentStrings() {
  const tuning = getTuning(state.instrumentId, state.tuningId);
  return tuning ? buildStrings(tuning.midis, state.a4, state.latin) : null;
}

function selectedString() {
  const strings = currentStrings();
  if (!strings || state.selected === 'auto') return null;
  return strings.find((string) => string.index === state.selected) || null;
}

// Objetivo contra el que se mide una frecuencia.
function targetForPitch(pitch) {
  const strings = currentStrings();
  if (!strings) return nearestNote(pitch, state.a4, state.latin);
  return selectedString() || nearestString(pitch, strings);
}

// Objetivo que se muestra cuando no suena nada.
function restingTarget() {
  const strings = currentStrings();
  if (!strings) return nearestNote(state.a4, state.a4, state.latin);
  return selectedString() || strings[0];
}

function syncEngineProfile() {
  const manual = selectedString();
  engine.setProfile({
    ...getDetectionRange(state.instrumentId, state.tuningId, state.a4),
    expectedHz: manual ? manual.hz : null,
  });
}

// Se llama cuando cambia lo que se está afinando: limpia lecturas y repinta.
function retarget() {
  stabilizer.reset();
  state.lastTarget = null;
  state.lastReadingAt = -Infinity;
  syncEngineProfile();
  renderStringButtons();
  renderTarget(restingTarget());
  renderIdle();
}

// --- Pintado --------------------------------------------------------------------

function setVisualState(type) {
  ui.displayCard.classList.remove(...VISUAL_STATES);
  ui.displayCard.classList.add(type);
}

function setBars(signal, confidence, stability) {
  ui.signalFill.style.width = `${clamp(signal, 0, 100)}%`;
  ui.confidenceFill.style.width = `${clamp(confidence, 0, 100)}%`;
  ui.stabilityFill.style.width = `${clamp(stability, 0, 100)}%`;
}

function renderTarget(target) {
  const chromatic = !currentStrings();
  ui.targetEyebrow.textContent = chromatic ? 'Nota más cercana' : 'Objetivo';
  ui.targetLabel.textContent = chromatic ? target.note : `${target.label} cuerda · ${target.note}`;
  ui.targetFrequency.textContent = formatHz(target.hz);
}

function renderInstrumentChips() {
  ui.instrumentChips.innerHTML = '';
  INSTRUMENTS.forEach((instrument) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.instrument = instrument.id;
    chip.title = instrument.hint;
    chip.textContent = instrument.name;
    chip.setAttribute('aria-pressed', String(instrument.id === state.instrumentId));
    ui.instrumentChips.appendChild(chip);
  });
}

function renderTuningSelect() {
  const instrument = getInstrument(state.instrumentId);
  const tunings = instrument.tunings || [];
  ui.tuningField.hidden = tunings.length < 2;
  ui.tuningSelect.innerHTML = '';
  tunings.forEach((tuning) => {
    const option = document.createElement('option');
    option.value = tuning.id;
    option.textContent = `${tuning.name} · ${tuning.desc}`;
    option.selected = tuning.id === state.tuningId;
    ui.tuningSelect.appendChild(option);
  });
}

function renderStringButtons(detected = null) {
  const strings = currentStrings();
  ui.stringsBlock.hidden = !strings;
  ui.btnGuided.hidden = !strings;
  if (!strings) return;

  ui.stringButtons.innerHTML = '';
  const addButton = (value, top, main) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'string-button';
    button.dataset.string = value;
    button.innerHTML = `<small>${top}</small><strong>${main}</strong>`;
    button.classList.toggle('selected', state.selected === value);
    button.classList.toggle('detected', Boolean(detected) && detected.index === value);
    button.classList.toggle('done', state.guided.active && state.guided.done.includes(value));
    ui.stringButtons.appendChild(button);
  };

  addButton('auto', 'Todas', 'Auto');
  strings.forEach((string) => addButton(string.index, string.label, string.short));

  const manual = selectedString();
  ui.modeLabel.textContent = manual
    ? `Afinando solo la ${manual.label} cuerda (${manual.note}).`
    : 'Automático: toca una cuerda y la reconozco.';
}

function renderIdle() {
  ui.detectedNote.textContent = '--';
  ui.detectedOctave.textContent = '';
  ui.detectedFrequency.textContent = '— Hz';
  ui.centsValue.textContent = '0.0';
  dial.set(0);
  dial.setLocked(false);
  state.lockFired = false;
  setBars(0, 0, 0);
  ui.displayCard.classList.remove('is-holding');

  if (engine.running) {
    ui.precisionText.textContent = 'Escuchando';
    ui.advice.textContent = currentStrings() ? 'Toca una sola cuerda y déjala sonar.' : 'Toca o canta una nota y mantenla.';
    setVisualState('is-listening');
  } else {
    ui.precisionText.textContent = 'Esperando señal';
    ui.advice.textContent = 'Activa el micrófono y toca una nota.';
    setVisualState('is-quiet');
  }
}

// Sin tono claro: se conserva la última lectura un momento para poder leerla.
function renderNoSignal(result) {
  const signal = result.rms * 1500;
  if (performance.now() - state.lastReadingAt < HOLD_MS) {
    setBars(signal, 0, 0);
    ui.displayCard.classList.add('is-holding');
    return;
  }
  if (state.lastTarget) {
    stabilizer.reset();
    state.lastTarget = null;
    renderStringButtons();
    renderTarget(restingTarget());
  }
  renderIdle();
  setBars(signal, 0, 0);
  if (signal >= 18) ui.advice.textContent = 'Hay sonido, pero no una nota clara. Toca una sola nota, sin ruido alrededor.';
}

function adviceFor(cents, absCents) {
  const amount = absCents > 18 ? '' : ' un poco';
  if (currentStrings()) {
    return cents < 0
      ? `Está${amount} baja: tensa la cuerda${absCents > 18 ? ' poco a poco' : ' suavemente'}.`
      : `Está${amount} alta: afloja la cuerda${absCents > 18 ? ' poco a poco' : ' suavemente'}.`;
  }
  return cents < 0 ? `Está${amount} baja: sube la afinación.` : `Está${amount} alta: baja la afinación.`;
}

function renderReading(result) {
  const manual = selectedString();
  const pitch = manual ? result.pitch : stabilizer.foldOctave(result.pitch);
  const target = targetForPitch(pitch);

  stabilizer.push({
    pitch,
    cents: centsOff(pitch, target.hz),
    confidence: result.confidence,
  }, `${target.index}:${target.hz.toFixed(3)}`);

  const stable = stabilizer.stable();
  if (!stable) return;

  state.lastReadingAt = performance.now();
  ui.displayCard.classList.remove('is-holding');
  if (!state.lastTarget || state.lastTarget.index !== target.index) {
    state.lastTarget = target;
    renderTarget(target);
    renderStringButtons(target);
  }

  const heard = noteParts(hzToNoteNumber(stable.pitch, state.a4), state.latin);
  ui.detectedNote.textContent = heard.name;
  ui.detectedOctave.textContent = String(heard.octave);
  ui.detectedFrequency.textContent = formatHz(stable.pitch);
  ui.centsValue.textContent = `${stable.cents >= 0 ? '+' : ''}${stable.cents.toFixed(1)}`;
  dial.set(stable.cents);
  setBars(result.rms * 1500, stable.confidence * 100, stable.stability);

  const absCents = Math.abs(stable.cents);
  const inRange = absCents <= state.tolerance;

  if (inRange && stable.isStable) {
    ui.precisionText.textContent = 'Afinada';
    ui.advice.textContent = currentStrings() ? '¡Listo! Esta cuerda está afinada.' : '¡Listo! La nota está afinada.';
    dial.setLocked(true);
    setVisualState('is-in-tune');
    if (!state.lockFired) {
      state.lockFired = true;
      if (navigator.vibrate) navigator.vibrate(28);
      if (state.soundOn) referenceTone.chime();
    }
    trackGuided(target);
    return;
  }

  dial.setLocked(false);
  state.lockFired = false;
  state.guided.hold = 0;

  if (inRange) {
    ui.precisionText.textContent = 'Casi';
    ui.advice.textContent = 'Está en la zona correcta. Deja sonar la nota para confirmar.';
    setVisualState('is-unstable');
    return;
  }

  const low = stable.cents < 0;
  ui.precisionText.textContent = `${absCents > 18 ? '' : 'Un poco '}${low ? 'baja' : 'alta'}`.replace(/^./, (c) => c.toUpperCase());
  ui.advice.textContent = adviceFor(stable.cents, absCents);
  setVisualState(low ? 'is-low' : 'is-high');
}

function handleResult(result) {
  if (result.pitch && result.confidence >= MIN_FRAME_CONFIDENCE) renderReading(result);
  else renderNoSignal(result);
}

// --- Tono guía ------------------------------------------------------------------

function setReferenceButton(playing) {
  ui.btnReference.classList.toggle('is-playing', playing);
  ui.btnReference.textContent = playing ? '■ Sonando' : '▶ Tono guía';
}

function stopReference() {
  referenceTone.stop();
  setReferenceButton(false);
  clearTimeout(state.referenceTimer);
}

function toggleReference() {
  const target = selectedString() || state.lastTarget || restingTarget();
  const playing = referenceTone.toggle(target.hz);
  setReferenceButton(playing);
  clearTimeout(state.referenceTimer);
  // Se apaga solo para no interferir con el micrófono.
  if (playing) state.referenceTimer = setTimeout(stopReference, REFERENCE_MS);
}

// --- Modo guiado: cuerda por cuerda ---------------------------------------------

function renderGuided() {
  const strings = currentStrings();
  ui.guidedPanel.hidden = !state.guided.active;
  ui.btnGuided.classList.toggle('is-active', state.guided.active);
  ui.btnGuided.textContent = state.guided.active ? 'Salir del modo guiado' : 'Modo guiado';
  if (!state.guided.active || !strings) return;

  if (state.guided.done.length === strings.length) {
    ui.guidedInstruction.textContent = `¡Las ${strings.length} cuerdas están afinadas!`;
    return;
  }
  const string = strings[state.guided.step];
  ui.guidedInstruction.textContent = `Paso ${state.guided.done.length + 1} de ${strings.length}: toca la ${string.label} cuerda (${string.note}).`;
}

function focusGuidedStep() {
  state.selected = currentStrings()[state.guided.step].index;
  state.guided.hold = 0;
  retarget();
  renderGuided();
}

function startGuided() {
  state.guided = { active: true, step: 0, done: [], hold: 0 };
  focusGuidedStep();
}

function stopGuided() {
  if (!state.guided.active) return;
  state.guided = { active: false, step: 0, done: [], hold: 0 };
  state.selected = 'auto';
  renderGuided();
  retarget();
}

// Cuenta cuánto tiempo lleva afinada la cuerda del paso actual y avanza.
function trackGuided(target) {
  const { guided } = state;
  const strings = currentStrings();
  if (!guided.active || !strings || guided.done.includes(target.index)) return;
  if (target.index !== strings[guided.step].index) return;

  guided.hold += 1;
  if (guided.hold < GUIDED_HOLD_TARGET) return;

  guided.done.push(target.index);
  if (guided.done.length === strings.length) {
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    renderStringButtons(target);
    renderGuided();
    return;
  }
  guided.step += 1;
  focusGuidedStep();
}

// --- Micrófono ------------------------------------------------------------------

function renderMicButton() {
  ui.btnMic.classList.toggle('is-active', engine.running);
  ui.btnMicLabel.textContent = engine.running ? 'Detener micrófono' : 'Activar micrófono';
}

async function startTuner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    ui.permissionHint.textContent = 'Este navegador no permite usar el micrófono. Prueba con Chrome, Edge o Safari actualizado.';
    return;
  }
  if (!window.isSecureContext) {
    ui.permissionHint.textContent = 'El micrófono solo funciona en una dirección HTTPS o en localhost.';
    return;
  }

  try {
    await engine.start();
    ui.permissionHint.textContent = '';
  } catch (error) {
    console.error(error);
    ui.permissionHint.textContent = 'No se pudo activar el micrófono. Revisa el permiso en el navegador y vuelve a intentarlo.';
  }
  stabilizer.reset();
  renderMicButton();
  renderIdle();
}

function stopTuner() {
  engine.stop();
  stabilizer.reset();
  state.lastTarget = null;
  state.lastReadingAt = -Infinity;
  renderMicButton();
  renderIdle();
}

// --- Eventos --------------------------------------------------------------------

function selectInstrument(instrumentId) {
  if (state.guided.active) state.guided = { active: false, step: 0, done: [], hold: 0 };
  stopReference();
  state.instrumentId = instrumentId;
  state.tuningId = (getTuning(instrumentId, 'standard') || {}).id || 'standard';
  state.selected = 'auto';
  saveSettings();
  renderInstrumentChips();
  renderTuningSelect();
  renderGuided();
  retarget();
}

function applySettingsToControls() {
  ui.toleranceSelect.value = String(state.tolerance);
  ui.a4Input.value = String(state.a4);
  ui.a4Value.textContent = String(state.a4);
  ui.namingSelect.value = state.latin ? 'latin' : 'letters';
  ui.soundToggle.checked = state.soundOn;
  dial.setTolerance(state.tolerance);
}

function bindEvents() {
  ui.btnMic.addEventListener('click', () => (engine.running ? stopTuner() : startTuner()));

  ui.btnSettings.addEventListener('click', () => {
    const open = ui.settingsPanel.hidden;
    ui.settingsPanel.hidden = !open;
    ui.btnSettings.setAttribute('aria-expanded', String(open));
  });

  ui.instrumentChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (chip && chip.dataset.instrument !== state.instrumentId) selectInstrument(chip.dataset.instrument);
  });

  ui.tuningSelect.addEventListener('change', (event) => {
    state.tuningId = event.target.value;
    state.selected = 'auto';
    state.guided = { active: false, step: 0, done: [], hold: 0 };
    stopReference();
    saveSettings();
    renderGuided();
    retarget();
  });

  ui.toleranceSelect.addEventListener('change', (event) => {
    state.tolerance = Number(event.target.value) || DEFAULT_TOLERANCE;
    dial.setTolerance(state.tolerance);
    saveSettings();
  });

  ui.a4Input.addEventListener('input', (event) => {
    state.a4 = Number(event.target.value) || DEFAULT_A4;
    ui.a4Value.textContent = String(state.a4);
    saveSettings();
    retarget();
  });

  ui.namingSelect.addEventListener('change', (event) => {
    state.latin = event.target.value === 'latin';
    saveSettings();
    renderGuided();
    retarget();
  });

  ui.soundToggle.addEventListener('change', (event) => {
    state.soundOn = event.target.checked;
    saveSettings();
  });

  ui.btnReset.addEventListener('click', () => {
    const { instrumentId } = state;
    Object.assign(state, DEFAULT_SETTINGS, { instrumentId });
    applySettingsToControls();
    selectInstrument(instrumentId);
  });

  ui.btnReference.addEventListener('click', toggleReference);

  ui.btnGuided.addEventListener('click', () => (state.guided.active ? stopGuided() : startGuided()));

  ui.stringButtons.addEventListener('click', (event) => {
    const button = event.target.closest('.string-button');
    if (!button) return;
    if (state.guided.active) {
      state.guided = { active: false, step: 0, done: [], hold: 0 };
      renderGuided();
    }
    state.selected = button.dataset.string;
    retarget();
  });
}

// --- PWA ------------------------------------------------------------------------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('./service-worker.js');
  } catch (error) {
    console.warn('No se pudo registrar el service worker:', error);
  }
}

function setupInstallHint() {
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    ui.installHint.hidden = false;
  });

  ui.installHint.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    ui.installHint.hidden = true;
  });
}

function init() {
  // Un instrumento o afinación guardados que ya no existen vuelven al valor por defecto.
  state.instrumentId = getInstrument(state.instrumentId).id;
  state.tuningId = (getTuning(state.instrumentId, state.tuningId) || {}).id || 'standard';

  ui.appVersion.textContent = `v${APP_VERSION}`;
  applySettingsToControls();
  renderInstrumentChips();
  renderTuningSelect();
  bindEvents();
  renderGuided();
  renderMicButton();
  retarget();
  setupInstallHint();
  registerServiceWorker();
}

init();
