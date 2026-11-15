/*
  Banco de pruebas de precisión.
  Genera tonos sintéticos (cuerda, viento, seno) con desafinación conocida y mide
  el error del motor en cents. Uso: node tests/accuracy-test.mjs
*/
import { analyzeFrame } from '../pitch.js';
import { INSTRUMENTS, getDetectionRange } from '../instruments.js';

const FRAME = 16384;
const OFFSETS = [-23.4, -7.1, -1.3, 0, 0.6, 3.7, 12.9, 31.2];

// Ruido determinista para resultados reproducibles.
let seed = 12345;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const TIMBRES = {
  cuerda: [1, 0.6, 0.4, 0.25, 0.15, 0.1],
  debil: [0.15, 1, 0.7, 0.5, 0.35, 0.2],
  viento: [1, 0.04, 0.5, 0.03, 0.25, 0.02],
  seno: [1],
};

function tone(f0, sampleRate, { timbre = 'cuerda', noise = 0.01, inharm = 0.00008, decay = true } = {}) {
  const out = new Float32Array(FRAME);
  const amps = TIMBRES[timbre];
  const phases = amps.map(() => rand() * 2 * Math.PI);
  const t0 = 0.4 * sampleRate; // la nota lleva 0.4 s sonando
  for (let i = 0; i < FRAME; i += 1) {
    const t = (i + t0) / sampleRate;
    let v = 0;
    amps.forEach((a, k) => {
      const h = k + 1;
      const fh = f0 * h * Math.sqrt(1 + inharm * h * h);
      if (fh > sampleRate / 2.3) return;
      const env = decay ? Math.exp(-t * (1.2 + h * 0.6)) : 0.5;
      v += a * env * Math.sin(2 * Math.PI * fh * t + phases[k]);
    });
    out[i] = 0.3 * v + noise * (rand() - 0.5);
  }
  return out;
}

const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const stats = { total: 0, count: 0, worst: 0, failures: 0 };
const verbose = process.argv.includes('--verbose');

function runCase(label, hz, range, sampleRate, opts) {
  const errs = [];
  for (const off of OFFSETS) {
    const f0 = hz * 2 ** (off / 1200);
    const res = analyzeFrame(tone(f0, sampleRate, opts), sampleRate, range);
    if (!res.pitch) { stats.failures += 1; errs.push(NaN); continue; }
    errs.push(1200 * Math.log2(res.pitch / f0));
  }
  const valid = errs.filter(Number.isFinite);
  const maxAbs = valid.length ? Math.max(...valid.map(Math.abs)) : NaN;
  if (Number.isFinite(maxAbs)) stats.worst = Math.max(stats.worst, maxAbs);
  valid.forEach((e) => { stats.total += Math.abs(e); stats.count += 1; });
  const bad = !(maxAbs < 1) || valid.length < errs.length;
  if (verbose || bad) {
    console.log(`  ${label.padEnd(30)} máx |error| ${maxAbs.toFixed(3).padStart(9)} c  sin lectura ${errs.length - valid.length}${bad ? '  [FALLA]' : ''}`);
  }
  return maxAbs;
}

for (const sampleRate of [48000, 44100]) {
  console.log(`\n===== ${sampleRate} Hz =====`);
  for (const instrument of INSTRUMENTS) {
    if (!instrument.tunings) continue;
    const tuning = instrument.tunings[instrument.id === 'bass' ? 1 : 0];
    const range = getDetectionRange(instrument.id, tuning.id);
    const worst = Math.max(...[...new Set(tuning.midis)].map((midi) => (
      runCase(`${instrument.name} midi ${midi}`, midiHz(midi), range, sampleRate, { decay: !instrument.sustained })
    )));
    console.log(`${instrument.name.padEnd(12)} (${tuning.name}) peor ${worst.toFixed(3)} c`);
  }

  const guitar = getDetectionRange('guitar', 'standard');
  let worst = 0;
  [40, 52, 64].forEach((midi) => {
    worst = Math.max(worst, runCase(`Guitarra ${midi} fund. débil`, midiHz(midi), guitar, sampleRate, { timbre: 'debil' }));
    worst = Math.max(worst, runCase(`Guitarra ${midi} ruido alto`, midiHz(midi), guitar, sampleRate, { noise: 0.06 }));
  });
  console.log(`Guitarra difícil (fundamental débil, ruido) peor ${worst.toFixed(3)} c`);

  const chromatic = getDetectionRange('chromatic');
  worst = 0;
  [21, 28, 36, 48, 60, 69, 81, 93, 96].forEach((midi) => {
    worst = Math.max(worst, runCase(`Cromático ${midi} cuerda`, midiHz(midi), chromatic, sampleRate, {}));
    worst = Math.max(worst, runCase(`Cromático ${midi} seno`, midiHz(midi), chromatic, sampleRate, { timbre: 'seno', decay: false, inharm: 0 }));
  });
  [50, 62, 74, 86].forEach((midi) => {
    worst = Math.max(worst, runCase(`Cromático ${midi} viento`, midiHz(midi), chromatic, sampleRate, { timbre: 'viento', decay: false, inharm: 0 }));
  });
  console.log(`Cromático A0–C7 (cuerda, seno, viento) peor ${worst.toFixed(3)} c`);
}

console.log(`\nRESUMEN error medio ${(stats.total / stats.count).toFixed(3)} c · peor ${stats.worst.toFixed(3)} c · sin lectura ${stats.failures}`);
if (stats.worst > 1 || stats.failures > 0) process.exitCode = 1;
