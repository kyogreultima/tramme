import { describe, expect, it } from 'vitest';
import { audioClips, gainAt, gainMoves, soundFigures, type TrammeDoc } from '../src/index.ts';

const doc = (props: Record<string, unknown>, extra: Record<string, unknown> = {}): TrammeDoc => ({
  version: 1, meta: { title: 't' }, root: 'main',
  assets: { s: { type: 'audio', src: 's.wav' }, v: { type: 'video', src: 'v.mp4' } },
  compositions: { main: { name: 'main', width: 100, height: 100, fps: 30, duration: 10, order: ['a'], layers: { a: { type: 'audio', in: 2, out: 6, props: { audio: 's', ...props } }, ...extra } } },
} as unknown as TrammeDoc);

describe('the sound of a layer', () => {
  it('applies an editable track volume block over its existing fader automation', () => {
    const d = doc({ gain: 0 });
    const c = d.compositions.main;
    c.layers.a.track = 'A1';
    c.tracks = [{ id: 'A1', kind: 'audio', volume: -4, volumeBlocks: [{ id: 'dip1', keys: [{ t: 2.85, v: 0 }, { t: 3, v: -12 }, { t: 5, v: -12 }, { t: 5.5, v: 0 }] }] }];
    const [clip] = audioClips(d, 'main');
    expect(gainAt(clip, 2.5)).toBeCloseTo(10 ** (-4 / 20), 4);
    expect(gainAt(clip, 4)).toBeCloseTo(10 ** (-16 / 20), 4);
    expect(gainAt(clip, 5.25)).toBeCloseTo(10 ** (-10 / 20), 3);
  });
  it('ducks music under a marked voice track and follows its moved clips without a transcript', () => {
    const d = doc({ role: 'music' }, { voice: { type: 'audio', track: 'V1', in: 3, out: 5, props: { audio: 's', role: 'voice' } } });
    const c = d.compositions.main;
    c.layers.a.in = 0; c.layers.a.out = 10; c.layers.a.track = 'M1';
    c.tracks = [{ id: 'M1', kind: 'audio', duckUnder: 'V1' }, { id: 'V1', kind: 'audio' }];
    const music = () => audioClips(d, 'main').find((clip) => clip.layerId === 'a')!;
    expect(gainAt(music(), 2)).toBeCloseTo(1, 4);
    expect(gainAt(music(), 4)).toBeCloseTo(10 ** (-12 / 20), 4);
    c.layers.voice.in = 6; c.layers.voice.out = 8;
    expect(gainAt(music(), 4)).toBeCloseTo(1, 4);
    expect(gainAt(music(), 7)).toBeCloseTo(10 ** (-12 / 20), 4);
    c.tracks[1].muted = true;
    expect(gainAt(music(), 7)).toBeCloseTo(1, 4);
  });
  it('reads how it sounds: level, fades, speed, filters, reverb, within their ranges', () => {
    const [c] = audioClips(doc({ gain: -6, fadeIn: 0.5, fadeOut: 9, rate: 9, lowCut: 120, highCut: 8000, reverb: 2, start: 1 }), 'main');
    expect(c).toMatchObject({ at: 2, duration: 4, offset: 1, gainDb: -6, envelope: null, fadeIn: 0.5, fadeOut: 4, rate: 4, lowCut: 120, highCut: 8000, reverb: 1 });
  });

  it('compresses a voice: the amount clamped, off by default', () => {
    const [on] = audioClips(doc({ compress: 1.5 }), 'main');
    expect(on.compress).toBe(1);
    const [off] = audioClips(doc({}), 'main');
    expect(off.compress).toBe(0);
  });

  it('follows an animated gain: ducking under a voice', () => {
    const [c] = audioClips(doc({ gain: { $k: [{ t: 3, v: 0 }, { t: 3.5, v: -12 }, { t: 5, v: -12 }, { t: 5.5, v: 0 }] } }), 'main');
    expect(c.envelope![0]).toEqual([2, 0]);
    expect(gainMoves(c)).toBe(true);
    expect(gainAt(c, 2.5)).toBeCloseTo(1, 5);
    expect(gainAt(c, 4)).toBeCloseTo(Math.pow(10, -12 / 20), 4);
    expect(gainAt(c, 3.25)).toBeCloseTo(Math.pow(10, -6 / 20), 2);
  });

  it('fades in and out', () => {
    const [c] = audioClips(doc({ gain: 0, fadeIn: 1, fadeOut: 2 }), 'main');
    expect(gainAt(c, 2)).toBe(0);
    expect(gainAt(c, 2.5)).toBeCloseTo(0.5);
    expect(gainAt(c, 3.5)).toBe(1);
    expect(gainAt(c, 5)).toBeCloseTo(0.5);
    expect(gainAt(c, 6)).toBe(0);
    expect(gainMoves(audioClips(doc({ gain: -3 }), 'main')[0])).toBe(false);
  });

  it('keeps a video at its own speed, and leaves a muted one out', () => {
    const video = (muted: boolean) => audioClips(doc({}, { b: { type: 'video', props: { video: 'v', rate: 2, muted, fadeIn: 0.2 } } }), 'main').find((c) => c.asset === 'v');
    expect(video(false)).toMatchObject({ rate: 2, fadeIn: 0.2 });
    expect(video(true)).toBeUndefined();
  });
});

