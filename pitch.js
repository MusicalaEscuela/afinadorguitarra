/*
  Pitch detection para guitarra.
  Usa YIN con umbral adaptado a cuerdas de guitarra estándar.
  La meta no es adivinar cualquier ruido humano, sino medir una cuerda clara y estable.
*/

export function getRms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

export function getPeak(buffer) {
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.abs(buffer[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export function stdDev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function removeDcOffset(input) {
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) sum += input[i];
  const dc = sum / input.length;

  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) output[i] = input[i] - dc;
  return output;
}

function parabolicInterpolation(values, tau) {
  const left = values[tau - 1];
  const center = values[tau];
  const right = values[tau + 1];
  const divisor = left + right - 2 * center;
  if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-12) return tau;
  return tau + (left - right) / (2 * divisor);
}

export function detectPitchYin(inputBuffer, sampleRate, options = {}) {
  const {
    minFrequency = 65,
    maxFrequency = 420,
    threshold = 0.12,
    minRms = 0.006,
  } = options;

  const rms = getRms(inputBuffer);
  const peak = getPeak(inputBuffer);

  if (rms < minRms || peak < minRms * 3) {
    return { pitch: null, confidence: 0, rms, peak, reason: 'weak-signal' };
  }

  const buffer = removeDcOffset(inputBuffer);
  const size = buffer.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const tauMax = Math.min(Math.floor(sampleRate / minFrequency), Math.floor(size / 2) - 2);

  if (tauMax <= tauMin) {
    return { pitch: null, confidence: 0, rms, peak, reason: 'buffer-too-small' };
  }

  // Ventana fija: todos los periodos se comparan con la misma cantidad de muestras.
  // Con una ventana variable los periodos largos (cuerdas graves) quedaban sesgados.
  const windowSize = size - tauMax - 1;
  const diff = new Float32Array(tauMax + 2);

  for (let tau = 1; tau <= tauMax + 1; tau += 1) {
    let sum = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  const yin = new Float32Array(tauMax + 2);
  yin[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax + 1; tau += 1) {
    runningSum += diff[tau];
    yin[tau] = runningSum === 0 ? 1 : (diff[tau] * tau) / runningSum;
  }

  let selectedTau = -1;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    if (yin[tau] < threshold) {
      while (tau + 1 <= tauMax && yin[tau + 1] < yin[tau]) tau += 1;
      selectedTau = tau;
      break;
    }
  }

  if (selectedTau === -1) {
    let bestTau = tauMin;
    let bestValue = yin[tauMin];
    for (let tau = tauMin + 1; tau <= tauMax; tau += 1) {
      if (yin[tau] < bestValue) {
        bestValue = yin[tau];
        bestTau = tau;
      }
    }

    if (bestValue > 0.24) {
      return { pitch: null, confidence: Math.max(0, 1 - bestValue), rms, peak, reason: 'unclear-pitch' };
    }

    selectedTau = bestTau;
  }

  // Interpolación sobre la diferencia sin normalizar: la normalización de YIN
  // desplaza el mínimo y dejaba un sesgo de 1-3 cents.
  const refinedTau = selectedTau > 1 ? parabolicInterpolation(diff, selectedTau) : selectedTau;

  const pitch = sampleRate / refinedTau;
  const confidence = Math.max(0, Math.min(1, 1 - yin[selectedTau]));

  if (!Number.isFinite(pitch) || pitch < minFrequency || pitch > maxFrequency) {
    return { pitch: null, confidence, rms, peak, reason: 'out-of-range' };
  }

  return { pitch, confidence, rms, peak, reason: 'ok' };
}

// --- Medición fina por fase ---------------------------------------------------
// YIN encuentra la nota; luego se mide la frecuencia exacta comparando la fase de
// cada armónico entre dos mitades del cuadro (método de vocoder de fase).

