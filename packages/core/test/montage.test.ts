import { describe, expect, it } from 'vitest';
import { applyOps, closeGapOps, cutsOf, insertOps, isLocked, linkedIds, overwriteOps, rippleDeleteOps, rippleTrimOps, rollOps, slideOps, slipOps, syncOrderOps, trackClips, type Composition, type Op, type TrammeDoc } from '../src/index.ts';

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

const clipLayer = (len: number) => ({ type: 'video', in: 0, out: len, props: { video: 'new' } });
const range = (c: Composition, id: string) => [c.layers[id].in, c.layers[id].out];

describe('insert', () => {
  it('in the middle of a clip splits it and shifts the tail', () => {
    const d = docOf(three()), c = after(d, insertOps(d, 'main', 'n', clipLayer(2), 'V1', 4.5));
    expect(range(c, 'b')).toEqual([3, 4.5]);
    expect(range(c, 'n')).toEqual([4.5, 6.5]);
    expect(range(c, 'b-2')).toEqual([6.5, 8]);
    expect(c.layers['b-2'].props!.start).toBe(1.5);
    expect(range(c, 'c')).toEqual([8, 11]);
    expect(c.layers.n.track).toBe('V1');
  });

  it('at a cut shifts the later clips only', () => {
    const d = docOf(three()), c = after(d, insertOps(d, 'main', 'n', clipLayer(2), 'V1', 3));
    expect(range(c, 'a')).toEqual([0, 3]);
    expect(range(c, 'n')).toEqual([3, 5]);
    expect(range(c, 'b')).toEqual([5, 8]);
    expect(range(c, 'c')).toEqual([8, 11]);
  });

  it('lengthens the composition to hold what was pushed past its end', () => {
    const d = docOf(three()), c = after(d, insertOps(d, 'main', 'n', clipLayer(5), 'V1', 0));
    expect(c.duration).toBe(14);
  });

  it('does nothing on a locked track', () => {
    const c0 = three(); c0.tracks![0].locked = true;
    expect(insertOps(docOf(c0), 'main', 'n', clipLayer(2), 'V1', 3)).toEqual([]);
  });

  it('syncs the draw order so a clip on a higher track is above the lower ones', () => {
    const c0 = three(); c0.tracks!.push({ id: 'V2', kind: 'video' });
    const d = docOf(c0);
    const c = after(d, insertOps(d, 'main', 'n', clipLayer(2), 'V2', 0));
    expect(c.order).toEqual(['a', 'b', 'c', 'n']);
    const d2 = docOf(c), c2 = after(d2, insertOps(d2, 'main', 'z', clipLayer(1), 'V1', 9));
    expect(c2.order).toEqual(['a', 'b', 'c', 'z', 'n']);
  });
});

describe('overwrite', () => {
  it('a clip fully covered is removed', () => {
    const d = docOf(three()), c = after(d, overwriteOps(d, 'main', 'n', clipLayer(3), 'V1', 3));
    expect(c.layers.b).toBeUndefined();
    expect(range(c, 'n')).toEqual([3, 6]);
    expect([range(c, 'a'), range(c, 'c')]).toEqual([[0, 3], [6, 9]]);
  });

  it('over the tail of a clip trims its out, and over the head of the next trims its in', () => {
    const d = docOf(three()), c = after(d, overwriteOps(d, 'main', 'n', clipLayer(2), 'V1', 2));
    expect(range(c, 'a')).toEqual([0, 2]);
    expect(range(c, 'n')).toEqual([2, 4]);
    expect(range(c, 'b')).toEqual([4, 6]);
  });

  it('over the head of a video trims its in and carries the start of its file', () => {
    const d = docOf(three()), c = after(d, overwriteOps(d, 'main', 'n', clipLayer(1), 'V1', 3));
    expect(range(c, 'b')).toEqual([4, 6]);
    expect(c.layers.b.props!.start).toBe(1);
  });

  it('inside one clip splits it in three', () => {
    const d = docOf(three()), c = after(d, overwriteOps(d, 'main', 'n', clipLayer(1), 'V1', 7));
    expect(range(c, 'c')).toEqual([6, 7]);
    expect(range(c, 'n')).toEqual([7, 8]);
    expect(range(c, 'c-2')).toEqual([8, 9]);
    expect(c.layers['c-2'].props!.start).toBe(2);
  });

  it('does nothing on a locked track', () => {
    const c0 = three(); c0.tracks![0].locked = true;
    expect(overwriteOps(docOf(c0), 'main', 'n', clipLayer(1), 'V1', 7)).toEqual([]);
  });
});

