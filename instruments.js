/*
  Catálogo de instrumentos y afinaciones.
  Cada afinación lista la nota MIDI de cada cuerda, de la última cuerda a la 1ª.
  El modo cromático no tiene cuerdas: reconoce cualquier nota.
*/
import { noteNumberToHz } from './tuner-config.js';

export const INSTRUMENTS = [
  {
    id: 'chromatic',
    name: 'Cromático',
    hint: 'Cualquier instrumento o voz',
    range: [26, 2200], // A0 … C7
    sustained: true,
  },
  {
    id: 'guitar',
    name: 'Guitarra',
    hint: '6 cuerdas',
    tunings: [
      { id: 'standard', name: 'Estándar', desc: 'E A D G B E', midis: [40, 45, 50, 55, 59, 64] },
      { id: 'drop-d', name: 'Drop D', desc: 'D A D G B E', midis: [38, 45, 50, 55, 59, 64] },
      { id: 'half-step', name: '½ tono abajo', desc: 'E♭ A♭ D♭ G♭ B♭ E♭', midis: [39, 44, 49, 54, 58, 63] },
      { id: 'full-step', name: '1 tono abajo', desc: 'D G C F A D', midis: [38, 43, 48, 53, 57, 62] },
      { id: 'drop-c', name: 'Drop C', desc: 'C G C F A D', midis: [36, 43, 48, 53, 57, 62] },
      { id: 'dadgad', name: 'DADGAD', desc: 'D A D G A D', midis: [38, 45, 50, 55, 57, 62] },
      { id: 'open-g', name: 'Open G', desc: 'D G D G B D', midis: [38, 43, 50, 55, 59, 62] },
      { id: 'open-d', name: 'Open D', desc: 'D A D F♯ A D', midis: [38, 45, 50, 54, 57, 62] },
    ],
  },
  {
    id: 'bass',
    name: 'Bajo',
    hint: '4 o 5 cuerdas',
    tunings: [
      { id: 'standard', name: '4 cuerdas', desc: 'E A D G', midis: [28, 33, 38, 43] },
      { id: 'five', name: '5 cuerdas', desc: 'B E A D G', midis: [23, 28, 33, 38, 43] },
      { id: 'drop-d', name: 'Drop D', desc: 'D A D G', midis: [26, 33, 38, 43] },
    ],
  },
  {
    id: 'ukulele',
    name: 'Ukelele',
    hint: 'Soprano, concierto, tenor',
    tunings: [
      { id: 'standard', name: 'Estándar', desc: 'G C E A', midis: [67, 60, 64, 69] },
      { id: 'low-g', name: 'Sol grave', desc: 'G C E A', midis: [55, 60, 64, 69] },
      { id: 'baritone', name: 'Barítono', desc: 'D G B E', midis: [50, 55, 59, 64] },
    ],
  },
  {
    id: 'violin',
    name: 'Violín',
    hint: 'G D A E',
    sustained: true,
    tunings: [{ id: 'standard', name: 'Estándar', desc: 'G D A E', midis: [55, 62, 69, 76] }],
  },
  {
    id: 'viola',
    name: 'Viola',
    hint: 'C G D A',
    sustained: true,
    tunings: [{ id: 'standard', name: 'Estándar', desc: 'C G D A', midis: [48, 55, 62, 69] }],
  },
  {
    id: 'cello',
    name: 'Violonchelo',
    hint: 'C G D A',
    sustained: true,
    tunings: [{ id: 'standard', name: 'Estándar', desc: 'C G D A', midis: [36, 43, 50, 57] }],
  },
  {
    id: 'double-bass',
    name: 'Contrabajo',
    hint: 'E A D G',
    sustained: true,
    tunings: [{ id: 'standard', name: 'Estándar', desc: 'E A D G', midis: [28, 33, 38, 43] }],
  },
  {
    id: 'tiple',
    name: 'Tiple',
    hint: 'Tiple colombiano',
    tunings: [{ id: 'standard', name: 'Estándar', desc: 'D G B E', midis: [62, 67, 59, 64] }],
  },
  {
    id: 'charango',
    name: 'Charango',
    hint: '5 órdenes',
    tunings: [{ id: 'standard', name: 'Estándar', desc: 'G C E A E', midis: [67, 72, 76, 69, 76] }],
  },
  {
    id: 'cuatro',
    name: 'Cuatro',
    hint: 'Cuatro llanero',
    tunings: [{ id: 'standard', name: 'Estándar', desc: 'A D F♯ B', midis: [57, 62, 66, 59] }],
  },
  {
    id: 'mandolin',
    name: 'Mandolina',
    hint: 'G D A E',
    tunings: [{ id: 'standard', name: 'Estándar', desc: 'G D A E', midis: [55, 62, 69, 76] }],
  },
  {
    id: 'banjo',
    name: 'Banjo',
    hint: '5 cuerdas',
    tunings: [{ id: 'standard', name: 'Open G', desc: 'G D G B D', midis: [67, 50, 55, 59, 62] }],
  },
];

export const DEFAULT_INSTRUMENT_ID = 'guitar';

export function getInstrument(id) {
  return INSTRUMENTS.find((instrument) => instrument.id === id)
    || INSTRUMENTS.find((instrument) => instrument.id === DEFAULT_INSTRUMENT_ID);
}

export function getTuning(instrumentId, tuningId) {
  const instrument = getInstrument(instrumentId);
  if (!instrument.tunings) return null;
  return instrument.tunings.find((tuning) => tuning.id === tuningId) || instrument.tunings[0];
}

// Rango de frecuencias que el motor debe escuchar para un instrumento.
// Deja margen hacia abajo y hacia arriba para cuerdas muy desafinadas.
export function getDetectionRange(instrumentId, tuningId, a4 = 440) {
  const instrument = getInstrument(instrumentId);
  const tuning = getTuning(instrumentId, tuningId);
  if (!tuning) return { minFrequency: instrument.range[0], maxFrequency: instrument.range[1] };
  const low = noteNumberToHz(Math.min(...tuning.midis), a4);
  const high = noteNumberToHz(Math.max(...tuning.midis), a4);
  return { minFrequency: low * 0.74, maxFrequency: high * 1.5 };
}
