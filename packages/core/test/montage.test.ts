import { describe, expect, it } from 'vitest';
import { registry } from './fixtures.ts';
import { applyOps, audioClips, closeGapOps, multicamOps, switchAngleOps, Evaluator, cutsOf, detachAudioOps, insertOps, isLocked, linkOps, linkedIds, overwriteOps, pasteAttributesOps, pasteOps, unlinkOps, rippleDeleteOps, rippleTrimOps, rollOps, slideOps, slipOps, splitAtOps, syncOrderOps, toSequenceOps, trackClips, type Composition, type Op, type TrammeDoc } from '../src/index.ts';

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

describe('links', () => {
  it('linkOps gives one fresh link to the clips and to the groups they belong to', () => {
    const d = docOf(sequence()), c = after(d, linkOps(d, 'main', ['b', 'sa']));
    expect(c.layers.b.link).toBeDefined();
    expect(c.layers.b.link).toBe(c.layers.sa.link);
    expect(c.layers.a.link).toBe(c.layers.b.link); // a was linked to sa
    expect(new Set([c.layers.a.link]).has('k1')).toBe(false);
  });

  it('unlinkOps takes the clips out of their group and clears a link left with one clip', () => {
    const d = docOf(sequence()), c = after(d, unlinkOps(d, 'main', ['sa']));
    expect(c.layers.sa.link).toBeUndefined();
    expect(c.layers.a.link).toBeUndefined();
  });
});

describe('detach audio', () => {
  it('creates a linked audio layer with the same start, rate and range, and mutes the video', () => {
    const c0 = three(); c0.layers.b.props = { video: 'two', start: 1.5, rate: 2, gain: -3 };
    c0.tracks!.push({ id: 'A2', kind: 'audio' });
    const d = docOf(c0), r = detachAudioOps(d, 'main', 'b', 'A2')!;
    expect(r).not.toBeNull();
    const c = after(d, r.ops), s = c.layers[r.id];
    expect(s.type).toBe('audio');
    expect(s.track).toBe('A2');
    expect([s.in, s.out]).toEqual([3, 6]);
    expect(s.props).toMatchObject({ audio: 'two', start: 1.5, rate: 2, gain: -3 });
    expect(c.layers.b.props!.muted).toBe(true);
    expect(c.layers.b.link).toBeDefined();
    expect(c.layers.b.link).toBe(s.link);
    expect(c.order).toContain(r.id);
  });

  it('returns null for a video already muted, for a layer that is not a video, and on a locked track', () => {
    const c0 = three(); c0.layers.a.props!.muted = true; c0.layers.t = { type: 'text', in: 0, out: 1 };
    const d = docOf(c0);
    expect(detachAudioOps(d, 'main', 'a', 'A1')).toBeNull();
    expect(detachAudioOps(d, 'main', 't', 'A1')).toBeNull();
    c0.tracks![1].locked = true;
    expect(detachAudioOps(docOf(c0), 'main', 'b', 'A1')).toBeNull();
  });
});