const hannCache = new Map();
function getHann(length) {
  if (!hannCache.has(length)) {
    const w = new Float32Array(length);
    for (let i = 0; i < length; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    hannCache.set(length, w);
  }
  return hannCache.get(length);
}

// DFT de un solo bin (frecuencia arbitraria) con ventana de Hann.
function toneAt(buffer, start, length, freq, sampleRate) {
  const w = getHann(length);
  const step = (2 * Math.PI * freq) / sampleRate;
  // Recurrencia de rotación: evita llamar sin/cos en cada muestra.
  const cosStep = Math.cos(step);
  const sinStep = Math.sin(step);
  let c = 1;
  let s = 0;
  let re = 0;
  let im = 0;
  for (let i = 0; i < length; i += 1) {
    const v = buffer[start + i] * w[i];
    re += v * c;
    im -= v * s;
    const nc = c * cosStep - s * sinStep;
    s = s * cosStep + c * sinStep;
    c = nc;
  }
  return { re, im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
}

function wrapPhase(value) {
  return value - 2 * Math.PI * Math.round(value / (2 * Math.PI));
}

function magnitudeAt(buffer, freq, sampleRate) {
  return toneAt(buffer, 0, buffer.length, freq, sampleRate).mag;
}

// Corrige errores de octava: si los armónicos impares del candidato casi no existen,
// la nota real está una octava arriba.
export function correctOctave(buffer, pitch, sampleRate, maxFrequency) {
  let f = pitch;
  for (let guard = 0; guard < 2 && f * 2 <= maxFrequency * 1.03; guard += 1) {
    const odd = magnitudeAt(buffer, f, sampleRate) + magnitudeAt(buffer, 3 * f, sampleRate);
    const even = magnitudeAt(buffer, 2 * f, sampleRate) + magnitudeAt(buffer, 4 * f, sampleRate);
    if (odd >= 0.12 * even) break;
    f *= 2;
  }
  return f;
}

export function refinePitchByPhase(buffer, pitch, sampleRate, { harmonics = 3 } = {}) {
  const half = Math.floor(buffer.length / 2);
  if (half < 1024) return { pitch, coherence: 0 };

  let estimate = pitch;
  let coherence = 0;
  // Dos pasadas: la primera con el fundamental afina la estimación para que los
  // armónicos superiores no caigan en ambigüedad de fase.
  for (const maxHarmonic of [1, harmonics]) {
    let weightSum = 0;
    let freqSum = 0;
    let magSum = 0;
    let energy = 0;
    for (let h = 1; h <= maxHarmonic; h += 1) {
      const fh = estimate * h;
      if (fh >= sampleRate / 2.2) break;
      const a = toneAt(buffer, 0, half, fh, sampleRate);
      const b = toneAt(buffer, half, half, fh, sampleRate);
      const expected = (2 * Math.PI * fh * half) / sampleRate;
      const deviation = wrapPhase(b.phase - a.phase - expected);
      const trueFh = fh + (deviation * sampleRate) / (2 * Math.PI * half);
      // Pesar por energía y penalizar armónicos altos (inarmonicidad de la cuerda).
      const weight = (a.mag * b.mag) / (h * h * h);
      weightSum += weight;
      freqSum += weight * (trueFh / h);
      magSum += Math.abs(a.mag - b.mag);
      energy += a.mag + b.mag;
    }
    if (weightSum <= 0) return { pitch, coherence: 0 };
    estimate = freqSum / weightSum;
    coherence = energy > 0 ? 1 - magSum / energy : 0;
  }

  // Si la fase da algo muy lejos de YIN, desconfiar y quedarse con YIN.
  if (Math.abs(1200 * Math.log2(estimate / pitch)) > 40) return { pitch, coherence: 0 };
  return { pitch: estimate, coherence };
}

// Análisis completo de un cuadro: YIN (nota) + octava + fase (precisión).
export function analyzeFrame(inputBuffer, sampleRate, options = {}) {
  const { yinSize = 4096, maxFrequency = 420, expectedHz = null } = options;
  const yinBuffer = inputBuffer.length > yinSize
    ? inputBuffer.subarray(inputBuffer.length - yinSize)
    : inputBuffer;
  const coarse = detectPitchYin(yinBuffer, sampleRate, options);
  if (!coarse.pitch) return coarse;

  const buffer = removeDcOffset(inputBuffer);
  let pitch = correctOctave(buffer, coarse.pitch, sampleRate, maxFrequency);

  // Modo manual: plegar a la octava de la cuerda esperada.
  if (expectedHz) {
    const octaves = Math.round(Math.log2(expectedHz / pitch));
    if (octaves !== 0 && Math.abs(octaves) <= 2) pitch *= 2 ** octaves;
  }

  const refined = refinePitchByPhase(buffer, pitch, sampleRate);
  return { ...coarse, pitch: refined.pitch, coarsePitch: coarse.pitch, coherence: refined.coherence };
}