describe('what a sound is like', () => {
  const rate = 8000;
  const sound = (fn: (t: number) => number, seconds: number) => Float32Array.from({ length: seconds * rate }, (_, i) => fn(i / rate));

  it('finds a hit: where it lands, its peak and where it fades out', () => {
    // silence, then a hit at 0.3 s decaying over 0.2 s
    const hit = sound((t) => (t < 0.3 ? 0 : 0.5 * Math.exp(-(t - 0.3) * 30) * Math.sin(2 * Math.PI * 200 * t)), 1);
    const f = soundFigures([hit, hit], rate);
    expect(f.duration).toBe(1);
    expect(f.peakDb).toBeCloseTo(-6, 0);
    expect(f.peakAt).toBeGreaterThanOrEqual(0.3);
    expect(f.peakAt).toBeLessThan(0.33);
    expect(f.start).toBeCloseTo(0.3, 1);
    expect(f.end).toBeLessThan(0.75);
    expect(f.loudDb).toBeLessThan(f.peakDb);
  });

  it('lands a riser on its top, and says when there is nothing', () => {
    const riser = sound((t) => t * Math.sin(2 * Math.PI * (100 + 400 * t) * t), 2);
    expect(soundFigures([riser], rate).peakAt).toBeGreaterThan(1.9);
    const silent = soundFigures([new Float32Array(rate)], rate);
    expect(silent).toMatchObject({ peakDb: -120, start: 0, end: 0 });
  });
});

describe('the sounds of a nested composition', () => {
  // a shot: a composition with a video from 1 s of its file; the main film shows it from 2 s, its own time starting at 0.5 s
  const nested = (props: Record<string, unknown> = {}, main: Record<string, unknown> = {}): TrammeDoc => ({
    version: 1, meta: { title: 't' }, root: 'main',
    assets: { v: { type: 'video', src: 'v.mp4' } },
    compositions: {
      shot: { name: 'shot', width: 100, height: 100, fps: 30, duration: 6, order: ['clip'], layers: { clip: { type: 'video', in: 0, out: 6, props: { video: 'v', start: 1, ...props } } } },
      main: { name: 'main', width: 100, height: 100, fps: 30, duration: 10, order: ['s'], layers: { s: { type: 'comp', in: 2, out: 6, props: { comp: 'shot', start: 0.5, ...main } } } },
    },
  } as unknown as TrammeDoc);

  it('plays in the film that holds it, at the film time it is shown and from the right point of its file', () => {
    const [c] = audioClips(nested(), 'main');
    // shown 2 s to 6 s of the film: the shot's 0.5 s to 4.5 s, so its file from 1.5 s
    expect(c).toMatchObject({ layerId: 's/clip', asset: 'v', at: 2, duration: 4, offset: 1.5, rate: 1 });
  });

  it('follows the nested composition\'s speed, and stays silent when its video is muted or the layer hidden', () => {
    const [fast] = audioClips(nested({}, { speed: 2 }), 'main');
    // twice as fast: 4 s of film play 8 s of the shot, cut where the shot ends (6 s, so 2.75 s of film)
    expect(fast).toMatchObject({ at: 2, offset: 1.5, rate: 2 });
    expect(fast.duration).toBeCloseTo(2.75, 5);
    expect(audioClips(nested({ muted: true }), 'main')).toEqual([]);
    const hidden = nested();
    hidden.compositions.main.layers.s.visible = false;
    expect(audioClips(hidden, 'main')).toEqual([]);
  });

  it('never loops through a composition that holds itself', () => {
    const d = nested();
    d.compositions.shot.layers.back = { type: 'comp', in: 0, out: 6, props: { comp: 'main' } } as never;
    d.compositions.shot.order.push('back');
    expect(audioClips(d, 'main').map((c) => c.layerId)).toEqual(['s/clip']);
  });
});
