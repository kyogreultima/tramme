import { loudnessSeries, truePeakEnvelope } from '@tramme/core';

export interface MasterReading { lufs: number | null; truePeak: number }

/** A bounded, contiguous three-second stereo window; no frame is counted twice. */
export class MasterMeter {
  private rate: number;
  private channels: Float32Array<ArrayBuffer>[];
  private tails = [new Float32Array(12), new Float32Array(12)];
  private write = 0;
  private filled = 0;
  private sinceMeasure = 0;
  private frame: number;
  reading: MasterReading = { lufs: null, truePeak: -80 };

  constructor(rate: number, frame = 0) {
    this.rate = rate;
    this.frame = frame;
    this.channels = [new Float32Array(Math.round(rate * 3)), new Float32Array(Math.round(rate * 3))];
  }

  reset() {
    this.channels.forEach((channel) => channel.fill(0));
    this.tails.forEach((channel) => channel.fill(0));
    this.write = this.filled = this.sinceMeasure = 0;
    this.reading = { lufs: null, truePeak: -80 };
  }

  /** Snapshot of an analyser ending at an audio-context sample frame. */
  capture(channels: Float32Array[], frame: number): MasterReading {
    const elapsed = frame - this.frame, available = channels[0]?.length ?? 0;
    if (!elapsed || !available) return this.reading;
    if (elapsed < 0 || elapsed > available) this.reset();
    const count = Math.min(available, elapsed < 0 ? Math.max(0, frame) : elapsed);
    this.frame = frame;
    return this.push(channels.map((channel) => channel.subarray(available - count)), channels);
  }

  push(input: Float32Array[], snapshot?: Float32Array[]): MasterReading {
    const n = input[0]?.length ?? 0;
    if (!n) return this.reading;
    const size = this.channels[0].length;
    const stereo = [input[0], input[1] ?? input[0]];
    const peakInput = stereo.map((channel, i) => {
      // Analyser snapshots and currentTime can straddle a render quantum.
      // Measure true peak within one coherent native window, rather than
      // interpolating across a seam assembled from two timestamped reads.
      if (snapshot) {
        const coherent = snapshot[i] ?? snapshot[0];
        const samples = coherent.subarray(Math.max(0, coherent.length - 2060));
        this.tails[i].set(samples.subarray(Math.max(0, samples.length - 12)));
        return samples;
      }
      const samples = new Float32Array(n + 12);
      samples.set(this.tails[i]);
      samples.set(channel, 12);
      this.tails[i].set(samples.subarray(samples.length - 12));
      return samples;
    });
    let peak = 0;
    const envelope = truePeakEnvelope(peakInput);
    // Leave six samples at either edge: packets carry their preceding tail,
    // while analyser snapshots supply their own coherent interpolation window.
    for (let i = 6; i < envelope.length - 6; i++) peak = Math.max(peak, envelope[i]);
    const truePeak = Math.max(-80, 20 * Math.log10(peak));
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) this.channels[c][this.write] = stereo[c][i];
      this.write = (this.write + 1) % size;
    }
    this.filled = Math.min(size, this.filled + n);
    this.sinceMeasure += n;
    let lufs = this.reading.lufs;
    if (this.filled === size && this.sinceMeasure >= this.rate / 10) {
      const ordered = this.channels.map((channel) => {
        const samples = new Float32Array(size);
        samples.set(channel.subarray(this.write));
        samples.set(channel.subarray(0, this.write), size - this.write);
        return samples;
      });
      lufs = loudnessSeries(ordered, this.rate, 'short-term')[0].lufs;
      this.sinceMeasure %= Math.round(this.rate / 10);
    }
    this.reading = { lufs, truePeak };
    return this.reading;
  }
}
