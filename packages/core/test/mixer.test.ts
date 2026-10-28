import { describe, expect, it } from 'vitest';
import { applyOps, audioClips, DocSchema, validate, type Composition, type Layer, type TrammeDoc } from '../src/index.ts';
import { registry } from './fixtures.ts';

/** a sequence of 6 s with three sound tracks and a bus, one sound on each track */
function mix(): TrammeDoc {
  const sound = (track: string, extra: Partial<Layer> = {}): Layer => ({ type: 'audio', track, in: 0, out: 6, props: { audio: 'one', gain: -1 }, ...extra });
  const c: Composition = {
    name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 6, background: null,
    tracks: [
      { id: 'A1', kind: 'audio', volume: -6 },
      { id: 'A2', kind: 'audio', pan: 0.5 },
      { id: 'A3', kind: 'audio', volume: -2, to: 'B' },
      { id: 'B', kind: 'audio', bus: true, volume: -3 },
    ],
    order: ['s1', 's2', 's3'],
    layers: { s1: sound('A1'), s2: sound('A2'), s3: sound('A3') },
  };
  return { schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: { one: { type: 'audio', src: 'one.wav' } }, root: 'main', compositions: { main: c } } as TrammeDoc;
}
const clip = (d: TrammeDoc, id: string) => audioClips(d, 'main').find((c) => c.layerId === id)!;

describe('the mixer of a sequence, read by the preview and by the export alike', () => {
  it('a track adds its volume to the gain of its sounds', () => {
    expect(clip(mix(), 's1').gainDb).toBeCloseTo(-7);
    expect(clip(mix(), 's2').gainDb).toBeCloseTo(-1);
  });

  it('a track feeding a bus adds the bus volume as well', () => {
    expect(clip(mix(), 's3').gainDb).toBeCloseTo(-1 - 2 - 3);
  });

  it('a track pans its sounds, and the pan of a sound without one is centred', () => {
    expect(clip(mix(), 's2').pan).toBe(0.5);
    expect(clip(mix(), 's1').pan ?? 0).toBe(0);
  });

  it('a muted bus silences the tracks that feed it, a muted track its own sounds', () => {
    const d = mix();
    d.compositions.main.tracks![3].muted = true;
    expect(audioClips(d, 'main').map((c) => c.layerId)).toEqual(['s1', 's2']);
    d.compositions.main.tracks![0].muted = true;
    expect(audioClips(d, 'main').map((c) => c.layerId)).toEqual(['s2']);
  });

  it('a volume that is automated follows its keys, over the gain of the sound', () => {
    const d = mix();
    d.compositions.main.tracks![0].volume = { $k: [{ t: 0, v: 0 }, { t: 2, v: -12 }] };
    const c = clip(d, 's1'), at = (t: number) => c.envelope!.reduce((best, p) => (Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best))[1];
    expect(at(0)).toBeCloseTo(-1);
    expect(at(2)).toBeCloseTo(-13);
    expect(at(5)).toBeCloseTo(-13);
  });

  it('a bus that is automated moves the sounds of the tracks it collects', () => {
    const d = mix();
    d.compositions.main.tracks![3].volume = { $k: [{ t: 0, v: 0 }, { t: 3, v: -6 }] };
    const c = clip(d, 's3'), at = (t: number) => c.envelope!.reduce((best, p) => (Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best))[1];
    expect(at(0)).toBeCloseTo(-1 - 2);
    expect(at(3)).toBeCloseTo(-1 - 2 - 6);
  });
});

describe('the mixer in the document', () => {
  const sound = (mut: (c: Composition) => void) => { const d = mix(); mut(d.compositions.main); return d; };

  it('is part of the format, and valid', () => {
    expect(DocSchema.safeParse(mix()).success).toBe(true);
    expect(validate(mix(), registry().register({ type: 'audio', title: 'Sound', category: 'test', props: { audio: { type: 'asset', default: null, nullable: true, assetType: 'audio' }, gain: { type: 'number', default: 0 } }, render: {} }))).toEqual([]);
  });

  it('refuses a pan outside -1..1, a bus that is not one, and a track that feeds itself', () => {
    expect(DocSchema.safeParse(sound((c) => { c.tracks![1].pan = 1.5; })).success).toBe(false);
    const reg = registry();
    expect(validate(sound((c) => { c.tracks![2].to = 'A1'; }), reg)[0].path).toBe('/compositions/main/tracks/2/to');
    expect(validate(sound((c) => { c.tracks![2].to = 'gone'; }), reg)[0].path).toBe('/compositions/main/tracks/2/to');
    expect(validate(sound((c) => { c.tracks![3].to = 'B'; }), reg)[0].path).toBe('/compositions/main/tracks/3/to');
  });

  it('keeps the document as it was when the mixer is not used', () => {
    const d = mix();
    for (const t of d.compositions.main.tracks!) { delete t.volume; delete t.pan; delete t.to; }
    expect(clip(d, 's1').gainDb).toBeCloseTo(-1);
    expect(applyOps(d, []).doc).toEqual(d);
  });
});
