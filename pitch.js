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

  const yin = new Float32Array(tauMax + 1);

  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    let sum = 0;
    const limit = size - tau;
    for (let i = 0; i < limit; i += 1) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    yin[tau] = sum;
  }

  yin[0] = 1;
  let runningSum = 0;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    runningSum += yin[tau];
    yin[tau] = runningSum === 0 ? 1 : (yin[tau] * tau) / runningSum;
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

  const refinedTau = selectedTau > tauMin && selectedTau < tauMax
    ? parabolicInterpolation(yin, selectedTau)
    : selectedTau;

  const pitch = sampleRate / refinedTau;
  const confidence = Math.max(0, Math.min(1, 1 - yin[selectedTau]));

  if (!Number.isFinite(pitch) || pitch < minFrequency || pitch > maxFrequency) {
    return { pitch: null, confidence, rms, peak, reason: 'out-of-range' };
  }

  return { pitch, confidence, rms, peak, reason: 'ok' };
}
