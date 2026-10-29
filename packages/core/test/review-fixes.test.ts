// What the review of the whole branch found, one test each: linked clips that
// follow, transitions that stay joined, keyframes that move with their clip,
// links of split clips, a paste on several tracks, a multicam of clips that
// came with their sound, edges that meet.

import { describe, expect, it } from 'vitest';
import { applyOps, audioClips, insertOps, multicamOps, overwriteOps, pasteOps, reorderOps, rippleDeleteOps, rippleTrimOps, slideOps, type Composition, type Layer, type Op, type TrammeDoc } from '../src/index.ts';

const docOf = (c: Composition): TrammeDoc => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: { one: { type: 'video', src: 'one.mp4' }, two: { type: 'video', src: 'two.mp4' }, three: { type: 'video', src: 'three.mp4' } }, root: 'main', compositions: { main: c } }) as TrammeDoc;
const run = (d: TrammeDoc, ops: Op[]) => applyOps(d, ops).doc.compositions.main;
const range = (c: Composition, id: string) => [c.layers[id].in, c.layers[id].out];
const base = (over: Partial<Composition>): Composition => ({ name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 12, background: null, tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }], order: [], layers: {}, ...over });
const picture = (track: string, a: number, b: number, extra: Partial<Layer> = {}): Layer => ({ type: 'video', track, in: a, out: b, props: { video: 'one', muted: true }, ...extra });
const sound = (track: string, a: number, b: number, extra: Partial<Layer> = {}): Layer => ({ type: 'audio', track, in: a, out: b, props: { audio: 'one' }, ...extra });

/** two shots, each a picture linked to its own sound */
const pair = (): Composition => base({
  order: ['a', 'sa', 'b', 'sb'],
  layers: { a: picture('V1', 0, 3, { link: 'ka' }), sa: sound('A1', 0, 3, { link: 'ka' }), b: picture('V1', 3, 6, { link: 'kb' }), sb: sound('A1', 3, 6, { link: 'kb' }) },
});
const still: Layer = { type: 'image', in: 0, out: 2, props: { image: 'pic' } };

describe('linked clips follow the clips that move', () => {
  it('an insert at a cut moves the sound of every shot it pushes', () => {
    const d = docOf(pair()), c = run(d, insertOps(d, 'main', 'x', still, 'V1', 3));
    expect([range(c, 'a'), range(c, 'sa'), range(c, 'b'), range(c, 'sb')]).toEqual([[0, 3], [0, 3], [5, 8], [5, 8]]);
  });

  it('an insert inside a shot cuts its sound with it, the second halves linked to each other and to nothing else', () => {
    const d = docOf(pair()), c = run(d, insertOps(d, 'main', 'x', still, 'V1', 4.5));
    expect([range(c, 'b'), range(c, 'sb'), range(c, 'b-2'), range(c, 'sb-2')]).toEqual([[3, 4.5], [3, 4.5], [6.5, 8], [6.5, 8]]);
    expect(c.layers['b-2'].link).toBeDefined();
    expect(c.layers['b-2'].link).toBe(c.layers['sb-2'].link);
    expect(c.layers['b-2'].link).not.toBe('kb');
    expect(c.layers.b.link).toBe('kb');
  });

  it('deleting the second half of a shot cut by an insert leaves the first half and its sound', () => {
    const d = docOf(pair()), cut = docOf(run(d, insertOps(d, 'main', 'x', still, 'V1', 4.5))), c = run(cut, rippleDeleteOps(cut, 'main', ['b-2']));
    expect(c.layers.b).toBeDefined();
    expect(c.layers.sb).toBeDefined();
    expect(c.layers['b-2']).toBeUndefined();
    expect(c.layers['sb-2']).toBeUndefined();
  });

  it('putting a shot first brings its sound with it', () => {
    const d = docOf(pair()), c = run(d, reorderOps(d, 'main', 'b', 1));
    expect([range(c, 'b'), range(c, 'sb'), range(c, 'a'), range(c, 'sa')]).toEqual([[0, 3], [0, 3], [3, 6], [3, 6]]);
  });

  it('deleting a clip with no sound closes the sounds of the shots behind it too', () => {
    const c0 = base({ order: ['t', 'a', 'sa'], layers: { t: { type: 'text', track: 'V1', in: 0, out: 2, props: { text: 'Title' } }, a: picture('V1', 2, 5, { link: 'ka' }), sa: sound('A1', 2, 5, { link: 'ka' }) } });
    const d = docOf(c0), c = run(d, rippleDeleteOps(d, 'main', ['t']));
    expect([range(c, 'a'), range(c, 'sa')]).toEqual([[0, 3], [0, 3]]);
  });

  it('a trim that ripples moves the sounds of what follows', () => {
    const d = docOf(pair()), c = run(d, rippleTrimOps(d, 'main', 'a', 'out', 2));
    expect([range(c, 'b'), range(c, 'sb')]).toEqual([[2, 5], [2, 5]]);
  });

  it('a slide brings the sound of the shot, and trims only the neighbours that touch it', () => {
    const c0 = base({ order: ['a', 'b', 'sb', 'c'], layers: { a: picture('V1', 0, 2), b: picture('V1', 3, 6, { link: 'kb' }), sb: sound('A1', 3, 6, { link: 'kb' }), c: picture('V1', 6, 9, { props: { video: 'three', start: 2 } }) } });
    const d = docOf(c0), c = run(d, slideOps(d, 'main', 'b', 1));
    expect(range(c, 'a')).toEqual([0, 2]);
    expect([range(c, 'b'), range(c, 'sb'), range(c, 'c')]).toEqual([[4, 7], [4, 7], [7, 9]]);
  });

  it('a slide does not bring a neighbour earlier than its file begins', () => {
    const c0 = base({ order: ['a', 'b', 'c'], layers: { a: picture('V1', 0, 3), b: picture('V1', 3, 6), c: picture('V1', 6, 9) } });
    const d = docOf(c0);
    expect(slideOps(d, 'main', 'b', -1)).toEqual([]);
    c0.layers.c.props!.start = 0.5;
    const c = run(docOf(c0), slideOps(docOf(c0), 'main', 'b', -1));
    // the next clip has half a second of file before its start: the slide goes that far and no further
    expect([range(c, 'b'), range(c, 'c'), c.layers.c.props!.start]).toEqual([[2.5, 5.5], [5.5, 9], 0]);
  });
});

