import { describe, expect, it } from 'vitest';
import { documentJsonSchema, validate } from '../src/index.ts';
import { makeDoc, registry } from './fixtures.ts';

const issuesOf = (mut: (d: any) => void) => {
  const doc: any = makeDoc();
  mut(doc);
  return validate(doc, registry());
};

describe('validation', () => {
  it('the test document is valid', () => {
    expect(validate(makeDoc(), registry())).toEqual([]);
  });

  it('assets keep the hash of their file and the models that made them', () => {
    expect(issuesOf((d) => { d.assets.mask = { type: 'video', src: 'assets/cutout/v.mp4', hash: 'sha256:aa', madeBy: ['u2net-human-seg@e6d4c49', 'yolos-tiny@main'] }; })).toEqual([]);
    expect(issuesOf((d) => { d.assets.mask = { type: 'video', src: 'assets/cutout/v.mp4', madeBy: 'u2net' }; })[0].path).toBe('/assets/mask/madeBy');
  });

  it('a video names its proxy, another video asset', () => {
    expect(issuesOf((d) => { d.assets.take = { type: 'video', src: 'take.mp4', proxy: 'small' }; d.assets.small = { type: 'video', src: 'small.mp4' }; })).toEqual([]);
    expect(issuesOf((d) => { d.assets.take = { type: 'video', src: 'take.mp4', proxy: 'gone' }; })[0].path).toBe('/assets/take/proxy');
    expect(issuesOf((d) => { d.assets.photo.proxy = 'photo'; })[0].message).toMatch(/only a video/);
  });

  it('masks: their props from the mask schema, one id each', () => {
    const path = { v: [[0, 0], [10, 0], [10, 10]], closed: true };
    expect(issuesOf((d) => { d.compositions.main.layers.bg.masks = [{ id: 'm', props: { path, mode: 'subtract', feather: { $k: [{ t: 0, v: 0 }, { t: 1, v: 20 }] } } }]; })).toEqual([]);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.masks = [{ id: 'm', props: { blur: 3 } }]; })[0].path).toBe('/compositions/main/layers/bg/masks/0/props/blur');
    expect(issuesOf((d) => { d.compositions.main.layers.bg.masks = [{ id: 'm' }, { id: 'm' }]; })[0].message).toMatch(/duplicate mask/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.masks = [{ id: 'm', props: { invert: { $k: [{ t: 0, v: false }, { t: 1, v: true }] } } }]; })[0].message).toMatch(/cannot be animated/);
  });

  it('structure: unknown field, version, type', () => {
    expect(issuesOf((d) => { d.schema = 'tramme/0'; })[0].path).toBe('/schema');
    expect(issuesOf((d) => { d.compositions.main.layers.bg.postion = 1; })[0].path).toBe('/compositions/main/layers/bg');
    expect(issuesOf((d) => { d.compositions.main.fps = -1; })[0].path).toBe('/compositions/main/fps');
  });

  it('tree: orphan layer, placed twice, unknown', () => {
    expect(issuesOf((d) => { d.compositions.main.layers.z = { type: 'box' }; })[0].message).toMatch(/missing from the tree/);
    expect(issuesOf((d) => { d.compositions.main.order.push('a'); })[0].message).toMatch(/twice/);
    expect(issuesOf((d) => { d.compositions.main.order.push('nope'); })[0].message).toMatch(/unknown/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.children = []; })[0].message).toMatch(/does not accept/);
  });

  it('properties: name, type, enum, asset, token, not animatable', () => {
    const p = '/compositions/main/layers/bg/props';
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.colour = '#fff'; })).toEqual([{ path: `${p}/colour`, message: 'unknown property "colour"' }]);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.size = [1]; })[0].message).toBe('[x, y] expected');
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.mode = 'c'; })[0].message).toMatch(/one of a, b/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.image = 'nope'; })[0].message).toMatch(/unknown asset/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.fill = '@nope'; })[0].message).toMatch(/unknown token/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.fill = '@swift'; })[0].message).toMatch(/not a color/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.entry = { $expr: '"y"' }; })[0].message).toMatch(/cannot be animated/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.fill = { type: 'linear', from: [0, 0], to: [1, 1], stops: [[0, '@ink'], [1, '#zzz']] }; })[0].message).toMatch(/unreadable/);
  });

  it('keyframes, curves, expressions, links', () => {
    const p = '/compositions/main/layers/a/props/radius';
    expect(issuesOf((d) => { d.compositions.main.layers.a.props.radius.$k.reverse(); })[0].path).toBe(`${p}/$k/1/t`);
    expect(issuesOf((d) => { d.compositions.main.layers.a.props.radius.$k[0].ease = [2, 0, 1, 1]; })[0].message).toMatch(/between 0 and 1/);
    expect(issuesOf((d) => { d.compositions.main.layers.a.props.radius = { $expr: 'value +' }; })[0].message).toMatch(/invalid expression/);
    expect(issuesOf((d) => { d.compositions.main.layers.b.props.radius = { $link: 'a.nope' }; })[0].message).toMatch(/has no property/);
    expect(issuesOf((d) => { d.compositions.main.layers.b.props.radius = { $link: 'zz.radius' }; })[0].message).toMatch(/unknown layer/);
  });

  it('effects and clips', () => {
    expect(issuesOf((d) => { d.compositions.main.effects[0].type = 'look.nope'; })[0].message).toMatch(/unknown effect/);
    expect(issuesOf((d) => { d.compositions.main.layers.a.clip = 'a'; })[0].message).toMatch(/itself/);
    expect(issuesOf((d) => { d.compositions.main.layers.a.clip = 'grp'; })[0].message).toMatch(/no outline/);
  });

  it('the JSON schema exports', () => {
    const s = documentJsonSchema() as any;
    expect(s.properties.schema.const).toBe('tramme/1');
    expect(s.required).toContain('compositions');
  });
});