describe('paste', () => {
  const two = (): import('../src/index.ts').Layer[] => [
    { type: 'video', in: 10, out: 12, props: { video: 'p' } },
    { type: 'video', in: 12, out: 14, props: { video: 'q' }, transform: { position: { $k: [{ t: 12, v: [0, 0] }, { t: 13, v: [5, 0] }] } } },
  ];

  it('in insert mode puts the clips end to end at the point and shifts the rest once', () => {
    const d = docOf(three()), c = after(d, pasteOps(d, 'main', two(), 'V1', 3, 'insert'));
    const pasted = Object.keys(c.layers).filter((k) => !['a', 'b', 'c'].includes(k));
    expect(pasted.map((k) => range(c, k)).sort()).toEqual([[3, 5], [5, 7]]);
    expect([range(c, 'a'), range(c, 'b'), range(c, 'c')]).toEqual([[0, 3], [7, 10], [10, 13]]);
    const q = pasted.find((k) => c.layers[k].props!.video === 'q')!;
    expect((c.layers[q].transform!.position as { $k: { t: number }[] }).$k.map((k) => k.t)).toEqual([5, 6]);
  });

  it('on a composition without tracks adds them as free layers at the point, their keyframes moved', () => {
    const c0 = three(); delete c0.tracks; delete c0.kind;
    for (const l of Object.values(c0.layers)) delete l.track;
    const d = docOf(c0), c = after(d, pasteOps(d, 'main', two(), null, 3, 'insert'));
    const added = Object.keys(c.layers).filter((k) => !['a', 'b', 'c'].includes(k)).sort();
    expect(added.map((k) => [range(c, k), c.layers[k].track])).toEqual([[[3, 5], undefined], [[5, 7], undefined]]);
    expect(c.order.slice(-2)).toEqual(added);
    expect(range(c, 'b')).toEqual([3, 6]);
    const q = added.find((k) => c.layers[k].props!.video === 'q')!;
    expect((c.layers[q].transform!.position as { $k: { t: number }[] }).$k.map((k) => k.t)).toEqual([5, 6]);
  });

  it('in overwrite mode lays them over what is there', () => {
    const d = docOf(three()), c = after(d, pasteOps(d, 'main', two(), 'V1', 3, 'overwrite'));
    expect(c.layers.b).toBeUndefined();
    expect(range(c, 'a')).toEqual([0, 3]);
    expect(range(c, 'c')).toEqual([7, 9]);
    expect(c.layers.c.props!.start).toBe(1);
  });

  it('attributes: copies effects and transform onto other clips, their keyframes moved, not the range', () => {
    const c0 = three();
    c0.layers.a.effects = [{ id: 'blur', type: 'fx.blur', props: { radius: 4 } }];
    c0.layers.a.blend = 'multiply';
    c0.layers.a.transform = { opacity: { $k: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } };
    const d = docOf(c0), c = after(d, pasteAttributesOps(d, 'main', 'a', ['b'], ['effects', 'transform']));
    expect(c.layers.b.effects).toEqual(c0.layers.a.effects);
    expect((c.layers.b.transform!.opacity as { $k: { t: number }[] }).$k.map((k) => k.t)).toEqual([3, 4]);
    expect(c.layers.b.blend).toBeUndefined();
    expect(range(c, 'b')).toEqual([3, 6]);
  });
});

describe('turning a composition into a sequence', () => {
  const plain = (): Composition => ({
    name: 'Film', width: 640, height: 360, fps: 30, duration: 10, background: null,
    order: ['v1', 'v2', 'logo', 'voice', 'title', 'g'],
    layers: {
      v1: { type: 'video', in: 0, out: 5, props: { video: 'one' } },
      v2: { type: 'video', in: 5, out: 10, props: { video: 'two' } },
      logo: { type: 'image', in: 2, out: 4, props: { image: 'logo' } },
      voice: { type: 'audio', in: 0, out: 10, props: { audio: 'voice' } },
      title: { type: 'text', props: { text: 'Hi' } },
      g: { type: 'group', children: ['inner'] },
      inner: { type: 'video', in: 0, out: 2, props: { video: 'three' } },
    },
  });

  it('puts the pictures on V1, the sounds on A1, leaves the rest free, and keeps the draw order', () => {
    const d = docOf(plain()), c = after(d, toSequenceOps(d, 'main'));
    expect(c.kind).toBe('sequence');
    expect(c.tracks).toEqual([{ id: 'V1', kind: 'video' }, { id: 'V2', kind: 'video' }, { id: 'A1', kind: 'audio' }]);
    expect([c.layers.v1.track, c.layers.v2.track, c.layers.voice.track]).toEqual(['V1', 'V1', 'A1']);
    expect(c.layers.title.track).toBeUndefined();
    expect(c.layers.inner.track).toBeUndefined();
    expect(c.order).toEqual(plain().order);
  });

  it('puts a picture over another one on the track above', () => {
    const d = docOf(plain()), c = after(d, toSequenceOps(d, 'main'));
    expect(c.layers.logo.track).toBe('V2');
  });

  it('keeps clips joined by a transition on one track', () => {
    const c0 = plain(); c0.layers.v2.in = 4; c0.layers.v2.effects = [{ id: 'tr', type: 'fx.transition', props: { from: 'v1', duration: 1 } }];
    delete c0.layers.logo;
    c0.order = c0.order.filter((x) => x !== 'logo');
    const d = docOf(c0), c = after(d, toSequenceOps(d, 'main'));
    expect([c.layers.v1.track, c.layers.v2.track]).toEqual(['V1', 'V1']);
  });

  it('gives the same document when applied twice', () => {
    const d = docOf(plain()), once = after(d, toSequenceOps(d, 'main'));
    expect(toSequenceOps(docOf(once), 'main')).toEqual([]);
  });
});