describe('draw order', () => {
  it('keeps free layers where they were and puts the clips of the tracks in track order', () => {
    const c0 = three();
    c0.layers.bg = { type: 'shape.rect' }; c0.layers.title = { type: 'text' };
    c0.order = ['bg', 'b', 'a', 'c', 'title'];
    const d = docOf(c0);
    expect(after(d, syncOrderOps(d, 'main')).order).toEqual(['bg', 'a', 'b', 'c', 'title']);
  });

  it('returns no operation when the order is already right', () => {
    const d = docOf(three());
    expect(syncOrderOps(d, 'main')).toEqual([]);
  });
});

describe('ripple trim', () => {
  it('of the out edge by -1 s shifts the following clips left 1 s', () => {
    const d = docOf(three()), c = after(d, rippleTrimOps(d, 'main', 'a', 'out', 2));
    expect([range(c, 'a'), range(c, 'b'), range(c, 'c')]).toEqual([[0, 2], [2, 5], [5, 8]]);
  });

  it('of the out edge past the end lengthens the track and the composition', () => {
    const d = docOf(three()), c = after(d, rippleTrimOps(d, 'main', 'c', 'out', 13));
    expect(range(c, 'c')).toEqual([6, 13]);
    expect(c.duration).toBe(13);
  });

  it('of the in edge keeps the clip where it starts and carries the source', () => {
    const d = docOf(three()), c = after(d, rippleTrimOps(d, 'main', 'b', 'in', 4));
    expect(range(c, 'a')).toEqual([0, 3]);
    expect(range(c, 'b')).toEqual([3, 5]);
    expect(c.layers.b.props!.start).toBe(1);
    expect(range(c, 'c')).toEqual([5, 8]);
  });

  it('stays at the start of its file when asked for more head than the file has', () => {
    const d = docOf(three()), c = after(d, rippleTrimOps(d, 'main', 'b', 'in', 2));
    expect(range(c, 'b')).toEqual([3, 6]);
    expect(range(c, 'c')).toEqual([6, 9]);
  });

  it('still trims the edges of a clip whose start is an expression, without carrying the source', () => {
    const c0 = three(); c0.layers.b.props!.start = { $expr: '1' } as never;
    const d = docOf(c0), c = after(d, rippleTrimOps(d, 'main', 'b', 'in', 4));
    expect(range(c, 'b')).toEqual([3, 5]);
    expect(c.layers.b.props!.start).toEqual({ $expr: '1' });
    expect(range(c, 'c')).toEqual([5, 8]);
  });

  it('next to a transition keeps the overlap length', () => {
    const d = docOf(sequence()), c = after(d, rippleTrimOps(d, 'main', 'a', 'out', 4.5));
    expect(range(c, 'a')).toEqual([0, 4.5]);
    expect(range(c, 'b')).toEqual([3.5, 8.5]);
    expect(c.layers.a.out! - c.layers.b.in!).toBe(1);
  });

  it('does nothing on a locked track', () => {
    const c0 = three(); c0.tracks![0].locked = true;
    expect(rippleTrimOps(docOf(c0), 'main', 'a', 'out', 2)).toEqual([]);
  });
});

