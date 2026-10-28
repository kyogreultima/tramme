import { describe, expect, it } from 'vitest';
import { applyOps, closeGapOps, cutsOf, isLocked, linkedIds, rippleDeleteOps, trackClips, type Composition, type Op, type TrammeDoc } from '../src/index.ts';

/** a sequence of 10 s: V1 holds a (0-5) and b (4-9, a transition of 1 s over a), A1 holds the sound of a, linked to it */
export function sequence(): Composition {
  return {
    name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 10, background: null,
    tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }],
    order: ['b', 'a'],
    layers: {
      a: { type: 'video', track: 'V1', link: 'k1', in: 0, out: 5, props: { video: 'one' } },
      b: { type: 'video', track: 'V1', in: 4, out: 9, props: { video: 'two' }, effects: [{ id: 'tr', type: 'fx.transition', props: { from: 'a', duration: 1 } }] },
      sa: { type: 'audio', track: 'A1', link: 'k1', in: 0, out: 5, props: { audio: 'one' } },
    },
  };
}

export const docOf = (c: Composition): TrammeDoc => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main', compositions: { main: c } }) as TrammeDoc;
/** the composition once the operations are applied */
export const after = (d: TrammeDoc, ops: Op[]): Composition => applyOps(d, ops).doc.compositions.main;

/** three clips end to end on V1 */
function three(): Composition {
  return {
    name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 12, background: null,
    tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }],
    order: ['a', 'b', 'c'],
    layers: {
      a: { type: 'video', track: 'V1', in: 0, out: 3, props: { video: 'one' } },
      b: { type: 'video', track: 'V1', in: 3, out: 6, props: { video: 'two' } },
      c: { type: 'video', track: 'V1', in: 6, out: 9, props: { video: 'three' }, transform: { position: { $k: [{ t: 7, v: [0, 0] }, { t: 8, v: [100, 0] }] } } },
    },
  };
}

describe('tracks and footprints', () => {
  it('trackClips returns the clips of a track sorted, out defaulting to the duration', () => {
    const c = sequence();
    c.layers.last = { type: 'video', track: 'V1', in: 9.5, props: { video: 'three' } };
    expect(trackClips(c, 'V1')).toEqual([{ id: 'a', in: 0, out: 5 }, { id: 'b', in: 4, out: 9 }, { id: 'last', in: 9.5, out: 10 }]);
    expect(trackClips(c, 'A1')).toEqual([{ id: 'sa', in: 0, out: 5 }]);
    expect(trackClips(c, 'nope')).toEqual([]);
  });

  it('cutsOf finds the centre of a transition overlap', () => {
    expect(cutsOf(sequence(), 'V1')).toEqual([{ left: 'a', right: 'b', at: 4.5 }]);
  });

  it('cutsOf takes touching clips as a cut and a gap as none', () => {
    const c = sequence();
    c.layers.b.in = 5; delete c.layers.b.effects;
    expect(cutsOf(c, 'V1')).toEqual([{ left: 'a', right: 'b', at: 5 }]);
    c.layers.b.in = 6;
    expect(cutsOf(c, 'V1')).toEqual([]);
  });

  it('isLocked is true for a clip whose linked audio sits on a locked track', () => {
    const c = sequence();
    expect(isLocked(c, 'a')).toBe(false);
    c.tracks![1].locked = true;
    expect(isLocked(c, 'sa')).toBe(true);
    expect(isLocked(c, 'a')).toBe(true);
    expect(isLocked(c, 'b')).toBe(false);
  });

  it('linkedIds of an unlinked clip is [id] and of a linked one the whole group', () => {
    const c = sequence();
    expect(linkedIds(c, 'b')).toEqual(['b']);
    expect(linkedIds(c, 'a').sort()).toEqual(['a', 'sa']);
  });
});

