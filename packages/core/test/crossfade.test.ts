import { describe, expect, it } from 'vitest';
import { audioClips, gainAt, gainMoves, type TrammeDoc } from '../src/index.ts';

/** two shots of video, the second over the first from 2 s, joined by a transition of 1 s */
function cut(sound?: boolean): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'cut' }, tokens: {}, root: 'main',
    assets: { one: { type: 'video', src: 'one.mp4' }, two: { type: 'video', src: 'two.mp4' } },
    compositions: { main: { name: 'Main', width: 640, height: 360, fps: 30, duration: 6, background: null, order: ['a', 'b'], layers: {
      a: { type: 'video', in: 0, out: 4, props: { video: 'one' } },
      b: { type: 'video', in: 2, out: 6, props: { video: 'two' }, effects: [{ id: 'tr', type: 'fx.transition', props: { from: 'a', duration: 1, ...(sound === undefined ? {} : { sound }) } }] },
    } } },
  } as TrammeDoc;
}

describe('the sound of a transition', () => {
  it('crosses with the picture, equal power, by default', () => {
    const clips = audioClips(cut(), 'main'), a = clips.find((c) => c.layerId === 'a')!, b = clips.find((c) => c.layerId === 'b')!;
    expect(gainMoves(a) && gainMoves(b)).toBe(true);
    expect(gainAt(a, 1.5)).toBeCloseTo(1);
    expect(gainAt(a, 2)).toBeCloseTo(1);
    expect(gainAt(b, 2)).toBeCloseTo(0);
    // halfway, both at -3 dB: the sum of their powers holds
    expect(gainAt(a, 2.5) ** 2 + gainAt(b, 2.5) ** 2).toBeCloseTo(1);
    expect(gainAt(a, 2.5)).toBeCloseTo(Math.SQRT1_2);
    // after the window, the outgoing shot is silent while its picture would still run under
    expect(gainAt(a, 3.5)).toBe(0);
    expect(gainAt(b, 4)).toBeCloseTo(1);
  });

  it('leaves the sounds alone when the transition says so', () => {
    const clips = audioClips(cut(false), 'main');
    for (const c of clips) expect(c.cross).toBeUndefined();
  });
});
