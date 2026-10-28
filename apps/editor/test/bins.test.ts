import { describe, expect, it } from 'vitest';
import { applyOps, DocSchema, type TrammeDoc } from '@tramme/core';
import { addTagsOps, binsOf, filterAssets, removeTagOps, setBinOps, tagsOf } from '../src/bins.ts';

const doc = (): TrammeDoc => ({
  schema: 'tramme/1', meta: { title: 't' }, tokens: {}, root: 'main',
  assets: {
    interview: { type: 'video', src: 'assets/video/interview.mp4', name: 'Interview with Lea', bin: 'Day 1', tags: ['talk', 'lea'] },
    broll: { type: 'video', src: 'assets/video/broll.mp4', name: 'Harbour', bin: 'Day 1', tags: ['b-roll'] },
    music: { type: 'audio', src: 'assets/sounds/theme.mp3', name: 'Theme', bin: 'Music' },
    logo: { type: 'image', src: 'assets/images/logo.png' },
  },
  compositions: { main: { name: 'Main', width: 640, height: 360, fps: 30, duration: 5, layers: {}, order: [] } },
});
const ids = (list: [string, unknown][]) => list.map(([id]) => id);

describe('the bins and tags of the media', () => {
  it('the fields are part of the document format', () => {
    expect(DocSchema.safeParse(doc()).success).toBe(true);
  });

  it('lists the bins by name and the tags with how many media carry each', () => {
    expect(binsOf(doc())).toEqual(['Day 1', 'Music']);
    expect(tagsOf(doc())).toEqual([['b-roll', 1], ['lea', 1], ['talk', 1]]);
  });

  it('filters by bin, with the media in no bin under an empty name', () => {
    expect(ids(filterAssets(doc(), { bin: 'Day 1' }))).toEqual(['interview', 'broll']);
    expect(ids(filterAssets(doc(), { bin: '' }))).toEqual(['logo']);
    expect(ids(filterAssets(doc(), {}))).toEqual(['interview', 'broll', 'music', 'logo']);
  });

  it('filters by tag, and by a text that must be found in the name, the file, the bin or the tags', () => {
    expect(ids(filterAssets(doc(), { tag: 'talk' }))).toEqual(['interview']);
    expect(ids(filterAssets(doc(), { text: 'harbour' }))).toEqual(['broll']);
    expect(ids(filterAssets(doc(), { text: 'day 1 b-roll' }))).toEqual(['broll']);
    expect(ids(filterAssets(doc(), { text: '#lea' }))).toEqual(['interview']);
    expect(ids(filterAssets(doc(), { text: 'nothing like this' }))).toEqual([]);
  });

  it('searching a spoken word finds the clip whose transcript has it', () => {
    const spoken = (id: string) => (id === 'interview' ? 'we left the harbour at dawn' : undefined);
    expect(ids(filterAssets(doc(), { text: 'dawn' }, spoken))).toEqual(['interview']);
    expect(ids(filterAssets(doc(), { text: 'harbour' }, spoken))).toEqual(['interview', 'broll']);
  });

  it('moves media to a bin, and an empty name takes them out', () => {
    const d = doc(), moved = applyOps(d, setBinOps(d, ['logo', 'music'], 'Brand')).doc;
    expect([moved.assets.logo.bin, moved.assets.music.bin]).toEqual(['Brand', 'Brand']);
    expect(applyOps(d, setBinOps(d, ['music'], '  ')).doc.assets.music.bin).toBeUndefined();
    expect(setBinOps(d, ['music'], 'Music')).toEqual([]);
  });

  it('adds tags once, lower case and without spaces, and takes one away', () => {
    const d = doc(), tagged = applyOps(d, addTagsOps(d, ['logo', 'interview'], ['Hero Shot', 'talk'])).doc;
    expect(tagged.assets.logo.tags).toEqual(['hero-shot', 'talk']);
    expect(tagged.assets.interview.tags).toEqual(['talk', 'lea', 'hero-shot']);
    const left = applyOps(tagged, removeTagOps(tagged, ['logo', 'interview'], 'talk')).doc;
    expect([left.assets.logo.tags, left.assets.interview.tags]).toEqual([['hero-shot'], ['lea', 'hero-shot']]);
    expect(applyOps(left, removeTagOps(left, ['logo'], 'hero-shot')).doc.assets.logo.tags).toBeUndefined();
  });
});
