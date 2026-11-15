/*
  Captura del micrófono y análisis continuo.
  Micrófono → filtros → AudioWorklet (cuadros a ritmo constante) → analyzeFrame.
  Entrega cada resultado por `onResult`; no sabe nada de la interfaz.
*/
import { analyzeFrame } from './pitch.js';

const FRAME_SIZE = 16384; // suficiente para las notas más graves (A0)
const FRAME_HOP = 2048; // un cuadro nuevo cada ~43 ms
const FALLBACK_INTERVAL_MS = 45;
const BASE_MIN_RMS = 0.005;
const ATTACK_RATIO = 1.8; // subida de volumen que se considera un nuevo ataque
const ATTACK_SETTLE_MS = 110; // justo después del ataque la nota suena alta

export class TunerEngine {
  constructor({ onResult, onAttack }) {
    this.onResult = onResult;
    this.onAttack = onAttack;
    this.running = false;
    this.profile = { minFrequency: 60, maxFrequency: 500, expectedHz: null, sustained: false };
    this.resetTracking();
  }

  resetTracking() {
    this.lastRms = 0;
    this.attackAt = -Infinity;
    this.noiseFloor = 0;
  }

  get sampleRate() {
    return this.context ? this.context.sampleRate : 48000;
  }

  // Rango del instrumento activo. Se puede cambiar con el micrófono encendido.
  setProfile(profile) {
    this.profile = { ...this.profile, ...profile };
    this.applyFilters();
  }

  applyFilters() {
    if (!this.highPass) return;
    const { minFrequency, maxFrequency } = this.profile;
    // Dejar pasar hasta el 3er armónico de la nota más aguda.
    this.highPass.frequency.value = Math.max(18, minFrequency * 0.7);
    this.lowPass.frequency.value = Math.min(9000, Math.max(1200, maxFrequency * 3.5));
  }

  async start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.context = new Ctx({ latencyHint: 'interactive' });
    try {
      this.stream = await requestMicrophone();
      if (this.context.state === 'suspended') await this.context.resume();

      this.source = this.context.createMediaStreamSource(this.stream);
      this.highPass = this.context.createBiquadFilter();
      this.highPass.type = 'highpass';
      this.highPass.Q.value = 0.7;
      this.lowPass = this.context.createBiquadFilter();
      this.lowPass.type = 'lowpass';
      this.lowPass.Q.value = 0.7;
      this.applyFilters();
      this.source.connect(this.highPass);
      this.highPass.connect(this.lowPass);

      this.running = true;
      this.resetTracking();
      await this.connectCapture();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async connectCapture() {
    try {
      await this.context.audioWorklet.addModule('./tuner-worklet.js');
      this.worklet = new AudioWorkletNode(this.context, 'tuner-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { frameSize: FRAME_SIZE, hop: FRAME_HOP },
      });
      this.worklet.port.onmessage = (event) => this.processFrame(event.data);
      this.lowPass.connect(this.worklet);
    } catch (error) {
      // Respaldo para navegadores sin AudioWorklet.
      console.warn('AudioWorklet no disponible, uso AnalyserNode.', error);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = FRAME_SIZE;
      this.analyser.smoothingTimeConstant = 0;
      const buffer = new Float32Array(FRAME_SIZE);
      this.lowPass.connect(this.analyser);
      this.timer = setInterval(() => {
        this.analyser.getFloatTimeDomainData(buffer);
        this.processFrame(buffer);
      }, FALLBACK_INTERVAL_MS);
    }
  }

  processFrame(frame) {
    if (!this.running) return;
    const now = performance.now();
    const { minFrequency, maxFrequency, expectedHz } = this.profile;

    // Umbral de silencio adaptado al ruido del ambiente.
    const minRms = Math.max(BASE_MIN_RMS, this.noiseFloor * 2.5);
    const result = analyzeFrame(frame, this.sampleRate, { minFrequency, maxFrequency, expectedHz, minRms });

    if (!result.pitch) {
      const target = Math.min(result.rms, 0.02);
      this.noiseFloor += (target - this.noiseFloor) * (target < this.noiseFloor ? 0.3 : 0.02);
    }

    // Nuevo ataque: lo medido antes ya no vale.
    if (result.rms > minRms && result.rms > this.lastRms * ATTACK_RATIO) {
      this.attackAt = now;
      if (this.onAttack) this.onAttack();
    }
    this.lastRms = result.rms;

    // Ignorar los cuadros cuya ventana de medición todavía incluye el ataque.
    const sinceAttack = now - this.attackAt;
    const spanMs = (result.spanSeconds || 0.2) * 1000;
    if (sinceAttack < spanMs + ATTACK_SETTLE_MS) {
      if (result.pitch || sinceAttack < 400) return;
    }

    this.onResult(result);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.worklet) this.worklet.port.onmessage = null;
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') this.context.close();
    this.timer = null;
    this.worklet = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.highPass = null;
    this.lowPass = null;
    this.context = null;
  }
}

// Pide el micrófono sin procesamiento de voz, que altera el tono.
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
