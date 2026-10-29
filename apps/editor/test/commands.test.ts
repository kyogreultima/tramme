import { describe, expect, it } from 'vitest';
import { applyOps, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { fieldsOf, inputOf, listCommands, matchCommands, parseCommand, ranked, ready, type Command } from '../src/ai/commands.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const sky = {
  tools: [{
    name: 'demo.stars', title: 'Star field', description: 'scatters stars',
    input: { type: 'object', properties: { count: { type: 'integer', minimum: 1, title: 'Count' }, layer: { type: 'string', format: 'layer' }, glow: { type: 'boolean' } }, required: ['count'] },
    run: () => 'ok',
  }],
  prompts: [{ name: 'night', title: 'Night sky', description: 'a whole night scene', prompt: 'Make a night sky.' }],
};

function project(): TrammeDoc {
  const { doc } = newProject({ name: 'Talk', width: 1080, height: 1920, fps: 30, duration: 10 });
  doc.assets.talk = { type: 'video', src: 'assets/video/talk.mp4' };
  doc.assets['transcription-talk'] = { type: 'json', src: 'assets/transcripts/talk.json' };
  doc.assets['transcription-talk-edit'] = { type: 'json', src: 'assets/transcripts/talk-edit.json' };
  return doc;
}

const ctxOf = (doc: TrammeDoc, time = 0): ToolContext => ({ doc, compId: doc.root, time, selection: [], registry: editorRegistry() } as unknown as ToolContext);

describe('the / menu', () => {
  const reg = editorRegistry().clone().use(sky, 'sky');
  const list = listCommands(reg);

  it('lists the editor\'s tools and workflows with the plugins\' ones', () => {
    expect(list.filter((c) => c.kind === 'tool').map((c) => c.name)).toEqual(['captions', 'title', 'keyword', 'lower-third', 'svg-paths', 'kinetic-title', 'bar-chart', 'stat', 'transition', 'quote', 'logo-reveal', 'list', 'timeline', 'split-screen', 'map-journey', 'kit', 'typefaces', 'typeface-use', 'pointer', 'terrain', 'keys', 'riffle', 'events', 'event-counter', 'event-tags', 'event-receipt', 'beats', 'shots', 'subjects', 'palette', 'space', 'still', 'track', 'callout', 'stabilize', 'proxy', 'define_component', 'instantiate', 'detach', 'component-keep', 'component-use', 'denoise', 'skin', 'upscale', 'interpolate', 'cutout', 'depth', 'photo-2.5d', 'model', 'remove-bg', 'lipsync', 'silences', 'ripple_delete', 'insert_clip', 'overwrite_clip', 'ripple_trim', 'roll', 'slip', 'slide', 'detach_audio', 'link', 'sync_clips', 'add_adjustment', 'match_look', 'publish', 'fillers', 'check', 'motion', 'compare', 'critique', 'scene-takes', 'cues', 'sfx', 'sound-find', 'synth', 'generate-sound', 'voices', 'duck', 'sound-keep', 'credits', 'mix', 'generate-image', 'generate-video', 'shorts', 'sources', 'block-add', 'block-use', 'brief', 'film-plan', 'style-frames', 'surface', 'stock', 'pin', 'push-in', 'library-add', 'library-use', 'demo.stars']);
    expect(list.filter((c) => c.kind === 'prompt').map((c) => `${c.name}:${c.from}`)).toEqual(['analyze:tramme', 'dress:tramme', 'review:tramme', 'polish:tramme', 'sound-design:tramme', 'shorts:tramme', 'transcript:tramme', 'cut-silences:tramme', 'beats:tramme', 'still:tramme', 'night:sky']);
  });

  it('finds commands by name first, then by title or description', () => {
    expect(matchCommands(list, 'ti').map((c) => c.name)[0]).toBe('title');
    expect(matchCommands(list, 'stars').map((c) => c.name)).toEqual(['demo.stars']);
    expect(matchCommands(list, 'night scene').map((c) => c.name)).toEqual(['night']);
    expect(matchCommands(list, '').length).toBe(list.length);
  });

  it('reads a message written as a command', () => {
    expect(parseCommand('/demo.stars', list)).toMatchObject({ cmd: { name: 'demo.stars' }, rest: '' });
    expect(parseCommand('/demo.stars  denser at the top ', list)).toMatchObject({ cmd: { name: 'demo.stars' }, rest: 'denser at the top' });
    expect(parseCommand('/nothing here', list)).toBeNull();
    expect(parseCommand('make a title', list)).toBeNull();
  });

  it('opens on what was used last, and searches unchanged', () => {
    const cmd = (name: string): Command => ({ kind: 'tool', name, title: name.toUpperCase(), description: `the ${name} command`, from: 'tramme' });
    const [a, b, c] = [cmd('a'), cmd('b'), cmd('c')];
    expect(ranked([a, b, c], ['c'], '')[0]).toBe(c);
    expect(ranked([a, b, c], ['c', 'b'], '').map((x) => x.name)).toEqual(['c', 'b', 'a']);
    expect(ranked([a, b, c], ['zz'], '')).toEqual([a, b, c]);
    expect(ranked([a, b, c], ['c'], 'a')).toEqual(matchCommands([a, b, c], 'a'));
  });

  it('builds a form from the input schema and reads it back', () => {
    const doc = project();
    const fields = fieldsOf(reg.tool('demo.stars').tool.input, doc, doc.root);
    expect(fields.map((f) => `${f.key}:${f.kind}${f.required ? '*' : ''}`)).toEqual(['count:integer*', 'layer:layer', 'glow:boolean']);
    expect(ready(fields, inputOf(fields, {}))).toBe(false);
    expect(inputOf(fields, { count: '12,4', layer: '', glow: true })).toEqual({ count: 12, glow: true });
    const captions = fieldsOf(reg.tool('captions').tool.input, doc, doc.root);
    expect(captions.find((f) => f.key === 'transcript')?.options?.map(([id]) => id)).toEqual(['transcription-talk', 'transcription-talk-edit']);
  });
});