describe('roll', () => {
  it('moves the cut and changes the two clips by equal and opposite amounts', () => {
    const d = docOf(three()), c = after(d, rollOps(d, 'main', 'a', 'b', 4));
    expect(range(c, 'a')).toEqual([0, 4]);
    expect(range(c, 'b')).toEqual([4, 6]);
    expect(c.layers.b.props!.start).toBe(1);
    expect(range(c, 'c')).toEqual([6, 9]);
  });

  it('is clamped when the right file has no head left', () => {
    const c0 = three(); c0.layers.b.props!.start = 0.5;
    const d = docOf(c0), c = after(d, rollOps(d, 'main', 'a', 'b', 2));
    expect(range(c, 'a')).toEqual([0, 2.5]);
    expect(range(c, 'b')).toEqual([2.5, 6]);
    expect(c.layers.b.props!.start).toBe(0);
  });

  it('is clamped by the end of the left file when its length is known', () => {
    const d = docOf(three()), c = after(d, rollOps(d, 'main', 'a', 'b', 5, () => 3.5));
    expect(range(c, 'a')).toEqual([0, 3.5]);
    expect(range(c, 'b')).toEqual([3.5, 6]);
  });

  it('keeps one frame at least on the shorter side, and does nothing on a locked track', () => {
    const d = docOf(three()), c = after(d, rollOps(d, 'main', 'a', 'b', 8));
    expect(c.layers.b.in).toBeCloseTo(6 - 1 / 30, 3);
    const c0 = three(); c0.tracks![0].locked = true;
    expect(rollOps(docOf(c0), 'main', 'a', 'b', 4)).toEqual([]);
  });
});

describe('slip', () => {
  it('moves the start of the file by the slip times the rate and leaves in and out', () => {
    const c0 = three(); c0.layers.b.props = { video: 'two', start: 2, rate: 2 };
    const d = docOf(c0), c = after(d, slipOps(d, 'main', 'b', 1));
    expect(c.layers.b.props!.start).toBe(4);
    expect(range(c, 'b')).toEqual([3, 6]);
  });

  it('cannot go before the start of the file, nor past its end when its length is known', () => {
    const c0 = three(); c0.layers.b.props = { video: 'two', start: 2 };
    const d = docOf(c0);
    expect(after(d, slipOps(d, 'main', 'b', -5)).layers.b.props!.start).toBe(0);
    expect(after(d, slipOps(d, 'main', 'b', 5, () => 6)).layers.b.props!.start).toBe(3);
  });

  it('returns [] for a clip whose start is an expression, or that has no file', () => {
    const c0 = three(); c0.layers.b.props!.start = { $expr: '1' } as never; c0.layers.t = { type: 'text', track: 'V1', in: 9, out: 10 };
    const d = docOf(c0);
    expect(slipOps(d, 'main', 'b', 1)).toEqual([]);
    expect(slipOps(d, 'main', 't', 1)).toEqual([]);
  });

  it('slips the clips linked to it by the same amount', () => {
    const c0 = three();
    c0.layers.b.link = 'k'; c0.layers.sb = { type: 'audio', track: 'A1', link: 'k', in: 3, out: 6, props: { audio: 'two', start: 1 } };
    c0.layers.b.props!.start = 1;
    const d = docOf(c0), c = after(d, slipOps(d, 'main', 'b', 0.5));
    expect([c.layers.b.props!.start, c.layers.sb.props!.start]).toEqual([1.5, 1.5]);
  });
});

describe('slide', () => {
  it('moves a clip and trims the out of the left one and the in of the right one by the same amount', () => {
    const d = docOf(three()), c = after(d, slideOps(d, 'main', 'b', 1));
    expect([range(c, 'a'), range(c, 'b'), range(c, 'c')]).toEqual([[0, 4], [4, 7], [7, 9]]);
    expect(c.layers.c.props!.start).toBe(1);
  });

  it('carries the keyframes of the moved clip', () => {
    const c0 = three(); c0.layers.b.transform = { position: { $k: [{ t: 3, v: [0, 0] }, { t: 5, v: [10, 0] }] } };
    const d = docOf(c0), c = after(d, slideOps(d, 'main', 'b', -1));
    expect((c.layers.b.transform!.position as { $k: { t: number }[] }).$k.map((k) => k.t)).toEqual([2, 4]);
  });

  it('is clamped when a neighbour would be left with less than a frame', () => {
    const d = docOf(three()), c = after(d, slideOps(d, 'main', 'b', 10));
    expect(c.layers.c.out! - c.layers.c.in!).toBeCloseTo(1 / 30, 3);
    expect(c.layers.b.out).toBe(c.layers.c.in);
  });

  it('does nothing on a locked track', () => {
    const c0 = three(); c0.tracks![0].locked = true;
    expect(slideOps(docOf(c0), 'main', 'b', 1)).toEqual([]);
  });
});
