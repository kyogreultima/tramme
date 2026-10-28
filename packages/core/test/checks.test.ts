import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { runChecks, sampleComposition, Evaluator, type CheckType, type Layer, type TrammeDoc } from '../src/index.ts';

/** a 1080 x 1920 composition of 6 s holding the given layers, in order */
function doc(layers: Record<string, Partial<Layer>>): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'Checks' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 1080, height: 1920, fps: 30, duration: 6, layers: layers as Record<string, Layer>, order: Object.keys(layers) } },
  };
}
const text = (s: string, extra: Partial<Layer> = {}, props: Record<string, unknown> = {}): Partial<Layer> =>
  ({ type: 'text', transform: { position: [540, 960] }, props: { text: s, size: 96, align: 'center', baseline: 'middle', ...props }, ...extra });
const checks = async (d: TrammeDoc) => (await runChecks(d, builtinRegistry())).map((i) => `${i.check}:${(i.layers ?? []).join('+')}`);

describe('quality checks', () => {
  it('place layers in composition space, through their groups', () => {
    const d = doc({ g: { type: 'group', transform: { position: [100, 0], scale: [2, 2] }, children: ['t'] } as Partial<Layer>, t: text('Hi', { transform: { position: [10, 20] } }) });
    d.compositions.main.order = ['g'];
    const [s] = sampleComposition(new Evaluator(d, builtinRegistry()), 'main', 1);
    const t = s.layers.find((p) => p.id === 't')!;
    expect(t.textSize).toBeCloseTo(192);
    expect(t.box!.x + t.box!.w / 2).toBeCloseTo(120);
    expect(t.box!.y + t.box!.h / 2).toBeCloseTo(40);
  });

  it('find nothing to say on a clean composition', async () => {
    expect(await checks(doc({ title: text('A clear title', { in: 0.5 }) }))).toEqual(['stillness:']);
  });

  it('find text too small, too brief, past the edges, and overlapping', async () => {
    const found = await checks(doc({
      tiny: text('small print', {}, { size: 20 }),
      brief: text('a sentence far too long to be read in half a second', { in: 1, out: 1.5, transform: { position: [540, 400] } }),
      edge: text('Off the side', { transform: { position: [1060, 1500] } }),
      a: text('Overlap one', { transform: { position: [540, 1200] } }),
      b: text('Overlap two', { transform: { position: [560, 1210] } }),
    }));
    expect(found).toEqual(expect.arrayContaining(['text-size:tiny', 'text-time:brief', 'safe-zone:edge', 'text-overlap:a+b']));
    expect(found).not.toContain('text-size:edge');
  });

  it('find crowded entrances and still stretches', async () => {
    const dots = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`dot${i}`, { type: 'shape.ellipse', in: 2, transform: { position: [200 + i * 150, 960] }, props: { size: [40, 40] } } as Partial<Layer>]));
    const found = await checks(doc(dots));
    expect(found).toContain('crowd:dot0+dot1+dot2+dot3+dot4');
    // empty for 2 s (under the threshold), then still from 2 to 6 s
    expect(found.filter((f) => f.startsWith('stillness'))).toHaveLength(1);
  });

  it('count a nested composition as playing, its own stretches found when it is checked', async () => {
    const d = doc({ scene: { type: 'comp', transform: { position: [540, 960] }, props: { comp: 'inner' } } });
    d.compositions.inner = { name: 'Inner', width: 1080, height: 1920, fps: 30, duration: 6, layers: { dot: { type: 'shape.ellipse', transform: { position: [540, 960] } } }, order: ['dot'] };
    expect(await checks(d)).toEqual([]);
    expect((await runChecks(d, builtinRegistry(), 'inner')).map((i) => i.check)).toEqual(['stillness']);
  });

  it('find text over a face once the people are known, through the framing of the video', async () => {
    // a 1920x1080 video filling a vertical frame (cover): its middle third shows
    const d = doc({
      clip: { type: 'video', transform: { position: [540, 960] }, props: { video: 'talk', size: [1080, 1920], fit: 'cover' } },
      onFace: text('Hello', { transform: { position: [540, 700] } }),
      below: text('Lower', { transform: { position: [540, 1700] } }),
    });
    d.assets = { talk: { type: 'video', src: 'talk.mp4' }, 'subjects-talk': { type: 'json', src: 'talk-subjects.json' } };
    // someone in the middle of the picture, head at the top, down to y 0.75 (1440 px in the frame)
    const subjects = { version: 1, kind: 'subjects', width: 1920, height: 1080, frames: [{ t: 0, boxes: [{ x: 0.4, y: 0.15, w: 0.2, h: 0.6, label: 'person', score: 0.9 }] }] };
    const issues = await runChecks(d, builtinRegistry(), 'main', { data: (id) => (id === 'subjects-talk' ? subjects : undefined) });
    const over = issues.filter((i) => i.check === 'text-over-subject');
    expect(over.map((i) => `${i.severity}:${i.layers}`)).toEqual(['warning:onFace']);
    // without the analysis, nothing is said
    expect((await runChecks(d, builtinRegistry())).some((i) => i.check === 'text-over-subject')).toBe(false);
  });

  it('find text over the busy part of a picture once its free space is known', async () => {
    // a picture filling the frame, its top left quarter crowded
    const d = doc({
      photo: { type: 'image', transform: { position: [540, 960] }, props: { image: 'shot', size: [1080, 1920], fit: 'fill' } },
      onDetail: text('Busy', { transform: { position: [270, 480] } }),
      clear: text('Calm', { transform: { position: [540, 1500] } }),
    });
    d.assets = { shot: { type: 'image', src: 'shot.png' }, 'space-shot': { type: 'json', src: 'shot-space.json' } };
    const space = { version: 1, kind: 'space', t: 0, width: 1080, height: 1920, cols: 2, rows: 2, busy: [0.9, 0.1, 0.1, 0.1], rect: { x: 0, y: 0.5, w: 1, h: 0.5 } };
    const issues = await runChecks(d, builtinRegistry(), 'main', { data: (id) => (id === 'space-shot' ? space : undefined) });
    expect(issues.filter((i) => i.check === 'text-over-detail').map((i) => i.layers?.join())).toEqual(['onDetail']);
    // without the analysis, nothing is said
    expect((await runChecks(d, builtinRegistry())).some((i) => i.check === 'text-over-detail')).toBe(false);
  });

  it('find text too close in colour to what sits behind it', async () => {
    // a picture bright at the top, dark at the bottom, its luminance known through the space analysis
    const d = doc({
      photo: { type: 'image', transform: { position: [540, 960] }, props: { image: 'shot', size: [1080, 1920], fit: 'fill' } },
      washed: text('Pale', {}, { color: '#FFFFFF' }),
      dark: text('Dark', { transform: { position: [540, 1500] } }, { color: '#000000' }),
    });
    d.assets = { shot: { type: 'image', src: 'shot.png' }, 'space-shot': { type: 'json', src: 'shot-space.json' } };
    const space = { version: 1, kind: 'space', t: 0, width: 1080, height: 1920, cols: 1, rows: 2, busy: [0.1, 0.1], luma: [0.9, 0.15] };
    const issues = await runChecks(d, builtinRegistry(), 'main', { data: (id) => (id === 'space-shot' ? space : undefined) });
    expect(issues.filter((i) => i.check === 'text-contrast').map((i) => i.layers?.join())).toEqual(['washed']);
    // against the composition's own background when no picture is under
    const plain = doc({ t: text('Plate', {}, { color: '#F0EFEA' }) });
    plain.compositions.main.background = '#F0EFEA';
    expect((await runChecks(plain, builtinRegistry())).some((i) => i.check === 'text-contrast')).toBe(true);
    // and nothing without any ground to measure
    expect((await runChecks(doc({ t: text('Ghost', {}, { color: '#F0EFEA' }) }), builtinRegistry())).some((i) => i.check === 'text-contrast')).toBe(false);
  });

  it('run the checks of a plugin, and report one that fails', async () => {
    const custom: CheckType = { name: 'brand', description: 'logo present', run: () => [{ check: 'brand', severity: 'warning', message: 'no logo' }] };
    const broken: CheckType = { name: 'broken', description: 'fails', run: () => { throw new Error('boom'); } };
    const reg = builtinRegistry().clone().use({ checks: [custom, broken] }, 'brandkit');
    const issues = await runChecks(doc({ t: text('Hello') }), reg);
    expect(issues.find((i) => i.check === 'brand')?.message).toBe('no logo');
    expect(issues.find((i) => i.check === 'broken')?.message).toMatch(/boom/);
  });
});

