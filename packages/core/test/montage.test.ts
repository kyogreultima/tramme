import { describe, expect, it } from 'vitest';
import { cutsOf, isLocked, linkedIds, trackClips, type Composition } from '../src/index.ts';

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
