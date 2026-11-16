import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import type { TrammeDoc } from '@tramme/core';
import { captionCues, footageClips, footageSplit, pathUrl, soundClips, toSrt, toXmeml, type Timeline } from '../src/premiere.ts';

function film(): TrammeDoc {
  const { doc } = newProject({ name: 'Talk', width: 1280, height: 720, fps: 30, duration: 4 });
  const c = doc.compositions[doc.root];
  doc.assets.shot = { type: 'video', src: 'assets/shot.mp4' } as never;
  doc.assets.music = { type: 'audio', src: 'assets/music.mp3' } as never;
  doc.assets.words = { type: 'json', src: 'assets/words.json' } as never;
  c.layers = {
    under: { type: 'text', props: { text: 'UNDER' } },
    shot: { type: 'video', name: 'Shot', in: 0.5, out: 3.5, props: { video: 'shot', start: 1 } },
    title: { type: 'text', props: { text: 'Title' } },
    music: { type: 'audio', name: 'Music', props: { audio: 'music', role: 'music', gain: -6 } },
    subs: { type: 'captions', in: 0.5, out: 3.5, props: { transcript: 'words', start: 1 } },
  } as never;
  c.order = ['under', 'shot', 'title', 'music', 'subs'];
  return doc;
}
const fileOf = (asset: string) => `C:/out/media/${asset}`;

describe('the export for Premiere Pro', () => {
  it('splits the drawing by the footage: under it, the videos of the shoot, over it', () => {
    expect(footageSplit(film(), film().root)).toEqual({ footage: ['shot'], below: ['under'], above: ['title', 'subs'] });
    const none = film();
    delete (none.compositions[none.root].layers as Record<string, unknown>).shot;
    none.compositions[none.root].order = ['under', 'title', 'music', 'subs'];
    expect(footageSplit(none, none.root)).toEqual({ footage: [], below: ['under', 'title', 'subs'], above: [] });
  });

  it('keeps the footage\'s cut and the sounds\' offsets and levels, voices and music on their own tracks', () => {
    const doc = film();
    expect(footageClips(doc, doc.root, fileOf).clips).toEqual([{ name: 'Shot', file: 'C:/out/media/shot', at: 0.5, offset: 1, duration: 3, kind: 'video' }]);
    const { tracks } = soundClips(doc, doc.root, fileOf);
    expect(tracks.map((t) => t.map((c) => [c.file, c.at, c.gainDb]))).toEqual([[['C:/out/media/shot', 0.5, 0]], [['C:/out/media/music', 0, -6]]]);
  });

  it('turns the captions into subtitles in the film\'s time, within the layer', () => {
    const doc = film();
    const words = { words: [{ w: 'Hello', s: 1.0, e: 1.4 }, { w: 'there.', s: 1.4, e: 1.9 }, { w: 'Bye', s: 3.0, e: 3.3 }, { w: 'late', s: 9, e: 9.5 }] };
    const cues = captionCues(doc, doc.root, (a) => (a === 'words' ? words : null));
    expect(cues).toEqual([{ from: 0.5, to: 1.4, text: 'Hello there.' }, { from: 2.5, to: 2.8, text: 'Bye' }]);
    expect(toSrt(cues)).toBe('1\n00:00:00,500 --> 00:00:01,400\nHello there.\n\n2\n00:00:02,500 --> 00:00:02,800\nBye\n');
  });

  it('writes a sequence Premiere reads: frames at its rate, each file once, levels in linear gain', () => {
    const tl: Timeline = {
      name: 'Talk & co', width: 1280, height: 720, fps: 29.97, duration: 4,
      video: [[{ name: 'Shot', file: 'C:/out/media/my shot.mp4', at: 0.5, offset: 1, duration: 3, kind: 'video' }]],
      audio: [[{ name: 'Shot', file: 'C:/out/media/my shot.mp4', at: 0.5, offset: 1, duration: 3, gainDb: -6, kind: 'audio' }]],
    };
    const xml = toXmeml(tl);
    expect(xml).toContain('<name>Talk &amp; co</name>');
    expect(xml).toContain('<timebase>30</timebase><ntsc>TRUE</ntsc>');
    expect(xml.match(/<pathurl>/g)).toHaveLength(1);
    expect(xml).toContain('<file id="file-1"/>');
    expect(xml).toContain('<start>15</start><end>105</end><in>30</in><out>120</out>');
    expect(xml).toContain('<value>0.50119</value>');
    expect(pathUrl('C:\\out\\media\\my shot.mp4')).toBe('file://localhost/C:/out/media/my%20shot.mp4');
    expect(pathUrl('/tmp/a b.mov')).toBe('file://localhost/tmp/a%20b.mov');
  });
});
