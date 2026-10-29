import { describe, expect, it } from 'vitest';
import { applyOps, type Composition, type TrammeDoc } from '@tramme/core';
import { dropOps, endMoveOps, withLinks } from '../src/ui/timeline/clipDrag.ts';

/** three clips end to end on a magnetic V1 */
const seq = (magnetic = true): Composition => ({
  name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 12, background: null,
  tracks: [{ id: 'V1', kind: 'video', magnetic }, { id: 'A1', kind: 'audio' }],
  order: ['a', 'b', 'c'],
  layers: {
    a: { type: 'video', track: 'V1', in: 0, out: 3, props: { video: 'one' } },
    b: { type: 'video', track: 'V1', in: 3, out: 6, props: { video: 'two' } },
    c: { type: 'video', track: 'V1', in: 6, out: 9, props: { video: 'three' } },
  },
});
const docOf = (c: Composition) => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main', compositions: { main: c } }) as TrammeDoc;
const run = (c: Composition, id: string, dt: number) => { const d = docOf(c); return applyOps(d, dropOps(d, 'main', [id], dt)).doc.compositions.main; };
const ranges = (c: Composition) => Object.fromEntries(Object.entries(c.layers).map(([k, l]) => [k, [l.in, l.out]]));

describe('a drag ending on a magnetic track', () => {
  it('moves the third clip between the first and the second and closes the gap', () => {
    // c (6-9) dropped so that its middle is at 3.2 s
    expect(ranges(run(seq(), 'c', -4.3))).toEqual({ a: [0, 3], b: [6, 9], c: [3, 6] });
  });

  it('moves the first clip to the end, the others closing up behind it', () => {
    expect(ranges(run(seq(), 'a', 6.5))).toEqual({ a: [6, 9], b: [0, 3], c: [3, 6] });
  });

  it('leaves everything alone when the clip is dropped in its own place', () => {
    expect(ranges(run(seq(), 'b', 0.4))).toEqual({ a: [0, 3], b: [3, 6], c: [6, 9] });
  });

  it('keeps the clips linked to the one moved at its side', () => {
    const c0 = seq();
    c0.layers.c.link = 'k'; c0.layers.sc = { type: 'audio', track: 'A1', link: 'k', in: 6, out: 9, props: { audio: 'three' } }; c0.order.push('sc');
    const c = run(c0, 'c', -4.3);
    expect(ranges(c).sc).toEqual([3, 6]);
  });

  it('does nothing when the track is locked', () => {
    const c0 = seq(); c0.tracks![0].locked = true;
    const d = docOf(c0);
    expect(dropOps(d, 'main', ['c'], -4.3)).toEqual([]);
  });
});

describe('a drag ending on a free track', () => {
  it('moves the clip and nothing else', () => {
    expect(ranges(run(seq(false), 'c', -4.3))).toEqual({ a: [0, 3], b: [3, 6], c: [1.7, 4.7] });
  });

  it('moves several clips together', () => {
    const d = docOf(seq(false)), c = applyOps(d, dropOps(d, 'main', ['b', 'c'], 1)).doc.compositions.main;
    expect(ranges(c)).toEqual({ a: [0, 3], b: [4, 7], c: [7, 10] });
  });
});

describe('a drag let go', () => {
  it('over its own lane on a magnetic track still reorders the clips', () => {
    const d = docOf(seq()), c = applyOps(d, endMoveOps(d, 'main', ['c'], -4.3, 'V1')).doc.compositions.main;
    expect(ranges(c)).toEqual({ a: [0, 3], b: [6, 9], c: [3, 6] });
  });

  it('over another lane moves the clip there, where it is in time', () => {
    const c0 = seq(); c0.tracks!.splice(1, 0, { id: 'V2', kind: 'video' });
    const d = docOf(c0), c = applyOps(d, endMoveOps(d, 'main', ['c'], 0, 'V2')).doc.compositions.main;
    expect([c.layers.c.track, c.layers.c.in, c.layers.c.out]).toEqual(['V2', 6, 9]);
  });

  it('outside every lane is the move of the clips as they were dragged', () => {
    const d = docOf(seq(false)), c = applyOps(d, endMoveOps(d, 'main', ['c'], -1, null)).doc.compositions.main;
    expect(ranges(c).c).toEqual([5, 8]);
  });
});

describe('clips linked to the ones dragged', () => {
  const linked = (): Composition => {
    const c0 = seq(false);
    c0.layers.b.link = 'kb'; c0.layers.sb = { type: 'audio', track: 'A1', link: 'kb', in: 3, out: 6, props: { audio: 'two' } }; c0.order.push('sb');
    return c0;
  };

  it('go with them', () => {
    const d = docOf(linked()), c = applyOps(d, dropOps(d, 'main', ['b'], 1)).doc.compositions.main;
    expect([ranges(c).b, ranges(c).sb]).toEqual([[4, 7], [4, 7]]);
    expect(withLinks(d.compositions.main, ['b']).sort()).toEqual(['b', 'sb']);
  });

  it('are as locked as the clips: a locked sound keeps its picture where it is', () => {
    const c0 = linked(); c0.tracks![1].locked = true;
    const d = docOf(c0);
    expect(dropOps(d, 'main', ['b'], 1)).toEqual([]);
  });

  it('a selection that holds one locked clip moves none', () => {
    const c0 = seq(false); c0.tracks!.push({ id: 'V2', kind: 'video', locked: true }); c0.layers.c.track = 'V2';
    const d = docOf(c0);
    expect(dropOps(d, 'main', ['a', 'c'], 1)).toEqual([]);
  });
});