describe('hidden and muted tracks', () => {
  const media = () => registry().register(
    { type: 'video', title: 'Video', category: 'test', props: { video: { type: 'asset', default: null, nullable: true, assetType: 'video' } }, render: {} },
    { type: 'audio', title: 'Sound', category: 'test', props: { audio: { type: 'asset', default: null, nullable: true, assetType: 'audio' } }, render: {} },
  );
  const withSounds = (): TrammeDoc => {
    const c = sequence();
    c.layers.sa.props = { audio: 'one' };
    return { ...docOf(c), assets: { one: { type: 'video', src: 'one.mp4' }, two: { type: 'video', src: 'two.mp4' } } } as TrammeDoc;
  };

  it('a layer on a hidden track is not drawn, and is silent', () => {
    const d = withSounds(), c = d.compositions.main;
    const shown = (doc: TrammeDoc) => new Evaluator(doc, media()).frame(4.2).layers.map((l) => l.id);
    expect(shown(d)).toContain('a');
    c.tracks![0].hidden = true;
    expect(shown(d)).toEqual([]);
    expect(audioClips(d, 'main').map((x) => x.layerId)).toEqual(['sa']);
  });

  it('a layer on a muted track is drawn but silent', () => {
    const d = withSounds(), c = d.compositions.main;
    expect(audioClips(d, 'main').map((x) => x.layerId).sort()).toEqual(['a', 'b', 'sa']);
    c.tracks![1].muted = true;
    expect(audioClips(d, 'main').map((x) => x.layerId).sort()).toEqual(['a', 'b']);
    expect(new Evaluator(d, media()).frame(1).layers.map((l) => l.id)).toEqual(['a']);
  });
});

describe('splitting at a time', () => {
  it('cuts the clips given and gives the halves of a linked pair a link of their own', () => {
    const c0 = three();
    c0.layers.b.link = 'k'; c0.layers.sb = { type: 'audio', track: 'A1', link: 'k', in: 3, out: 6, props: { audio: 'two' } }; c0.order.push('sb');
    const d = docOf(c0), r = splitAtOps(d, 'main', ['b'], 4);
    const c = after(d, r.ops);
    expect(r.ids.sort()).toEqual(['b-2', 'sb-2']);
    expect([range(c, 'b'), range(c, 'b-2'), range(c, 'sb'), range(c, 'sb-2')]).toEqual([[3, 4], [4, 6], [3, 4], [4, 6]]);
    expect(c.layers.b.link).toBe('k');
    expect(c.layers.sb.link).toBe('k');
    expect(c.layers['b-2'].link).toBeDefined();
    expect(c.layers['b-2'].link).toBe(c.layers['sb-2'].link);
    expect(c.layers['b-2'].link).not.toBe('k');
  });

  it('leaves a clip that is locked, or that the time does not fall in, and says what it cut', () => {
    const c0 = three(); c0.tracks![0].locked = true;
    expect(splitAtOps(docOf(c0), 'main', ['b'], 4)).toEqual({ ops: [], ids: [] });
    expect(splitAtOps(docOf(three()), 'main', ['b'], 8)).toEqual({ ops: [], ids: [] });
  });

  it('cuts every clip of the unlocked tracks the time falls in when none is given', () => {
    const c0 = three();
    c0.layers.t = { type: 'video', track: 'V2', in: 3.5, out: 5, props: { video: 'q' } }; c0.tracks!.push({ id: 'V2', kind: 'video', locked: true }); c0.order.push('t');
    c0.layers.u = { type: 'video', track: 'V3', in: 3.5, out: 5, props: { video: 'q' } }; c0.tracks!.push({ id: 'V3', kind: 'video' }); c0.order.push('u');
    const d = docOf(c0), r = splitAtOps(d, 'main', [], 4);
    expect(r.ids.sort()).toEqual(['b-2', 'u-2']);
  });
});

