import { describe, expect, it } from 'vitest';
import { LevelMeter, METER_FLOOR, MeterTaps, metersTool, previewMeters } from '../src/audio-meters.ts';

const sine = (amplitude: number) => Float32Array.from({ length: 4800 }, (_, i) => amplitude * Math.sin(2 * Math.PI * 1000 * i / 48000));

describe('live strip levels', () => {
  it('reads a known sine in dBFS within half a decibel', () => {
    const reading = new LevelMeter().read([sine(0.5)], 0);
    expect(reading.peak).toBeCloseTo(-6.02, 1);
    expect(reading.rms).toBeCloseTo(-9.03, 1);
    expect(reading.hold).toBeCloseTo(-6.02, 1);
  });

  it('uses the loudest channel for peak and both channels for RMS, without phase cancellation', () => {
    const left = sine(0.5), right = left.map((v) => -v);
    const reading = new LevelMeter().read([left, right], 0);
    expect(reading.peak).toBeCloseTo(-6.02, 1);
    expect(reading.rms).toBeCloseTo(-9.03, 1);
  });

  it('reads the floor for silence and empty input', () => {
    for (const samples of [[], [new Float32Array(4800)]]) {
      const reading = new LevelMeter().read(samples, 0);
      expect(reading).toEqual({ peak: METER_FLOOR, rms: METER_FLOOR, hold: METER_FLOOR, clipped: false });
    }
  });

  it('holds a peak for a second, then falls, never below the current peak', () => {
    const meter = new LevelMeter();
    meter.read([sine(0.5)], 0);
    expect(meter.read([sine(0.1)], 0.9).hold).toBeCloseTo(-6.02, 1);
    expect(meter.read([sine(0.1)], 1.5).hold).toBeCloseTo(-12.02, 1);
    expect(meter.read([sine(0.1)], 5).hold).toBeCloseTo(-20, 1);
  });

  it('keeps overload lit until reset and clears playback history on reset', () => {
    const meter = new LevelMeter();
    expect(meter.read([sine(1.1)], 0).clipped).toBe(true);
    expect(meter.read([sine(0.1)], 2).clipped).toBe(true);
    meter.reset();
    expect(meter.read([new Float32Array(4800)], 3)).toEqual({ peak: METER_FLOOR, rms: METER_FLOOR, hold: METER_FLOOR, clipped: false });
  });
});

describe('preview meter lifecycle', () => {
  const graph = (amplitude = 0.5) => {
    const nodes: { connections: Set<unknown>; disconnect(to?: unknown): void }[] = [];
    const node = () => {
      const n = { connections: new Set<unknown>(), connect(to: unknown) { this.connections.add(to); return to; }, disconnect(to?: unknown) { if (to) this.connections.delete(to); else this.connections.clear(); } };
      nodes.push(n);
      return n;
    };
    let analysers = 0;
    const ctx = {
      createGain: node,
      createChannelSplitter: node,
      createAnalyser: () => { analysers++; return { ...node(), fftSize: 2048, smoothingTimeConstant: 0, getFloatTimeDomainData: (data: Float32Array) => data.set(sine(amplitude).subarray(0, data.length)) }; },
    } as unknown as BaseAudioContext;
    return { ctx, node, nodes, count: () => analysers };
  };

  it('allocates nothing while hidden, connects while shown and disconnects only its own taps', () => {
    const g = graph(), taps = new MeterTaps(), source = g.node(), speaker = g.node();
    source.connect(speaker);
    taps.source('A1', g.ctx, source as unknown as AudioNode);
    expect(g.count()).toBe(0);
    taps.show(true);
    expect(g.count()).toBe(2);
    expect(taps.read(0).A1.peak).toBeCloseTo(-6.02, 1);
    taps.show(false);
    expect(source.connections).toEqual(new Set([speaker]));
    expect(taps.read(1)).toEqual({});
    taps.show(true);
    expect(g.count()).toBe(4);
    taps.clear();
    expect(source.connections).toEqual(new Set([speaker]));
    expect(taps.read(2)).toEqual({});
  });

  it('can open the mixer before playback and discard all sources when playback stops', () => {
    const g = graph(), taps = new MeterTaps();
    taps.show(true);
    expect(g.count()).toBe(0);
    taps.source('A1', g.ctx, g.node() as unknown as AudioNode);
    expect(g.count()).toBe(2);
    taps.clear();
    taps.show(false);
    taps.show(true);
    expect(g.count()).toBe(2);
  });

  it('keeps the clipping latch across stop and panel close until clicked or a new project opens', () => {
    const g = graph(1.1), taps = new MeterTaps();
    taps.show(true);
    taps.source('A1', g.ctx, g.node() as unknown as AudioNode);
    expect(taps.read(0).A1.clipped).toBe(true);
    taps.clear();
    expect(taps.read(1).A1).toEqual({ peak: -80, rms: -80, hold: -80, clipped: true });
    taps.show(false);
    expect(taps.read(2)).toEqual({});
    taps.show(true);
    expect(taps.read(3).A1.clipped).toBe(true);
    taps.reset('A1');
    expect(taps.read(4)).toEqual({});
    taps.source('A1', g.ctx, g.node() as unknown as AudioNode);
    taps.read(5);
    taps.clear(true);
    expect(taps.read(6)).toEqual({});
  });

  it('lets the assistant read the same levels and reset the same clipping latch', async () => {
    const g = graph(1.1);
    previewMeters.show(true);
    previewMeters.source('A1', g.ctx, g.node() as unknown as AudioNode);
    try {
      const before = await metersTool.run({}, {} as never) as { text: string };
      expect(JSON.parse(before.text).A1.clipped).toBe(true);
      previewMeters.clear();
      const after = await metersTool.run({ reset: 'A1' }, {} as never) as { text: string };
      expect(JSON.parse(after.text)).toEqual({});
      previewMeters.show(false);
      const hidden = await metersTool.run({}, {} as never) as { text: string };
      expect(JSON.parse(hidden.text)).toEqual({});
    } finally { previewMeters.clear(true); previewMeters.show(false); }
  });
});
