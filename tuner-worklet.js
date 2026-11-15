/*
  AudioWorklet: acumula el audio del micrófono en un búfer circular y envía un
  cuadro completo cada `hop` muestras. Así el análisis no depende del refresco
  de pantalla y no se pierden cuadros.
*/
class TunerCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { frameSize = 16384, hop = 2048 } = options.processorOptions || {};
    this.frameSize = frameSize;
    this.hop = hop;
    this.ring = new Float32Array(frameSize);
    this.writeIndex = 0;
    this.filled = 0;
    this.sinceLast = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this.ring[this.writeIndex] = channel[i];
      this.writeIndex = (this.writeIndex + 1) % this.frameSize;
    }
    this.filled = Math.min(this.frameSize, this.filled + channel.length);
    this.sinceLast += channel.length;

    if (this.filled === this.frameSize && this.sinceLast >= this.hop) {
      this.sinceLast = 0;
      const frame = new Float32Array(this.frameSize);
      const tail = this.frameSize - this.writeIndex;
      frame.set(this.ring.subarray(this.writeIndex), 0);
      frame.set(this.ring.subarray(0, this.writeIndex), tail);
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor('tuner-capture', TunerCaptureProcessor);
