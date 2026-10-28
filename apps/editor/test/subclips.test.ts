import { describe, expect, it } from 'vitest';
import { applyOps, DocSchema, type Layer, type TrammeDoc } from '@tramme/core';
import { clipFromRange, mediaOf, subclipOps } from '../src/subclips.ts';

const doc = (): TrammeDoc => ({
  schema: 'tramme/1', meta: { title: 't' }, tokens: {}, root: 'main',
  assets: {
    take: { type: 'video', src: 'assets/video/take.mp4', name: 'Take' },
    theme: { type: 'audio', src: 'assets/sounds/theme.mp3' },
    photo: { type: 'image', src: 'assets/images/photo.png' },
    open: { type: 'video', src: 'assets/video/take.mp4', name: 'Opening', of: 'take', range: [4, 9] },
  },
  compositions: { main: { name: 'Main', width: 640, height: 360, fps: 30, duration: 5, layers: {}, order: [] } },
});
const video: Layer = { type: 'video', in: 0, out: 60, props: { video: 'take', size: [1920, 1080] } };

describe('a range of a media file made a layer', () => {
  it('plays the file from the start of the range, as long as the range', () => {
    const l = clipFromRange(video, 2, 7.5);
    expect([l.in, l.out, l.props!.start, l.props!.video]).toEqual([0, 5.5, 2, 'take']);
    expect(video.out).toBe(60);
  });

  it('keeps the rate in account: a clip at twice the speed lasts half the range', () => {
    expect(clipFromRange({ ...video, props: { ...video.props, rate: 2 } }, 2, 8).out).toBe(3);
  });
});

describe('a sub-clip saved from the source monitor', () => {
  it('is a named range of the media, with the same file and nothing copied', () => {
    const d = doc(), r = subclipOps(d, 'take', 'Interview answer', 12, 20.25)!;
    const next = applyOps(d, r.ops).doc;
    expect(next.assets[r.id]).toEqual({ type: 'video', src: 'assets/video/take.mp4', name: 'Interview answer', of: 'take', range: [12, 20.25] });
    expect(DocSchema.safeParse(next).success).toBe(true);
    expect(r.id).toBe('interview-answer');
  });

  it('made from a sub-clip is a range of its media, in the time of the file', () => {
    const d = doc(), r = subclipOps(d, 'open', 'Closer', 5, 6)!;
    expect(applyOps(d, r.ops).doc.assets[r.id]).toMatchObject({ of: 'take', range: [5, 6] });
    expect(mediaOf(d, 'open')).toBe('take');
    expect(mediaOf(d, 'take')).toBe('take');
  });

  it('is refused for a picture, an empty or backwards range, and an unknown media', () => {
    const d = doc();
    expect(subclipOps(d, 'photo', 'x', 0, 1)).toBeNull();
    expect(subclipOps(d, 'take', 'x', 3, 3)).toBeNull();
    expect(subclipOps(d, 'take', 'x', 5, 2)).toBeNull();
    expect(subclipOps(d, 'nope', 'x', 0, 1)).toBeNull();
  });

  it('takes another id when the name is already one', () => {
    const d = doc(), a = subclipOps(d, 'take', 'Part', 0, 1)!, d2 = applyOps(d, a.ops).doc, b = subclipOps(d2, 'take', 'Part', 2, 3)!;
    expect([a.id, b.id]).toEqual(['part', 'part2']);
  });
});