describe('a transition stays joined', () => {
  const joined = (): Composition => base({
    order: ['a', 'b', 'c'],
    layers: { a: picture('V1', 0, 5), b: picture('V1', 4, 9, { effects: [{ id: 'tr', type: 'fx.transition', props: { from: 'a', duration: 1 } }] }), c: picture('V1', 9, 12) },
  });

  it('deleting the clip that came in over the one before leaves the next one touching it, not over it', () => {
    const d = docOf(joined()), c = run(d, rippleDeleteOps(d, 'main', ['b']));
    expect([range(c, 'a'), range(c, 'c')]).toEqual([[0, 5], [5, 8]]);
  });

  it('a clip joined by a transition is not put among the others', () => {
    const d = docOf(joined());
    expect(reorderOps(d, 'main', 'b', 11)).toEqual([]);
  });
});

describe('the keyframes move with the content', () => {
  it('trimming the start of a clip moves its keyframes earlier with the picture', () => {
    const c0 = base({ order: ['a', 'b'], layers: { a: picture('V1', 0, 3), b: picture('V1', 3, 6, { transform: { opacity: { $k: [{ t: 5.5, v: 1 }, { t: 6, v: 0 }] } } }) } });
    const d = docOf(c0), c = run(d, rippleTrimOps(d, 'main', 'b', 'in', 4));
    expect(range(c, 'b')).toEqual([3, 5]);
    expect((c.layers.b.transform!.opacity as { $k: { t: number }[] }).$k.map((k) => k.t)).toEqual([4.5, 5]);
  });

  it('the keyframes of an effect and of a mask follow a clip that is moved', () => {
    const c0 = base({
      order: ['a', 'b'],
      layers: {
        a: picture('V1', 0, 3),
        b: picture('V1', 3, 9, {
          effects: [{ id: 'blur', type: 'fx.blur', props: { radius: { $k: [{ t: 4, v: 0 }, { t: 5, v: 8 }] } } }],
          masks: [{ id: 'm', props: { feather: { $k: [{ t: 6, v: 0 }, { t: 7, v: 4 }] } } }] as Layer['masks'],
        }),
      },
    });
    const d = docOf(c0), c = run(d, rippleDeleteOps(d, 'main', ['a']));
    expect(range(c, 'b')).toEqual([0, 6]);
    expect(((c.layers.b.effects![0].props!.radius as { $k: { t: number }[] }).$k).map((k) => k.t)).toEqual([1, 2]);
    expect(((c.layers.b.masks![0].props as Record<string, { $k: { t: number }[] }>).feather.$k).map((k) => k.t)).toEqual([3, 4]);
  });
});

