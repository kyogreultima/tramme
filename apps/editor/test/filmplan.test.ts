import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { applyOps, validate, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { FILM_PLAN_PATH, FILM_PLAN_TOOLS, PICTURE_KINDS, KIND_LINE, parsePlan, planIssues, planText, type Direction, type FilmPlan, type PictureKind } from '../src/filmplan.ts';

const tool = FILM_PLAN_TOOLS[0];
const run = (input: unknown, ctx: ToolContext) => tool.run(input as never, ctx) as Promise<ToolOutput>;

const scenes = (...kinds: PictureKind[]) => kinds.map((kind, i) => ({ id: `s${i + 1}`, name: `Scene ${i + 1}`, kind, idea: `idea ${i + 1}` }));
const issues = (kinds: PictureKind[], sceneKinds: PictureKind[], example?: FilmPlan['example']) => planIssues({ kinds, scenes: scenes(...sceneKinds), example });

const direction = (name = 'Ink and paper'): Direction => ({
  name, type: 'a heavy condensed grotesque in capitals', palette: 'ink black, bone white and one signal orange',
  light: 'a hard side light with long shadows', materials: 'torn paper, rubber stamps and grain', framing: 'tight crops, big shapes cut by the edge',
});

function doc(): TrammeDoc {
  return newProject({ name: 'Show', width: 1920, height: 1080, fps: 30, duration: 20 }).doc;
}
const ctxOf = (d: TrammeDoc, written: Map<string, string> = new Map(), read: Map<string, string> = new Map()): ToolContext =>
  ({
    doc: d, compId: d.root, registry: builtinRegistry(), time: 0, selection: [],
    writeFile: async (p: string, data: string | Blob) => { written.set(p, typeof data === 'string' ? data : ''); return p; },
    readText: async (p: string) => read.get(p) ?? null,
    assetUrl: () => '', signal: new AbortController().signal,
  } as unknown as ToolContext);

describe('the variety of a film plan', () => {
  it('names two consecutive scenes of one kind', () => {
    const lines = issues(['interface', 'type', 'data', 'object'], ['interface', 'interface', 'type', 'data', 'object']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Scene 1');
    expect(lines[0]).toContain('Scene 2');
    expect(lines[0]).toContain('interface');
  });

  it('asks for at least 3 kinds in a long film, and for no more than the scene count allows', () => {
    const lines = issues(['interface', 'type'], ['interface', 'type', 'interface', 'type', 'interface', 'type']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/at least 3 kinds/);
    expect(issues(['interface', 'type'], ['interface', 'type'])).toEqual([]);
    expect(issues(['interface', 'type'], ['interface'])).toEqual([]);
  });

  it('says when a kind covers more than half the scenes', () => {
    const lines = issues(['type', 'interface', 'data'], ['type', 'interface', 'type', 'type']);
    expect(lines.filter((l) => /more than half/.test(l))).toHaveLength(1);
  });

  it('names a scene whose kind the plan does not list, and a list of kinds out of range', () => {
    expect(issues(['interface', 'type'], ['interface', 'data'])).toHaveLength(1);
    expect(issues(['interface'], ['interface'])).toHaveLength(1);
    const six: PictureKind[] = ['interface', 'type', 'data', 'object', 'diagram', 'photo'];
    expect(issues(six, ['interface', 'type'])).toHaveLength(1);
  });

  it('limits the example\'s kind to a third of the scenes', () => {
    const kinds: PictureKind[] = ['interface', 'type', 'data', 'object'];
    const nine: PictureKind[] = ['interface', 'type', 'interface', 'data', 'interface', 'object', 'interface', 'type', 'data'];
    const lines = issues(kinds, nine, { kind: 'interface', what: 'the essaie animation' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('one kind among the others');
    expect(lines[0]).toContain('3');
    expect(issues(kinds, nine)).toEqual([]);
  });
});

describe('the film-plan tool', () => {
  const input = {
    idea: 'A launch film for a note app: the problem, the product, the proof.',
    kinds: ['type', 'interface', 'data'],
    scenes: [
      { name: 'The noise', kind: 'type', idea: 'one huge word, again and again' },
      { name: 'The app', kind: 'interface', idea: 'the editor, built in layers', hero: true },
      { name: 'The proof', kind: 'data', idea: 'a counter climbing' },
    ],
    directions: [direction()],
  };

  it('writes the file and the document learns it, with unique ids from the names', async () => {
    const d = doc(), written = new Map<string, string>();
    const out = await run({ ...input, scenes: [...input.scenes, { name: 'The app', kind: 'type', idea: 'a closing line' }], kinds: input.kinds }, ctxOf(d, written));
    const saved = JSON.parse(written.get(FILM_PLAN_PATH)!);
    expect(saved.kind).toBe('film-plan');
    expect(saved.scenes.map((s: { id: string }) => s.id)).toEqual(['the-noise', 'the-app', 'the-proof', 'the-app-2']);
    expect(out.ops).toHaveLength(1);
    expect(out.ops![0]).toMatchObject({ op: 'add', path: '/assets/film-plan' });
    const { doc: applied } = applyOps(d, out.ops!);
    expect(applied.assets['film-plan']).toEqual({ type: 'json', src: FILM_PLAN_PATH });
    expect(validate(applied, builtinRegistry())).toEqual([]);
    expect(out.text).not.toContain('To fix:');
  });

  it('puts the issues under To fix, and still writes the plan', async () => {
    const written = new Map<string, string>();
    const out = await run({ ...input, scenes: [input.scenes[0], { ...input.scenes[0], name: 'Again' }, input.scenes[2]] }, ctxOf(doc(), written));
    expect(written.has(FILM_PLAN_PATH)).toBe(true);
    expect(out.text).toContain('To fix:');
    expect(out.text).toContain('Again');
  });

  it('asks for directions long enough to be precise', async () => {
    const out = await run({ ...input, directions: [{ ...direction(), light: 'soft' }] }, ctxOf(doc()));
    expect(out.text).toContain('To fix:');
    expect(out.text).toContain('light');
  });

  it('keeps the frames and the target of the file, and replaces the record', async () => {
    const d = doc(), written = new Map<string, string>();
    const first = await run(input, ctxOf(d, written));
    const kept: FilmPlan = { ...JSON.parse(written.get(FILM_PLAN_PATH)!), frames: [{ path: 'assets/frames/x.jpg', direction: 'Ink and paper', scene: 'the-app', provider: 'p', model: 'm' }], target: 'assets/frames/x.jpg' };
    const applied = applyOps(d, first.ops!).doc;
    const second = await run({ ...input, idea: 'Changed story, longer than before.' }, ctxOf(applied, written, new Map([[FILM_PLAN_PATH, JSON.stringify(kept)]])));
    const saved = JSON.parse(written.get(FILM_PLAN_PATH)!);
    expect(saved.target).toBe('assets/frames/x.jpg');
    expect(saved.frames).toHaveLength(1);
    expect(saved.idea).toBe('Changed story, longer than before.');
    expect(second.ops![0]).toMatchObject({ op: 'replace', path: '/assets/film-plan' });
  });

  it('describes each kind from one table', () => {
    expect(PICTURE_KINDS).toHaveLength(9);
    for (const k of PICTURE_KINDS) expect(KIND_LINE[k].length).toBeGreaterThan(10);
    expect(parsePlan('nope')).toBeNull();
    expect(parsePlan(null)).toBeNull();
  });
});

describe('the plan as the model reads it', () => {
  it('stays short with 40 scenes and still names every one', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, name: `Scene number ${i}`, kind: PICTURE_KINDS[i % 4] as PictureKind, idea: 'a long idea about what happens on this scene, '.repeat(4) }));
    const plan: FilmPlan = { version: 1, kind: 'film-plan', updated: '', idea: 'A long film.', kinds: ['interface', 'type', 'object', 'data'], scenes: many, directions: [direction()], target: 'assets/frames/a.jpg' };
    const text = planText(plan);
    expect(text.length).toBeLessThanOrEqual(2500);
    for (const s of many) expect(text).toContain(s.name);
    expect(text).toContain('assets/frames/a.jpg');
    expect(text).toContain('Ink and paper');
  });
});
