import { describe, expect, it } from 'vitest';
import { applyOps, type Composition, type TrammeDoc } from '@tramme/core';
import { addTrackOps, clipsOn, laneOrder, moveToTrackOps, removeTrackOps, soloOf, trackChangeOps } from '../src/ui/timeline/tracks.ts';

const seq = (): Composition => ({
  name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 10, background: null,
  tracks: [{ id: 'V1', kind: 'video' }, { id: 'V2', kind: 'video' }, { id: 'A1', kind: 'audio' }],
  order: ['b', 'a', 'x', 's'],
  layers: {
    a: { type: 'video', track: 'V1', in: 0, out: 3, props: { video: 'one' } },
    b: { type: 'video', track: 'V1', in: 3, out: 6, props: { video: 'two' } },
    x: { type: 'text', in: 1, out: 2 },
    s: { type: 'audio', track: 'A1', in: 0, out: 6, props: { audio: 'one' } },
  },
});
const docOf = (c: Composition) => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main', compositions: { main: c } }) as TrammeDoc;
const after = (c: Composition, ops: ReturnType<typeof trackChangeOps>) => applyOps(docOf(c), ops).doc.compositions.main;

describe('the lanes of a sequence', () => {
  it('shows the video tracks top first, then the sound tracks', () => {
    expect(laneOrder(seq()).map((t) => t.id)).toEqual(['V2', 'V1', 'A1']);
  });

  it('lists the clips of a track by their in point', () => {
    expect(clipsOn(seq(), 'V1')).toEqual(['a', 'b']);
    expect(clipsOn(seq(), 'V2')).toEqual([]);
  });
});

describe('what a track header changes', () => {
  it('lock writes the field on the track, and taking it off removes it', () => {
    const c = seq(), locked = trackChangeOps(c, 'main', 'V2', { locked: true });
    expect(locked).toEqual([{ op: 'add', path: '/compositions/main/tracks/1/locked', value: true }]);
    const c2 = after(c, locked);
    expect(c2.tracks![1].locked).toBe(true);
    expect(trackChangeOps(c2, 'main', 'V2', { locked: false })).toEqual([{ op: 'remove', path: '/compositions/main/tracks/1/locked' }]);
  });

  it('renaming writes the name, an empty name takes it off', () => {
    const c = seq();
    expect(after(c, trackChangeOps(c, 'main', 'A1', { name: 'Voice' })).tracks![2].name).toBe('Voice');
    expect(trackChangeOps(c, 'main', 'A1', { name: '  ' })).toEqual([]);
  });

  it('a change that is already there writes nothing', () => {
    expect(trackChangeOps(seq(), 'main', 'V1', { locked: false })).toEqual([]);
  });
});

describe('adding and removing tracks', () => {
  it('a new video track goes above the others, a new sound track after them, with the next number', () => {
    const c = seq(), v = addTrackOps(c, 'main', 'video'), a = addTrackOps(c, 'main', 'audio');
    expect(v.id).toBe('V3');
    expect(after(c, v.ops).tracks!.map((t) => t.id)).toEqual(['V1', 'V2', 'V3', 'A1']);
    expect(a.id).toBe('A2');
    expect(after(c, a.ops).tracks!.map((t) => t.id)).toEqual(['V1', 'V2', 'A1', 'A2']);
  });

  it('turns an ordinary composition into a sequence when it gets its first track', () => {
    const c = seq(); delete c.kind; delete c.tracks;
    const r = addTrackOps(c, 'main', 'video'), c2 = after(c, r.ops);
    expect(r.id).toBe('V1');
    expect([c2.kind, c2.tracks!.map((t) => t.id)]).toEqual(['sequence', ['V1']]);
  });

  it('a track with clips cannot be removed, an empty one can', () => {
    const d = docOf(seq());
    expect(removeTrackOps(d, 'main', 'V1')).toEqual([]);
    expect(applyOps(d, removeTrackOps(d, 'main', 'V2')).doc.compositions.main.tracks!.map((t) => t.id)).toEqual(['V1', 'A1']);
  });
});

describe('moving a clip to another track', () => {
  it('writes the track and puts the clip in the right place in the stack', () => {
    const d = docOf(seq()), c = applyOps(d, moveToTrackOps(d, 'main', 'x', 'V2')).doc.compositions.main;
    expect(c.layers.x.track).toBe('V2');
    expect(c.order.indexOf('x')).toBeGreaterThan(c.order.indexOf('a'));
  });

  it('refuses a track of another kind, a locked track, and a clip on a locked track', () => {
    const d = docOf(seq());
    expect(moveToTrackOps(d, 'main', 'a', 'A1')).toEqual([]);
    d.compositions.main.tracks![1].locked = true;
    expect(moveToTrackOps(d, 'main', 'a', 'V2')).toEqual([]);
    d.compositions.main.tracks![1].locked = false; d.compositions.main.tracks![0].locked = true;
    expect(moveToTrackOps(d, 'main', 'a', 'V2')).toEqual([]);
  });

  it('refuses to put a clip where it would overlap another one', () => {
    const d = docOf(seq());
    d.compositions.main.layers.v = { type: 'video', track: 'V2', in: 2, out: 4, props: { video: 'q' } };
    d.compositions.main.order.push('v');
    expect(moveToTrackOps(d, 'main', 'b', 'V2')).toEqual([]);
  });
});

describe('solo', () => {
  it('soloing a sound track plays its sounds alone, soloing it again gives the mix back', () => {
    const c = seq(), on = soloOf(c, 'A1', new Set());
    expect([...on]).toEqual(['s']);
    expect([...soloOf(c, 'A1', on)]).toEqual([]);
  });

  it('keeps the other tracks that are soloed', () => {
    const c = seq(); c.layers.s2 = { type: 'audio', track: 'A2', props: { audio: 'q' } }; c.tracks!.push({ id: 'A2', kind: 'audio' });
    expect([...soloOf(c, 'A2', new Set(['s']))].sort()).toEqual(['s', 's2']);
  });
});
