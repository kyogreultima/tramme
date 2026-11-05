/** Preview-only metering; none of this changes the samples sent to the mix. */
import type { ToolType } from '@tramme/core';

export const METER_FLOOR = -80;
export interface LevelReading { peak: number; rms: number; hold: number; clipped: boolean }
const db = (amplitude: number) => Math.max(METER_FLOOR, 20 * Math.log10(amplitude));

export class LevelMeter {
  private held = METER_FLOOR;
  private until = 0;
  private last = 0;
  private clipped = false;

  reset() { this.held = METER_FLOOR; this.until = this.last = 0; this.clipped = false; }

  /** `now` is a monotonic time in seconds, independent of the film's playhead. */
  read(channels: Float32Array[], now: number): LevelReading {
    let peak = 0, square = 0, count = 0;
    for (const channel of channels) for (const sample of channel) {
      peak = Math.max(peak, Math.abs(sample));
      square += sample * sample;
      count++;
    }
    const peakDb = db(peak), rms = db(count ? Math.sqrt(square / count) : 0);
    this.held = Math.max(peakDb, this.held - 12 * Math.max(0, now - Math.max(this.last, this.until)));
    if (peakDb >= this.held) { this.held = peakDb; this.until = now + 1; }
    this.last = now;
    this.clipped ||= peak >= 1;
    return { peak: peakDb, rms, hold: this.held, clipped: this.clipped };
  }
}

/** Side branches on the preview graph. Closing the mixer removes every analyser. */
export class MeterTaps {
  private visible = false;
  private clipped = new Set<string>();
  private sources = new Map<string, { ctx: BaseAudioContext; nodes: Set<AudioNode> }>();
  private taps = new Map<string, { input: GainNode; splitter: ChannelSplitterNode; analysers: AnalyserNode[]; samples: Float32Array<ArrayBuffer>[]; meter: LevelMeter }>();

  source(id: string, ctx: BaseAudioContext, node: AudioNode) {
    let group = this.sources.get(id);
    if (!group) { group = { ctx, nodes: new Set() }; this.sources.set(id, group); }
    if (group.nodes.has(node)) return;
    group.nodes.add(node);
    if (this.visible) {
      if (this.taps.has(id)) node.connect(this.taps.get(id)!.input);
      else this.attach(id);
    }
  }

  show(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) for (const id of this.sources.keys()) this.attach(id);
    else this.detach();
  }

  private attach(id: string) {
    const group = this.sources.get(id)!;
    // Upmix mono on a gain: a splitter must keep its discrete interpretation.
    const input = group.ctx.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers';
    const splitter = group.ctx.createChannelSplitter(2);
    input.connect(splitter);
    const analysers = [0, 1].map((channel) => {
      const analyser = group.ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      splitter.connect(analyser, channel);
      return analyser;
    });
    for (const node of group.nodes) node.connect(input);
    this.taps.set(id, { input, splitter, analysers, samples: analysers.map((a) => new Float32Array(a.fftSize)), meter: new LevelMeter() });
  }

  private detach() {
    for (const [id, tap] of this.taps) {
      for (const node of this.sources.get(id)?.nodes ?? []) node.disconnect(tap.input);
      tap.input.disconnect();
      tap.splitter.disconnect();
      for (const analyser of tap.analysers) analyser.disconnect();
    }
    this.taps.clear();
  }

  read(now: number): Record<string, LevelReading> {
    const readings: Record<string, LevelReading> = {};
    if (!this.visible) return readings;
    for (const id of this.clipped) readings[id] = { peak: METER_FLOOR, rms: METER_FLOOR, hold: METER_FLOOR, clipped: true };
    for (const [id, tap] of this.taps) {
      tap.analysers.forEach((a, i) => a.getFloatTimeDomainData(tap.samples[i]));
      readings[id] = tap.meter.read(tap.samples, now);
      if (readings[id].clipped) this.clipped.add(id);
      readings[id].clipped ||= this.clipped.has(id);
    }
    return readings;
  }

  reset(id: string) { this.clipped.delete(id); this.taps.get(id)?.meter.reset(); }
  clear(newProject = false) { this.detach(); this.sources.clear(); if (newProject) this.clipped.clear(); }
}

export const previewMeters = new MeterTaps();

export const metersTool: ToolType<{ reset?: string }> = {
  name: 'meters', title: 'Live audio meters', description: 'reads peak, RMS, peak hold and clipping from the open mixer; optionally resets a track clipping indicator',
  input: { type: 'object', properties: { reset: { type: 'string', title: 'Reset clipping on track' } } },
  ai: {
    when: 'while the mixer panel is open: read the same live dBFS levels as its strips, or reset a clipping indicator by track id',
    avoid: 'using an empty reading as proof of silence: closing the mixer removes its analysers; use check for an offline measure of the complete mix',
  },
  run(input) {
    if (input.reset) previewMeters.reset(input.reset);
    return { text: JSON.stringify(previewMeters.read(performance.now() / 1000)) };
  },
};