describe('a multicam', () => {
  /** three cameras on the same scene, side by side on V1 as they were dropped, lined up in time */
  const cameras = (): Composition => ({
    name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 10, background: null,
    tracks: [{ id: 'V1', kind: 'video' }],
    order: ['cam1', 'cam2', 'cam3'],
    layers: {
      cam1: { type: 'video', track: 'V1', in: 0, out: 10, props: { video: 'one' } },
      cam2: { type: 'video', track: 'V1', in: 0, out: 10, props: { video: 'two' } },
      cam3: { type: 'video', track: 'V1', in: 0.5, out: 9.5, props: { video: 'three' } },
    },
  });

  it('is set up with one camera per track, the first on show, the others hidden, one sound for all', () => {
    const d = docOf(cameras()), c = after(d, multicamOps(d, 'main', ['cam1', 'cam2', 'cam3']));
    expect(c.tracks!.map((t) => t.id)).toEqual(['V1', 'V2', 'V3', 'A1']);
    expect([c.layers.cam1.track, c.layers.cam2.track, c.layers.cam3.track]).toEqual(['V1', 'V2', 'V3']);
    expect([c.layers.cam1.visible, c.layers.cam2.visible, c.layers.cam3.visible]).toEqual([undefined, false, false]);
    expect([c.layers.cam1.props!.muted, c.layers.cam2.props!.muted, c.layers.cam3.props!.muted]).toEqual([true, true, true]);
    const sound = Object.values(c.layers).filter((l) => l.type === 'audio');
    expect(sound).toHaveLength(1);
    expect([sound[0].track, sound[0].props!.audio, sound[0].link]).toEqual(['A1', 'one', undefined]);
    expect(c.layers.cam1.link).toBeUndefined();
  });

  it('needs two cameras, and refuses a locked track', () => {
    const d = docOf(cameras());
    expect(multicamOps(d, 'main', ['cam1'])).toEqual([]);
    d.compositions.main.tracks![0].locked = true;
    expect(multicamOps(d, 'main', ['cam1', 'cam2'])).toEqual([]);
  });

  const rigged = () => { const c0 = cameras(); delete c0.layers.cam3; c0.order = ['cam1', 'cam2']; const d = docOf(c0); return docOf(after(d, multicamOps(d, 'main', ['cam1', 'cam2']))); };
  const shown = (c: Composition) => Object.entries(c.layers).filter(([, l]) => l.type === 'video' && l.visible !== false).map(([id, l]) => ({ id, in: l.in!, out: l.out! })).sort((a, b) => a.in - b.in);

  it('cuts every camera at the point and shows the other one from there (the cameras are known by their tracks)', () => {
    const d = rigged(), c = after(d, switchAngleOps(d, 'main', ['V1', 'V2'], 'V2', 4));
    expect(range(c, 'cam1')).toEqual([0, 4]);
    expect(range(c, 'cam2')).toEqual([0, 4]);
    expect(shown(c).map((s) => [s.in, s.out])).toEqual([[0, 4], [4, 10]]);
    expect(c.layers[shown(c)[1].id].props!.video).toBe('two');
  });

  it('three switches give four segments with no gap', () => {
    let d = rigged();
    for (const [to, at] of [['V2', 2], ['V1', 5], ['V2', 8]] as const) d = docOf(after(d, switchAngleOps(d, 'main', ['V1', 'V2'], to, at)));
    const s = shown(d.compositions.main);
    expect(s.map((x) => [x.in, x.out])).toEqual([[0, 2], [2, 5], [5, 8], [8, 10]]);
    expect(s.map((x) => d.compositions.main.layers[x.id].props!.video)).toEqual(['one', 'two', 'one', 'two']);
  });

  it('does nothing when that camera is already on show, or the point is outside the cameras', () => {
    const d = rigged();
    expect(switchAngleOps(d, 'main', ['V1', 'V2'], 'V1', 4)).toEqual([]);
    expect(switchAngleOps(d, 'main', ['V1', 'V2'], 'V2', 12)).toEqual([]);
  });
});
