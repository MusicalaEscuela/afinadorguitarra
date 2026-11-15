/*
  Estabilizador de lecturas (sin DOM): junta las últimas mediciones de una misma
  nota, descarta las atípicas y entrega un valor estable para mostrar.
*/
import { median } from './pitch.js';

const HISTORY_LIMIT = 14;
const WINDOW = 10;
export const MIN_CONFIDENCE = 0.68;

export class ReadingStabilizer {
  constructor() {
    this.reset();
  }

  reset() {
    this.history = [];
    this.key = null;
    this.lastStablePitch = null;
  }

  // Olvida las mediciones pero conserva la nota: se usa al cambiar de objetivo.
  clear() {
    this.history = [];
  }

  // Si la lectura salta exactamente una octava respecto a la nota que veníamos
  // midiendo, es un error de octava y no un cambio de nota.
  foldOctave(pitch) {
    if (!this.lastStablePitch) return pitch;
    const octaves = Math.round(Math.log2(this.lastStablePitch / pitch));
    if (octaves === 0) return pitch;
    const folded = pitch * 2 ** octaves;
    return Math.abs(1200 * Math.log2(folded / this.lastStablePitch)) < 60 ? folded : pitch;
  }

  // `key` identifica el objetivo (cuerda o nota); al cambiar se reinicia el historial.
  push(sample, key) {
    if (key !== this.key) {
      this.history = [];
      this.key = key;
    }
    this.history.push(sample);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  stable() {
    const usable = this.history.filter((item) => item.confidence >= MIN_CONFIDENCE);
    if (!usable.length) return null;

    const recent = usable.slice(-WINDOW);
    const center = median(recent.map((item) => item.cents));
    const deviations = recent.map((item) => Math.abs(item.cents - center));
    // Descartar valores atípicos (MAD) antes de promediar.
    const mad = Math.max(0.3, median(deviations));
    const inliers = recent.filter((_, i) => deviations[i] <= 3 * mad + 0.5);

    // Media ponderada por confianza: más precisa que la mediana de cuadros solapados.
    let weightSum = 0;
    let centsSum = 0;
    let logPitchSum = 0;
    let confidenceSum = 0;
    inliers.forEach((item) => {
      const weight = item.confidence * item.confidence;
      weightSum += weight;
      centsSum += weight * item.cents;
      logPitchSum += weight * Math.log(item.pitch);
      confidenceSum += item.confidence;
    });

    const cents = centsSum / weightSum;
    const pitch = Math.exp(logPitchSum / weightSum);
    const confidence = confidenceSum / inliers.length;
    const spread = Math.sqrt(inliers.reduce((acc, item) => acc + (item.cents - cents) ** 2, 0) / inliers.length);
    const isStable = inliers.length >= 3 && spread <= 2.5;
    if (isStable) this.lastStablePitch = pitch;

    return {
      cents,
      pitch,
      confidence,
      stability: Math.min(100, Math.max(0, 100 - spread * 13)),
      isStable,
    };
  }
}