describe('a paste on several tracks', () => {
  it('puts each clip on its own track, the pair linked to each other and to nothing else', () => {
    const d = docOf(pair()), c = run(d, pasteOps(d, 'main', [structuredClone(d.compositions.main.layers.b), structuredClone(d.compositions.main.layers.sb)], 'V1', 8, 'overwrite'));
    const added = Object.keys(c.layers).filter((k) => !['a', 'sa', 'b', 'sb'].includes(k)).map((k) => c.layers[k]);
    expect(added.map((l) => [l.type, l.track, l.in, l.out]).sort()).toEqual([['audio', 'A1', 8, 11], ['video', 'V1', 8, 11]]);
    expect(added[0].link).toBeDefined();
    expect(added[0].link).toBe(added[1].link);
    expect(added[0].link).not.toBe('kb');
  });

  it('in insert mode makes room on every track the clips go to', () => {
    const d = docOf(pair()), c = run(d, pasteOps(d, 'main', [structuredClone(d.compositions.main.layers.a), structuredClone(d.compositions.main.layers.sa)], 'V1', 3, 'insert'));
    expect([range(c, 'b'), range(c, 'sb')]).toEqual([[6, 9], [6, 9]]);
  });
});

describe('a multicam of clips that came with their sound', () => {
  const dropped = (): Composition => base({
    tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }, { id: 'A2', kind: 'audio' }],
    order: ['x', 'sx', 'y', 'sy'],
    layers: { x: picture('V1', 0, 6, { link: 'kx' }), sx: sound('A1', 0, 6, { link: 'kx' }), y: picture('V1', 0, 6, { props: { video: 'two', muted: true }, link: 'ky' }), sy: sound('A2', 0, 6, { link: 'ky', props: { audio: 'two' } }) },
  });

  it('plays the sound of the first camera only, once', () => {
    const d = docOf(dropped()), c = run(d, multicamOps(d, 'main', ['x', 'y'])), made = docOf(c);
    expect(audioClips(made, 'main').map((k) => k.layerId)).toEqual(['sx']);
    expect(c.layers.sx.link).toBeUndefined();
    expect(c.layers.x.link).toBeUndefined();
    expect(Object.values(c.layers).filter((l) => l.type === 'audio')).toHaveLength(2);
  });

  it('puts each camera on a picture track nothing else plays on', () => {
    const c0 = dropped();
    c0.layers.t = { type: 'text', track: 'V1', in: 0, out: 6, props: { text: 'Title' } };
    c0.order.push('t');
    const d = docOf(c0), c = run(d, multicamOps(d, 'main', ['x', 'y']));
    expect(c.layers.t.track).toBe('V1');
    expect(c.layers.x.track).not.toBe('V1');
    expect(c.layers.y.track).not.toBe('V1');
    expect(c.layers.x.track).not.toBe(c.layers.y.track);
  });
});

describe('the edges of a cut meet', () => {
  it('an overwrite leaves no frame between the new clip and what it trimmed', () => {
    const c0 = base({ order: ['a'], layers: { a: picture('V1', 0, 3) } });
    const d = docOf(c0), c = run(d, overwriteOps(d, 'main', 'n', { type: 'image', in: 0, out: 4 / 30, props: { image: 'pic' } }, 'V1', 7 / 30));
    expect(c.layers.n.out).toBe(c.layers['a-2'].in);
    expect(c.layers.a.out).toBe(c.layers.n.in);
  });

  it('a clip whose length has more than four decimals still meets its neighbour', () => {
    const c0 = base({ order: ['a', 'b'], layers: { a: picture('V1', 0, 3), b: picture('V1', 3, 6) } });
    const d = docOf(c0), c = run(d, overwriteOps(d, 'main', 'n', { type: 'image', in: 0, out: 301 / 30, props: { image: 'pic' } }, 'V1', 1 / 30));
    expect(c.layers.a.out).toBe(c.layers.n.in);
  });
});
