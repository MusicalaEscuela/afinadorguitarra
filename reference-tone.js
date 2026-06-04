/*
  Tono de referencia para afinar de oído.
  Sintetiza una nota con timbre de cuerda pulsada (varios armónicos + decaimiento)
  en vez de un seno plano, para que suene natural y sea fácil de igualar con el oído.
  Es independiente del contexto del micrófono: usa su propio AudioContext.
*/

export class ReferenceTone {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voice = null;
    this.playingHz = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.0001;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get isPlaying() {
    return this.playingHz !== null;
  }

  // Reproduce la nota objetivo. Si ya sonaba la misma, la detiene (toggle).
  toggle(hz) {
    if (this.isPlaying && Math.abs(this.playingHz - hz) < 0.01) {
      this.stop();
      return false;
    }
    this.play(hz);
    return true;
  }

  play(hz) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stop();

    const now = ctx.currentTime;
    const voice = ctx.createGain();
    voice.gain.value = 1;
    voice.connect(this.master);

    // Armónicos con amplitud decreciente: timbre cálido tipo cuerda.
    const partials = [1, 0.5, 0.32, 0.18, 0.1, 0.06];
    const oscillators = [];
    partials.forEach((amp, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz * (i + 1);
      g.gain.value = amp / partials.length;
      osc.connect(g).connect(voice);
      osc.start(now);
      oscillators.push(osc);
    });

    // Envolvente: ataque corto y sostenido suave (nota mantenida para afinar).
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0.0001, now);
    this.master.gain.exponentialRampToValueAtTime(0.22, now + 0.03);
    this.master.gain.exponentialRampToValueAtTime(0.14, now + 0.6);

    this.voice = { node: voice, oscillators };
    this.playingHz = hz;
  }

  stop() {
    if (!this.ctx || !this.voice) {
      this.playingHz = null;
      return;
    }
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), now);
    this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    const { oscillators } = this.voice;
    oscillators.forEach((osc) => {
      try { osc.stop(now + 0.14); } catch (_) { /* ya detenido */ }
    });
    this.voice = null;
    this.playingHz = null;
  }
}
