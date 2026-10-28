import { describe, expect, it } from 'vitest';
import { applyOps, type Composition, type TrammeDoc } from '@tramme/core';
import { addBusOps, faderMoveOps, trackBusOps, trackPanOps, trackVolumeOps } from '../src/ui/timeline/mixer.ts';

const seq = (): Composition => ({
  name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 10, background: null,
  tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }, { id: 'A2', kind: 'audio', volume: { $k: [{ t: 0, v: 0 }, { t: 8, v: -10 }] } }, { id: 'B1', kind: 'audio', bus: true }],
  order: [], layers: {},
});
const doc = (c: Composition) => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main', compositions: { main: c } }) as TrammeDoc;
const run = (c: Composition, ops: ReturnType<typeof trackVolumeOps>) => applyOps(doc(c), ops).doc.compositions.main;

describe('a fader moved while the film plays', () => {
  it('is written as keyframes on the volume of the track, in one operation', () => {
    const c = seq(), ops = faderMoveOps(c, 'main', 'A1', [[1, 0], [1.5, -6], [2, -6]]);
    expect(ops).toHaveLength(1);
    expect(run(c, ops).tracks![1].volume).toEqual({ $k: [{ t: 1, v: 0 }, { t: 1.5, v: -6 }, { t: 2, v: -6 }] });
  });

  it('keeps the points that matter: a straight run of readings is its two ends', () => {
    const run200 = Array.from({ length: 200 }, (_, i) => [i / 50, -i * 0.03] as [number, number]);
    const v = run(seq(), faderMoveOps(seq(), 'main', 'A1', run200)).tracks![1].volume as { $k: unknown[] };
    expect(v.$k).toHaveLength(2);
  });

  it('replaces the automation only where it was moved, and keeps the rest', () => {
    const c = seq(), keys = (run(c, faderMoveOps(c, 'main', 'A2', [[2, -2], [4, -2]])).tracks![2].volume as { $k: { t: number; v: number }[] }).$k;
    expect(keys.map((k) => [k.t, k.v])).toEqual([[0, 0], [2, -2], [4, -2], [8, -10]]);
  });

  it('a single reading is a still volume', () => {
    expect(run(seq(), faderMoveOps(seq(), 'main', 'A1', [[3, -4]])).tracks![1].volume).toBe(-4);
  });

  it('is nothing for a picture track, or no reading', () => {
    expect(faderMoveOps(seq(), 'main', 'V1', [[0, 0], [1, -1]])).toEqual([]);
    expect(faderMoveOps(seq(), 'main', 'A1', [])).toEqual([]);
  });
});

describe('the strip of a track', () => {
  it('a still volume replaces the automation, kept between -60 and +12 dB, and 0 takes the field off', () => {
    expect(run(seq(), trackVolumeOps(seq(), 'main', 'A2', -12.5)).tracks![2].volume).toBe(-12.5);
    expect(run(seq(), trackVolumeOps(seq(), 'main', 'A1', -90)).tracks![1].volume).toBe(-60);
    expect(run(seq(), trackVolumeOps(seq(), 'main', 'A1', 40)).tracks![1].volume).toBe(12);
    expect(run(seq(), trackVolumeOps(seq(), 'main', 'A2', 0)).tracks![2].volume).toBeUndefined();
  });

  it('the pan stays between left and right, centred takes the field off', () => {
    expect(run(seq(), trackPanOps(seq(), 'main', 'A1', 0.3)).tracks![1].pan).toBe(0.3);
    expect(run(seq(), trackPanOps(seq(), 'main', 'A1', -3)).tracks![1].pan).toBe(-1);
    expect(trackPanOps(seq(), 'main', 'A1', 0)).toEqual([]);
  });

  it('feeds a bus, or none; only a bus can be fed', () => {
    expect(run(seq(), trackBusOps(seq(), 'main', 'A1', 'B1')).tracks![1].to).toBe('B1');
    expect(trackBusOps(seq(), 'main', 'A1', 'A2')).toEqual([]);
    expect(trackBusOps(seq(), 'main', 'B1', 'B1')).toEqual([]);
    const fed = run(seq(), trackBusOps(seq(), 'main', 'A1', 'B1'));
    expect(run(fed, trackBusOps(fed, 'main', 'A1', null)).tracks![1].to).toBeUndefined();
  });

  it('a bus is a new sound track that holds none', () => {
    const r = addBusOps(seq(), 'main'), c = run(seq(), r.ops);
    expect(r.id).toBe('B2');
    expect(c.tracks!.find((t) => t.id === 'B2')).toEqual({ id: 'B2', kind: 'audio', bus: true, name: 'Bus 2' });
  });
});
