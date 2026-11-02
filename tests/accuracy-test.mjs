/*
  Banco de pruebas de precisión.
  Genera tonos tipo guitarra (armónicos, decaimiento, ruido) con desafinación conocida
  y mide el error del motor en cents. Uso: node tests/accuracy-test.mjs [ruta-motor]
*/
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const enginePath = process.argv[2] || './pitch.js';
const engine = await import(pathToFileURL(path.resolve(enginePath)).href);
const analyze = engine.analyzeFrame || engine.detectPitchYin;

const SR = 48000;
const FRAME = 8192;
const STRINGS = [
  ['6ª E2', 40], ['5ª A2', 45], ['4ª D3', 50], ['3ª G3', 55], ['2ª B3', 59], ['1ª E4', 64], ['Drop C C2', 36],
];
const OFFSETS = [-23.4, -7.1, -1.3, 0, 0.6, 3.7, 12.9, 31.2];

// Ruido determinista para resultados reproducibles.
let seed = 12345;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296 - 0.5;
}

function guitarTone(f0, { weakFundamental = false, noise = 0.01, inharm = 0.00008 } = {}) {
  const out = new Float32Array(FRAME);
  const amps = weakFundamental ? [0.15, 1, 0.7, 0.5, 0.35, 0.2] : [1, 0.6, 0.4, 0.25, 0.15, 0.1];
  const phases = amps.map(() => Math.random() * 2 * Math.PI);
  const t0 = 0.4 * SR; // la cuerda lleva 0.4 s sonando
  for (let i = 0; i < FRAME; i += 1) {
    const t = (i + t0) / SR;
    let v = 0;
    amps.forEach((a, k) => {
      const h = k + 1;
      const fh = f0 * h * Math.sqrt(1 + inharm * h * h);
      v += a * Math.exp(-t * (1.2 + h * 0.6)) * Math.sin(2 * Math.PI * fh * t + phases[k]);
    });
    out[i] = 0.3 * v + noise * rand();
  }
  return out;
}

const scenarios = [
  ['limpio', {}],
  ['fundamental débil', { weakFundamental: true }],
  ['ruido alto', { noise: 0.06 }],
];

let worst = 0;
let total = 0;
let count = 0;
let failures = 0;
for (const [label, opts] of scenarios) {
  console.log(`\n== ${label} ==`);
  for (const [name, midi] of STRINGS) {
    const errs = [];
    for (const off of OFFSETS) {
      const target = 440 * 2 ** ((midi - 69) / 12);
      const f0 = target * 2 ** (off / 1200);
      const res = analyze(guitarTone(f0, opts), SR, { minFrequency: 60, maxFrequency: 420, expectedHz: null });
      if (!res.pitch) { failures += 1; errs.push(NaN); continue; }
      // Error relativo a la frecuencia fundamental real (sin inarmonicidad).
      const err = 1200 * Math.log2(res.pitch / f0);
      errs.push(err);
    }
    const valid = errs.filter(Number.isFinite);
    const maxAbs = valid.length ? Math.max(...valid.map(Math.abs)) : NaN;
    worst = Math.max(worst, Number.isFinite(maxAbs) ? maxAbs : 0);
    valid.forEach((e) => { total += Math.abs(e); count += 1; });
    console.log(`${name.padEnd(10)} máx |error| ${maxAbs.toFixed(3).padStart(8)} c   fallos ${errs.length - valid.length}`);
  }
}
console.log(`\nRESUMEN error medio ${(total / count).toFixed(3)} c · peor ${worst.toFixed(3)} c · sin lectura ${failures}`);