describe('the sequence check', () => {
  /** two clips on V1 and a sound on A1, as given */
  const seq = (mut: (c: any) => void = () => {}): TrammeDoc => {
    const d = doc({
      a: { type: 'shape.rect', track: 'V1', in: 0, out: 3, props: { size: [100, 100] } } as Partial<Layer>,
      b: { type: 'shape.rect', track: 'V1', in: 3, out: 6, props: { size: [100, 100] } } as Partial<Layer>,
      s: { type: 'audio', track: 'A1', in: 0, out: 6 } as Partial<Layer>,
    });
    Object.assign(d.compositions.main, { kind: 'sequence', tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }] });
    mut(d.compositions.main);
    return d;
  };
  const found = async (d: TrammeDoc) => (await runChecks(d, builtinRegistry(), 'main', { only: ['sequence'] })).map((i) => `${i.severity}:${i.layers?.join('+')}`);

  it('has nothing to say about clips that follow one another', async () => {
    expect(await found(seq())).toEqual([]);
  });

  it('warns of two clips overlapping on one track without a transition, not within one', async () => {
    expect(await found(seq((c) => { c.layers.b.in = 2; }))).toEqual(['warning:a+b']);
    expect(await found(seq((c) => { c.layers.b.in = 2; c.layers.b.effects = [{ id: 'tr', type: 'fx.transition', props: { from: 'a', duration: 1 } }]; }))).toEqual([]);
    expect(await found(seq((c) => { c.layers.b.in = 1.5; c.layers.b.effects = [{ id: 'tr', type: 'fx.transition', props: { from: 'a', duration: 1 } }]; }))).toEqual(['warning:a+b']);
  });

  it('warns of a sound on a video track and a picture on an audio track', async () => {
    expect(await found(seq((c) => { c.layers.s.track = 'V1'; c.layers.s.in = 6; c.layers.s.out = 6.5; }))).toEqual(['warning:s']);
    expect(await found(seq((c) => { c.layers.b.track = 'A1'; c.layers.s.out = 3; }))).toEqual(['warning:b']);
  });

  it('notes a link that joins only one clip', async () => {
    expect(await found(seq((c) => { c.layers.a.link = 'k1'; }))).toEqual(['info:a']);
    expect(await found(seq((c) => { c.layers.a.link = 'k1'; c.layers.s.link = 'k1'; }))).toEqual([]);
  });
});
