import { describe, expect, it } from 'vitest';
import { audioClips, clipFileTime, Evaluator, integrate, layerClock, mediaMoments, mediaTime, validate, type Host, type TrammeDoc } from '@tramme/core';
import { captions } from '../src/captions.ts';
import { builtinRegistry } from '../src/index.ts';

/** a video layer from 1 s, its speed as given */
function film(rate: unknown, layerIn = 1): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'speed' }, tokens: {}, assets: { clip: { type: 'video', src: 'clip.mp4' } }, root: 'main',
    compositions: { main: { name: 'Main', width: 640, height: 360, fps: 30, duration: 10, background: null, order: ['v'], layers: {
      v: { type: 'video', in: layerIn, props: { video: 'clip', rate, size: [640, 360] } },
    } } },
  } as TrammeDoc;
}

const fileTime = (doc: TrammeDoc, t: number) => {
  const L = new Evaluator(doc, builtinRegistry()).layerAt('v', t, 'main');
  return mediaTime(L.props as never, t, L.layer.in ?? 0);
};

describe('a speed curve', () => {
  it('integrates exactly what holds or changes linearly, on fixed steps otherwise', () => {
    expect(integrate(() => 2, 0, 3)).toBe(6);
    expect(integrate((t) => t, 0, 2)).toBeCloseTo(2, 12);
    expect(integrate((t) => t, 2, 0)).toBeCloseTo(-2, 12);
    // a hold: the value jumps at 1
    expect(integrate((t) => (t < 1 ? 1 : 3), 0, 2, [1])).toBeCloseTo(4, 9);
    // the same figure on every run
    const f = (t: number) => Math.sin(t) + 1.5;
    expect(integrate(f, 0, 2)).toBe(integrate(f, 0, 2));
  });

  it('is a speed the document may animate, from backwards to four times', () => {
    const reg = builtinRegistry();
    expect(validate(film({ $k: [{ t: 1, v: 1 }, { t: 3, v: 0.3 }] }), reg)).toEqual([]);
    expect(validate(film(0), reg)).toEqual([]);
    expect(validate(film(-1), reg)).toEqual([]);
  });

  it('runs the file at the integral of the speed', () => {
    // 1× to 0.3× over two seconds, linear: 2 × (1 + 0.3) / 2 = 1.3 s of the file
    const ramp = film({ $k: [{ t: 1, v: 1 }, { t: 3, v: 0.3 }] });
    expect(fileTime(ramp, 3)).toBeCloseTo(1.3, 9);
    expect(fileTime(ramp, 2)).toBeCloseTo(0.825, 9);
    // past the last key, the speed holds at 0.3
    expect(fileTime(ramp, 5)).toBeCloseTo(1.3 + 0.6, 9);
    // eased, a value between, the same on every evaluation
    const eased = film({ $k: [{ t: 1, v: 1, ease: [0.42, 0, 0.58, 1] }, { t: 3, v: 0.3 }] });
    expect(fileTime(eased, 3)).toBeCloseTo(1.3, 3);
    expect(fileTime(eased, 2.4)).toBe(fileTime(eased, 2.4));
  });

  it('keeps a held speed on the clock it had', () => {
    expect(new Evaluator(film(2), builtinRegistry()).layerAt('v', 3, 'main').props.rateElapsed).toBeUndefined();
    expect(fileTime(film(2), 3)).toBe(4);
  });

  it('holds the frame at 0, plays backwards under it, never before the file', () => {
    expect(fileTime(film(0), 4)).toBe(0);
    const back = film({ $k: [{ t: 1, v: 1 }, { t: 2, v: 1, ease: 'hold' }, { t: 2.0001, v: -1 }] });
    expect(fileTime(back, 2)).toBeCloseTo(1, 3);
    expect(fileTime(back, 2.5)).toBeCloseTo(0.5, 3);
    expect(fileTime(back, 4)).toBe(0);
  });

  it('places a moment of the file back in composition time, through the ramp', () => {
    const ramp = film({ $k: [{ t: 1, v: 1 }, { t: 3, v: 0.3 }] });
    const clock = layerClock(new Evaluator(ramp, builtinRegistry()), 'main', 'v');
    for (const t of [1.5, 2, 2.9, 4]) {
      const [back] = clock.moments(clock.fileTime(t));
      expect(back).toBeCloseTo(t, 5);
    }
    // a moment the layer never reaches
    expect(clock.moments(50)).toEqual([]);
  });

  it('finds every moment a speed turning back plays twice', () => {
    // forward 1 s of the file, then back: 0.5 s of the file plays on the way out and on the way back
    const elapsed = (t: number) => (t < 2 ? t - 1 : 1 - (t - 2));
    const found = mediaMoments({ start: 0 }, 0.5, 1, 4, elapsed);
    expect(found).toHaveLength(2);
    expect(found[0]).toBeCloseTo(1.5, 5);
    expect(found[1]).toBeCloseTo(2.5, 5);
  });

  it('holds a frame at 0 without dividing by it', () => {
    expect(mediaMoments({ start: 2, rate: 0 }, 2, 1, 4)).toEqual([1]);
    expect(mediaMoments({ start: 2, rate: 0 }, 3, 1, 4)).toEqual([]);
  });

  it('gives captions following a video the words of its file time', () => {
    const transcript = { version: 1, duration: 3, words: [{ w: 'early', s: 0.1, e: 0.5 }, { w: 'late', s: 1.2, e: 1.6 }] };
    const ramp = film({ $k: [{ t: 1, v: 1 }, { t: 3, v: 0.3 }] }), ev = new Evaluator(ramp, builtinRegistry());
    const said = (t: number, follow: string | null) => {
      const words: string[] = [];
      const ctx = new Proxy({}, { get: (_o, k) => (k === 'fillText' ? (w: string) => words.push(w) : k === 'measureText' ? (w: string) => ({ width: w.length * 10 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
      const host = {
        t, layerIn: 1, asset: () => transcript,
        layer: (id: string) => { const L = ev.layerAt(id, t, 'main'); return { props: L.props, in: L.layer.in ?? 0 }; },
      } as unknown as Host;
      const p = Object.fromEntries(Object.entries(captions.props).map(([k, d]) => [k, d.default]));
      captions.render.canvas2d!(ctx, { ...p, transcript: 'tr', follow } as never, host);
      return words.join(' ');
    };
    // at 2.9 s the ramp has played about 1.29 s of the file: "late"; at 1×, the transcript would be at 1.9 s, past it
    expect(said(2.9, 'v')).toMatch(/late/);
    expect(said(2.9, null)).not.toMatch(/late/);
  });

  it('plays the sound on the picture’s clock, the pitch with the speed', () => {
    const ramp = film({ $k: [{ t: 1, v: 1 }, { t: 3, v: 0.3, ease: [0.42, 0, 0.58, 1] }, { t: 5, v: 1 }] });
    const [clip] = audioClips(ramp, 'main');
    expect(clip.rateCurve?.length).toBeGreaterThan(10);
    const clock = layerClock(new Evaluator(ramp, builtinRegistry()), 'main', 'v');
    // within a millisecond of the picture all along (the sound reads its curve sampled 50 times a second)
    for (const t of [1, 1.7, 2.5, 3, 4.2, 6]) expect(Math.abs(clipFileTime(clip, t) - clock.fileTime(t))).toBeLessThan(1e-3);
    // a held speed: the clip as before, no curve
    const [held] = audioClips(film(2), 'main');
    expect(held.rateCurve).toBeUndefined();
    expect(clipFileTime(held, 3)).toBe(4);
  });

  it('never plays a sound backwards: under 0 it holds', () => {
    const [clip] = audioClips(film({ $k: [{ t: 1, v: 1 }, { t: 2, v: -1 }] }), 'main');
    expect(Math.min(...clip.rateCurve!.map(([, v]) => v))).toBe(0);
  });
});