describe('ripple delete', () => {
  it('removes the clip and shifts the next ones left by its length', () => {
    const d = docOf(three()), c = after(d, rippleDeleteOps(d, 'main', ['b']));
    expect(c.layers.b).toBeUndefined();
    expect(c.order).toEqual(['a', 'c']);
    expect([c.layers.a.in, c.layers.a.out, c.layers.c.in, c.layers.c.out]).toEqual([0, 3, 3, 6]);
  });

  it('moves the keyframes of a shifted clip', () => {
    const d = docOf(three()), c = after(d, rippleDeleteOps(d, 'main', ['b']));
    expect((c.layers.c.transform!.position as { $k: { t: number }[] }).$k.map((k) => k.t)).toEqual([4, 5]);
  });

  it('removes a linked pair together and shifts both tracks', () => {
    const c0 = three();
    c0.layers.a.link = 'k1'; c0.layers.sa = { type: 'audio', track: 'A1', link: 'k1', in: 0, out: 3, props: { audio: 'one' } };
    c0.layers.sb = { type: 'audio', track: 'A1', in: 3, out: 6, props: { audio: 'two' } };
    c0.order.push('sa', 'sb');
    const d = docOf(c0), c = after(d, rippleDeleteOps(d, 'main', ['a']));
    expect(c.layers.a).toBeUndefined();
    expect(c.layers.sa).toBeUndefined();
    expect([c.layers.b.in, c.layers.b.out, c.layers.sb.in, c.layers.sb.out]).toEqual([0, 3, 0, 3]);
    expect(c.order).toEqual(['b', 'c', 'sb']);
  });

  it('returns [] on a locked track, or when a linked clip sits on one', () => {
    const c0 = three();
    c0.layers.a.link = 'k1'; c0.layers.sa = { type: 'audio', track: 'A1', link: 'k1', in: 0, out: 3, props: { audio: 'one' } };
    c0.order.push('sa');
    c0.tracks![1].locked = true;
    const d = docOf(c0);
    expect(rippleDeleteOps(d, 'main', ['a'])).toEqual([]);
    expect(rippleDeleteOps(d, 'main', ['sa'])).toEqual([]);
    c0.tracks![0].locked = true;
    expect(rippleDeleteOps(docOf(c0), 'main', ['b'])).toEqual([]);
  });

  it('keeps the overlap of a later transition: its two clips shift together', () => {
    const c0 = three();
    c0.layers.c.in = 5; c0.layers.c.out = 8; // overlaps b by 1 s
    c0.layers.c.effects = [{ id: 'tr', type: 'fx.transition', props: { from: 'b', duration: 1 } }];
    const d = docOf(c0), c = after(d, rippleDeleteOps(d, 'main', ['a']));
    expect([c.layers.b.in, c.layers.b.out, c.layers.c.in, c.layers.c.out]).toEqual([0, 3, 2, 5]);
    expect(c.layers.c.effects).toHaveLength(1);
  });

  it('drops the transition of the clip that came in over a deleted one, and closes only the part not overlapped', () => {
    const c0 = sequence(); // a 0-5, b 4-9 with a transition from a
    const d = docOf(c0), c = after(d, rippleDeleteOps(d, 'main', ['a']));
    expect([c.layers.b.in, c.layers.b.out]).toEqual([0, 5]);
    expect(c.layers.b.effects).toEqual([]);
  });

  it('keeps a gap that already followed the clip', () => {
    const c0 = three();
    c0.layers.c.in = 7; c0.layers.c.out = 10; // a 1 s gap after b
    const d = docOf(c0), c = after(d, rippleDeleteOps(d, 'main', ['b']));
    expect([c.layers.c.in, c.layers.c.out]).toEqual([4, 7]);
  });
});

describe('closing a gap', () => {
  it('shifts the clips after a gap so the first starts at the gap start', () => {
    const c0 = three();
    c0.layers.b.in = 4; c0.layers.b.out = 6; // gap 3-4 after a; c follows b
    c0.layers.c.in = 6; c0.layers.c.out = 9;
    const d = docOf(c0), c = after(d, closeGapOps(d, 'main', 'V1', 3.5));
    expect([c.layers.a.in, c.layers.a.out, c.layers.b.in, c.layers.b.out, c.layers.c.in, c.layers.c.out]).toEqual([0, 3, 3, 5, 5, 8]);
  });

  it('does nothing where there is no gap, and on a locked track', () => {
    const d = docOf(three());
    expect(closeGapOps(d, 'main', 'V1', 1)).toEqual([]);
    const c0 = three(); c0.layers.b.in = 4; c0.tracks![0].locked = true;
    expect(closeGapOps(docOf(c0), 'main', 'V1', 3.5)).toEqual([]);
  });
});
