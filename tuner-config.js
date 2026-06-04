export const APP_VERSION = '4.0.0';

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Etiquetas fijas por posición de cuerda (no dependen de la nota).
const STRING_SLOTS = [
  { index: 6, label: '6ª', hint: 'la más gruesa' },
  { index: 5, label: '5ª', hint: 'quinta cuerda' },
  { index: 4, label: '4ª', hint: 'cuarta cuerda' },
  { index: 3, label: '3ª', hint: 'tercera cuerda' },
  { index: 2, label: '2ª', hint: 'segunda cuerda' },
  { index: 1, label: '1ª', hint: 'la más delgada' },
];

// Nota MIDI de cada cuerda (6ª → 1ª) por afinación.
// Estándar de referencia: E2 A2 D3 G3 B3 E4 = 40 45 50 55 59 64.
export const TUNINGS = [
  { id: 'standard', name: 'Estándar', desc: 'E A D G B E', midis: [40, 45, 50, 55, 59, 64] },
  { id: 'drop-d', name: 'Drop D', desc: 'D A D G B E', midis: [38, 45, 50, 55, 59, 64] },
  { id: 'half-step', name: '½ tono abajo', desc: 'E♭ A♭ D♭ G♭ B♭ E♭', midis: [39, 44, 49, 54, 58, 63] },
  { id: 'full-step', name: '1 tono abajo', desc: 'D G C F A D', midis: [38, 43, 48, 53, 57, 62] },
  { id: 'drop-c', name: 'Drop C', desc: 'C G C F A D', midis: [36, 43, 48, 53, 57, 62] },
  { id: 'dadgad', name: 'DADGAD', desc: 'D A D G A D', midis: [38, 45, 50, 55, 57, 62] },
  { id: 'open-g', name: 'Open G', desc: 'D G D G B D', midis: [38, 43, 50, 55, 59, 62] },
  { id: 'open-d', name: 'Open D', desc: 'D A D F♯ A D', midis: [38, 45, 50, 54, 57, 62] },
];

export const DEFAULT_TUNING_ID = 'standard';

const NOTE_NAMES_PLAIN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteLabelFromMidi(midi) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function shortFromMidi(midi) {
  return NOTE_NAMES_PLAIN[((midi % 12) + 12) % 12].replace('#', '♯');
}

// Construye la lista de cuerdas (6ª → 1ª) para una afinación dada.
export function getStringsForTuning(tuningId = DEFAULT_TUNING_ID) {
  const tuning = TUNINGS.find((t) => t.id === tuningId) || TUNINGS[0];
  return STRING_SLOTS.map((slot, i) => ({
    ...slot,
    midi: tuning.midis[i],
    note: noteLabelFromMidi(tuning.midis[i]),
    short: shortFromMidi(tuning.midis[i]),
  }));
}

// Compatibilidad: cuerdas de la afinación estándar.
export const GUITAR_STRINGS = getStringsForTuning(DEFAULT_TUNING_ID);

export const DEFAULT_A4 = 440;
export const DEFAULT_TOLERANCE = 5;

export function noteNumberToHz(noteNumber, a4 = DEFAULT_A4) {
  return a4 * Math.pow(2, (noteNumber - 69) / 12);
}

export function hzToNoteNumber(hz, a4 = DEFAULT_A4) {
  return 69 + 12 * Math.log2(hz / a4);
}

export function noteNameFromNumber(noteNumber) {
  const rounded = Math.round(noteNumber);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export function getStringTargets(a4 = DEFAULT_A4, strings = GUITAR_STRINGS) {
  return strings.map((string) => ({
    ...string,
    hz: noteNumberToHz(string.midi, a4),
  }));
}

export function centsOff(hz, targetHz) {
  return 1200 * Math.log2(hz / targetHz);
}

export function nearestGuitarString(hz, a4 = DEFAULT_A4, strings = GUITAR_STRINGS) {
  const targets = getStringTargets(a4, strings);
  let best = targets[0];
  let bestAbsCents = Infinity;

  for (const target of targets) {
    const cents = centsOff(hz, target.hz);
    const absCents = Math.abs(cents);
    if (absCents < bestAbsCents) {
      best = target;
      bestAbsCents = absCents;
    }
  }

  return { target: best, distanceCents: bestAbsCents };
}
