/*
  Constantes y matemática de notas (sin DOM): conversión nota ↔ frecuencia,
  nombres de notas y búsqueda de la cuerda o nota más cercana.
*/
export const APP_VERSION = '5.0.0';

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const NOTE_NAMES_LATIN = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

export const DEFAULT_A4 = 440;
export const DEFAULT_TOLERANCE = 5;

export function noteNumberToHz(noteNumber, a4 = DEFAULT_A4) {
  return a4 * Math.pow(2, (noteNumber - 69) / 12);
}

export function hzToNoteNumber(hz, a4 = DEFAULT_A4) {
  return 69 + 12 * Math.log2(hz / a4);
}

export function centsOff(hz, targetHz) {
  return 1200 * Math.log2(hz / targetHz);
}

// Nombre de una nota MIDI. `latin` usa Do Re Mi en lugar de C D E.
export function noteParts(noteNumber, latin = false) {
  const rounded = Math.round(noteNumber);
  const names = latin ? NOTE_NAMES_LATIN : NOTE_NAMES;
  return { name: names[((rounded % 12) + 12) % 12], octave: Math.floor(rounded / 12) - 1 };
}

// Cuerdas de una afinación con su frecuencia objetivo. La última del arreglo es la 1ª cuerda.
export function buildStrings(midis, a4 = DEFAULT_A4, latin = false) {
  const count = midis.length;
  return midis.map((midi, i) => {
    const { name, octave } = noteParts(midi, latin);
    return {
      index: String(count - i),
      label: `${count - i}ª`,
      midi,
      short: name,
      octave,
      note: `${name}${octave}`,
      hz: noteNumberToHz(midi, a4),
    };
  });
}

// Cuerda más cercana a una frecuencia.
export function nearestString(hz, strings) {
  let best = strings[0];
  let bestAbs = Infinity;
  for (const string of strings) {
    const abs = Math.abs(centsOff(hz, string.hz));
    if (abs < bestAbs) {
      best = string;
      bestAbs = abs;
    }
  }
  return best;
}

// Nota cromática más cercana a una frecuencia (modo cromático).
export function nearestNote(hz, a4 = DEFAULT_A4, latin = false) {
  const midi = Math.round(hzToNoteNumber(hz, a4));
  const { name, octave } = noteParts(midi, latin);
  return { index: `n${midi}`, label: '', midi, short: name, octave, note: `${name}${octave}`, hz: noteNumberToHz(midi, a4) };
}