describe('the dressings as tools', () => {
  it('lay out at the current time and stay valid', () => {
    const reg = editorRegistry();
    let doc = project();
    for (const [name, input] of [['title', { text: 'Hello' }], ['keyword', { text: 'now' }], ['lower-third', { text: 'Ada', subtitle: 'Engineer' }]] as const) {
      const out = reg.tool(name).tool.run(input, ctxOf(doc, 2.5)) as { ops: never[] };
      doc = applyOps(doc, out.ops).doc;
    }
    expect(validate(doc, reg)).toEqual([]);
    const c = doc.compositions[doc.root];
    expect(Object.values(c.layers).every((l) => (l.in ?? 0) >= 2.5)).toBe(true);
  });

  it('put the captions on the transcript of the edit when none is given', () => {
    const doc = project();
    const out = editorRegistry().tool('captions').tool.run({}, ctxOf(doc)) as { ops: { value?: { props?: { transcript?: string } } }[] };
    expect(out.ops.find((o) => o.value?.props?.transcript)?.value?.props?.transcript).toBe('transcription-talk-edit');
  });

  it('places a .glb asset as a model.3d layer that validates', () => {
    const reg = editorRegistry();
    let doc = project();
    doc.assets.beetle = { type: 'model', src: 'assets/chat/beetle.glb', name: 'beetle' };
    const out = reg.tool('model').tool.run({ at: 1, duration: 3 }, ctxOf(doc, 4)) as { ops: never[] };
    doc = applyOps(doc, out.ops).doc;
    expect(validate(doc, reg)).toEqual([]);
    const c = doc.compositions[doc.root];
    const [id, l] = Object.entries(c.layers).find(([, l]) => l.type === 'model.3d')!;
    expect(l.props?.source).toBe('beetle');
    expect(c.order).toContain(id);
    expect(l.in).toBe(1);
  });
});