describe('sequences: tracks, links, the sound of a video', () => {
  const lane = (mut: (c: any) => void) => issuesOf((d) => {
    const c = d.compositions.main;
    c.kind = 'sequence';
    c.tracks = [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio', locked: true, magnetic: false }];
    c.layers.bg.track = 'V1'; c.layers.bg.link = 'k1';
    mut(c);
  });

  it('a sequence with its tracks and clips on them is valid', () => {
    expect(lane(() => {})).toEqual([]);
  });

  it('a clip on an unknown track is an error', () => {
    expect(lane((c) => { c.layers.bg.track = 'V9'; })[0]).toMatchObject({ path: '/compositions/main/layers/bg/track', message: expect.stringMatching(/unknown track/) });
  });

  it('two tracks with one id is an error, an unknown kind is refused', () => {
    expect(lane((c) => { c.tracks.push({ id: 'V1', kind: 'video' }); })[0]).toMatchObject({ path: '/compositions/main/tracks/2/id' });
    expect(lane((c) => { c.tracks[0].kind = 'text'; }).length).toBeGreaterThan(0);
  });

  it('a document without tracks validates as before', () => {
    expect(issuesOf(() => {})).toEqual([]);
  });

  it('a sound layer may play the sound of a video file, not a picture', () => {
    const reg = () => registry().register({ type: 'sound', title: 'Sound', category: 'test', props: { audio: { type: 'asset', default: null, nullable: true, assetType: 'audio' } }, render: {} });
    const doc = (asset: string): any => { const d: any = makeDoc(); d.assets.clip = { type: 'video', src: 'c.mp4' }; d.compositions.main.layers.s = { type: 'sound', props: { audio: asset } }; d.compositions.main.order.push('s'); return d; };
    expect(validate(doc('clip'), reg())).toEqual([]);
    expect(validate(doc('photo'), reg())[0].message).toMatch(/asset of type audio expected/);
  });
});

describe('sub-clips: a range of a media file', () => {
  const sub = (mut: (d: any) => void) => issuesOf((d) => {
    d.assets.clip = { type: 'video', src: 'c.mp4' };
    d.assets.part = { type: 'video', src: 'c.mp4', name: 'Opening', of: 'clip', range: [2, 7.5] };
    mut(d);
  });

  it('a sub-clip names the media it is a range of, and the range it keeps', () => {
    expect(sub(() => {})).toEqual([]);
  });

  it('is refused when its media is unknown, is not of its kind, or is itself a sub-clip', () => {
    expect(sub((d) => { d.assets.part.of = 'gone'; })[0].path).toBe('/assets/part/of');
    expect(sub((d) => { d.assets.part.of = 'photo'; })[0].message).toMatch(/same kind/);
    expect(sub((d) => { d.assets.more = { type: 'video', src: 'c.mp4', of: 'part', range: [0, 1] }; })[0].path).toBe('/assets/more/of');
  });

  it('needs a range that starts before it ends, and no range without a media', () => {
    expect(sub((d) => { d.assets.part.range = [5, 5]; })[0].path).toBe('/assets/part/range');
    expect(sub((d) => { d.assets.part.range = [-1, 5]; })[0].path).toBe('/assets/part/range');
    expect(sub((d) => { delete d.assets.part.of; })[0].path).toBe('/assets/part/range');
    expect(sub((d) => { delete d.assets.part.range; })[0].path).toBe('/assets/part/range');
  });
});

describe('the example films', () => {
  it('still pass the structure check, with the sequence fields added', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { DocSchema } = await import('../src/index.ts');
    const root = new URL('../../../examples/', import.meta.url);
    const names = readdirSync(root).filter((n) => !n.startsWith('.'));
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const n of names) expect(DocSchema.safeParse(JSON.parse(readFileSync(new URL(`${n}/document.tramme.json`, root), 'utf8'))).success, n).toBe(true);
  });
});
