import { expect, it } from 'vitest';
import { integratedLoudness } from '@tramme/core';
import { MasterMeter } from '../src/master-meter.ts';

const RATE = 48000;
const sine = (db: number, seconds: number, hz = 1000, phase = 0) => Float32Array.from({ length: RATE * seconds }, (_, i) => 10 ** (db / 20) * Math.sin(2 * Math.PI * hz * i / RATE + phase));
const feed = (meter: MasterMeter, samples: Float32Array, size = 4800) => {
  let result = meter.reading;
  for (let i = 0; i < samples.length; i += size) { const part = samples.subarray(i, i + size); result = meter.push([part, part]); }
  return result;
};

it('waits for three seconds then agrees with the offline BS.1770 check within 0.5 LU', () => {
  const meter = new MasterMeter(RATE), signal = sine(-23, 3);
  expect(feed(meter, signal.subarray(0, RATE * 2)).lufs).toBeNull();
  const reading = feed(meter, signal.subarray(RATE * 2));
  expect(reading.lufs).toBeCloseTo(-23, 1);
  expect(Math.abs(reading.lufs! - integratedLoudness([signal, signal], RATE))).toBeLessThan(0.5);
  expect(reading.truePeak).toBeCloseTo(-23, 1);
});

it('keeps only the last three seconds and measures silence at the floor', () => {
  const meter = new MasterMeter(RATE);
  feed(meter, sine(-6, 3));
  expect(feed(meter, sine(-23, 3)).lufs).toBeCloseTo(-23, 1);
  const silent = feed(meter, new Float32Array(RATE * 3));
  expect(silent.lufs).toBe(-80);
  expect(silent.truePeak).toBe(-80);
});

it('finds the peak between samples across packet boundaries, independent of packet size', () => {
  const tone = sine(0, 0.1, RATE / 4, Math.PI / 4);
  const peakOf = (size: number) => {
    const meter = new MasterMeter(RATE);
    let peak = -80;
    for (let i = 0; i < tone.length; i += size) {
      const part = tone.subarray(i, i + size);
      peak = Math.max(peak, meter.push([part, part]).truePeak);
    }
    return peak;
  };
  expect(peakOf(128)).toBeGreaterThan(-0.5);
  expect(peakOf(128)).toBeCloseTo(peakOf(4800), 4);
});

it('resets a discontinuous playback instead of mixing its old history with a new window', () => {
  const meter = new MasterMeter(RATE);
  feed(meter, sine(-6, 3));
  meter.reset();
  expect(meter.reading).toEqual({ lufs: null, truePeak: -80 });
  expect(feed(meter, sine(-23, 2)).lufs).toBeNull();
  expect(feed(meter, sine(-23, 1)).lufs).toBeCloseTo(-23, 1);
});

it('counts only new analyser samples and discards history after a gap longer than the buffer', () => {
  const meter = new MasterMeter(RATE), packet = sine(-23, 0.1);
  meter.capture([packet, packet], 4800);
  for (let i = 0; i < 100; i++) expect(meter.capture([packet, packet], 4800).lufs).toBeNull();
  for (let frame = 9600; frame <= RATE * 3; frame += 4800) meter.capture([packet, packet], frame);
  expect(meter.reading.lufs).toBeCloseTo(-23, 1);
  expect(meter.capture([packet, packet], RATE * 10).lufs).toBeNull();
});
