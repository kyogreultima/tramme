import { describe, expect, it } from 'vitest';
import { applyOps, type Composition, type Layer, type TrammeDoc } from '@tramme/core';
import { placeClipOps } from '../src/ui/timeline/place-ops.ts';

const seq = (): Composition => ({
  name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 10, background: null,
  tracks: [{ id: 'V1', kind: 'video', magnetic: true }, { id: 'A1', kind: 'audio' }],
  order: ['a', 'b'],
  layers: {
    a: { type: 'video', track: 'V1', in: 0, out: 3, props: { video: 'one' } },
    b: { type: 'video', track: 'V1', in: 3, out: 6, props: { video: 'two' } },
  },
});
const docOf = (c: Composition) => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main', compositions: { main: c } }) as TrammeDoc;
const video: Layer = { type: 'video', in: 0, out: 2, props: { video: 'x' } };
const main = (d: TrammeDoc, ops: ReturnType<typeof placeClipOps>) => applyOps(d, ops!.ops).doc.compositions.main;

describe('placing a clip from the media on a track', () => {
  it('puts a video with sound at the point as a linked picture and sound, the picture muted', () => {
    const d = docOf(seq()), r = placeClipOps(d, 'main', 'x', { layer: video, withSound: true }, 4.5, 'V1', 'insert')!;
    const c = applyOps(d, r.ops).doc.compositions.main;
    expect([c.layers[r.id].in, c.layers[r.id].out, c.layers[r.id].track]).toEqual([4.5, 6.5, 'V1']);
    const sound = Object.entries(c.layers).find(([, l]) => l.type === 'audio')!;
    expect([sound[1].track, sound[1].in, sound[1].out, sound[1].link]).toEqual(['A1', 4.5, 6.5, c.layers[r.id].link]);
    expect(c.layers[r.id].props!.muted).toBe(true);
  });

  it('puts the sound on a track nothing else plays on, never over a music bed', () => {
    const c0 = seq();
    c0.layers.bed = { type: 'audio', track: 'A1', in: 0, out: 10, props: { audio: 'bed' } }; c0.order.push('bed');
    const d = docOf(c0), r = placeClipOps(d, 'main', 'x', { layer: video, withSound: true }, 3, 'V1', 'insert')!, c = applyOps(d, r.ops).doc.compositions.main;
    const sound = Object.values(c.layers).find((l) => l.type === 'audio' && l.props!.audio === 'x')!;
    expect(sound.track).not.toBe('A1');
    expect(c.tracks!.find((t) => t.id === sound.track)!.kind).toBe('audio');
    expect(c.layers.bed.track).toBe('A1');
  });

  it('pushes the sounds of the shots it pushes, and puts its own in the room left', () => {
    const c0 = seq();
    c0.layers.a.link = 'ka'; c0.layers.sa = { type: 'audio', track: 'A1', link: 'ka', in: 0, out: 3, props: { audio: 'one' } };
    c0.layers.b.link = 'kb'; c0.layers.sb = { type: 'audio', track: 'A1', link: 'kb', in: 3, out: 6, props: { audio: 'two' } };
    c0.order.push('sa', 'sb');
    const d = docOf(c0), r = placeClipOps(d, 'main', 'x', { layer: video, withSound: true }, 3, 'V1', 'insert')!, c = applyOps(d, r.ops).doc.compositions.main;
    expect([c.layers.b.in, c.layers.sb.in]).toEqual([5, 5]);
    const mine = Object.values(c.layers).find((l) => l.type === 'audio' && l.props!.audio === 'x')!;
    expect([mine.track, mine.in, mine.out]).toEqual(['A1', 3, 5]);
  });

  it('makes a sound track when there is none', () => {
    const c0 = seq(); c0.tracks = [{ id: 'V1', kind: 'video' }];
    const d = docOf(c0), r = placeClipOps(d, 'main', 'x', { layer: video, withSound: true }, 0, 'V1', 'overwrite')!;
    expect(applyOps(d, r.ops).doc.compositions.main.tracks!.map((t) => t.id)).toEqual(['V1', 'A1']);
  });

  it('a video without sound is only a picture', () => {
    const d = docOf(seq()), r = placeClipOps(d, 'main', 'x', { layer: video, withSound: false }, 6, 'V1', 'insert')!;
    expect(Object.values(applyOps(d, r.ops).doc.compositions.main.layers).filter((l) => l.type === 'audio')).toHaveLength(0);
  });

  it('on a magnetic track, dropping inside a clip cuts it', () => {
    const d = docOf(seq()), r = placeClipOps(d, 'main', 'x', { layer: video, withSound: false }, 4.5, 'V1', 'insert')!;
    const c = applyOps(d, r.ops).doc.compositions.main;
    expect([c.layers.b.in, c.layers.b.out, c.layers['b-2'].in, c.layers['b-2'].out]).toEqual([3, 4.5, 6.5, 8]);
  });

  it('a picture gets a length of its own, a sound the length it was given', () => {
    const d = docOf(seq()), still = placeClipOps(d, 'main', 'logo', { layer: { type: 'image', props: { image: 'logo' } }, withSound: false }, 6, 'V1', 'overwrite')!;
    const c = main(d, still);
    expect([c.layers[still.id].in, c.layers[still.id].out]).toEqual([6, 11]);
    expect(c.duration).toBe(11);
    const snd = placeClipOps(d, 'main', 'music', { layer: { type: 'audio', props: { audio: 'm' } }, withSound: false, length: 8 }, 1, 'A1', 'overwrite')!;
    expect([main(d, snd).layers[snd.id].in, main(d, snd).layers[snd.id].out]).toEqual([1, 9]);
  });

  it('refuses a sound on a picture track, a picture on a sound track, and a locked track', () => {
    const d = docOf(seq());
    expect(placeClipOps(d, 'main', 'm', { layer: { type: 'audio', props: { audio: 'm' } }, withSound: false, length: 2 }, 0, 'V1', 'insert')).toBeNull();
    expect(placeClipOps(d, 'main', 'x', { layer: video, withSound: false }, 0, 'A1', 'insert')).toBeNull();
    d.compositions.main.tracks![0].locked = true;
    expect(placeClipOps(d, 'main', 'x', { layer: video, withSound: false }, 0, 'V1', 'insert')).toBeNull();
  });
});
