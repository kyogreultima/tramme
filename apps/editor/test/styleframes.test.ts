// The style frames: drawn from the directions of the film plan, one kept as the
// film's target (a file of the project, never an asset of the document).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext, ToolOutput } from '@tramme/core';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {} });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('addEventListener', () => {});

// the canvas and the pictures are the browser's: a frame half dark, half orange gives the palette
vi.mock('../src/perception.ts', async (original) => {
  const real = await original<typeof import('../src/perception.ts')>();
  const data = new Uint8ClampedArray(96 * 96 * 4);
  for (let i = 0; i < 96 * 96; i++) data.set(i % 96 < 48 ? [0x10, 0x18, 0x20, 255] : [0xf2, 0xaa, 0x4c, 255], i * 4);
  return { ...real, jpegOf: () => 'data:image/jpeg;base64,x', canvas: () => ({ c: {}, g: { drawImage() {}, getImageData: () => ({ data }) } }) };
});
vi.mock('../src/media.ts', async (original) => ({
  ...(await original<typeof import('../src/media.ts')>()),
  canvasOf: (width: number, height: number) => ({ c: { width, height }, g: { drawImage() {} } }),
  dataUrl: async () => 'data:,reference',
}));

const { api } = await import('../src/api.ts');
const confirm = await import('../src/confirm.ts');
const { DEFAULT_PREFERENCES, setPrefs } = await import('../src/settings.ts');
const { STYLE_FRAME_TOOLS, framePrompt } = await import('../src/styleframes.ts');
const { FILM_PLAN_PATH } = await import('../src/filmplan.ts');
import type { Direction, FilmPlan } from '../src/filmplan.ts';

const tool = STYLE_FRAME_TOOLS[0];
const direction = (name: string, extra: Partial<Direction> = {}): Direction => ({
  name, type: `${name} lettering, a heavy grotesque`, palette: `${name} colours, ink and one signal orange`, light: `${name} light, hard from the side`,
  materials: `${name} materials, paper and grain`, framing: `${name} framing, tight crops`, ...extra,
});
const plan = (directions: Direction[]): FilmPlan => ({
  version: 1, kind: 'film-plan', updated: '', idea: 'A launch film.', kinds: ['type', 'interface', 'data'],
  scenes: [{ id: 'the-noise', name: 'The noise', kind: 'type', idea: 'one huge word' }, { id: 'the-app', name: 'The app', kind: 'interface', idea: 'the editor, built in layers', hero: true }],
  directions, ...({} as object),
});

const made = (n = 1) => Array.from({ length: n }, (_, i) => ({ blob: new Blob([`frame ${i + 1}`], { type: 'image/jpeg' }), provider: 'openai', model: 'gpt-image' }));

function ctxOf(files: Map<string, string>, written: Map<string, string | Blob> = new Map()) {
  const doc = { root: 'main', compositions: { main: { width: 1920, height: 1080, fps: 30, duration: 20, layers: {}, order: [] } }, assets: {}, tokens: {} };
  const ctx = {
    doc, compId: 'main', time: 0, signal: new AbortController().signal, fileUrl: (p: string) => `/files/${p}`, assetUrl: () => '', renderStill: async () => 'data:image/jpeg;base64,x',
    readText: async (p: string) => files.get(p) ?? null,
    writeFile: async (p: string, data: string | Blob) => { written.set(p, data); if (typeof data === 'string') files.set(p, data); return p; },
  } as unknown as ToolContext;
  return { ctx, written };
}
const run = (input: Record<string, unknown>, ctx: ToolContext) => tool.run(input as never, ctx) as Promise<ToolOutput>;
const filesWith = (p: FilmPlan | null) => new Map<string, string>(p ? [[FILM_PLAN_PATH, JSON.stringify(p)]] : []);

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1600, height: 900, close() {} }));
  vi.stubGlobal('fetch', async () => ({ ok: true, blob: async () => new Blob(['frame']) }));
});
afterEach(() => { vi.restoreAllMocks(); confirm.turnEnds(); setPrefs({ styleFrames: DEFAULT_PREFERENCES.styleFrames, paidPerTurn: DEFAULT_PREFERENCES.paidPerTurn, confirmPaid: DEFAULT_PREFERENCES.confirmPaid }); });

describe('the prompt of a style frame', () => {
  it('says the scene, then the five fields of the direction, then the finished frame', () => {
    const d = direction('Ink');
    const text = framePrompt(plan([d]), d, plan([d]).scenes[1], { width: 1920, height: 1080 });
    const at = ['the editor, built in layers', 'Type: Ink lettering', 'Palette: Ink colours', 'Light: Ink light', 'Materials: Ink materials', 'Framing: Ink framing', 'A frame from a finished, art-directed film: every element designed, nothing generic.'].map((x) => text.indexOf(x));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain('1920');
  });
});

describe('the style-frames tool', () => {
  it('draws one frame per direction, each from its own words, and holds them when nobody is there', async () => {
    const draw = vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    const { ctx, written } = ctxOf(filesWith(plan([direction('Ink'), direction('Paper')])));
    confirm.turnBegins(true);
    const out = await run({}, ctx);
    expect(draw).toHaveBeenCalledTimes(2);
    const prompts = draw.mock.calls.map((c) => c[0].prompt);
    expect(prompts[0]).toContain('Ink lettering');
    expect(prompts[0]).not.toContain('Paper lettering');
    expect(prompts[1]).toContain('Paper framing');
    expect(prompts[0]).toContain('the editor, built in layers');
    expect(draw.mock.calls[0][0].ratio).toBe('16:9');
    expect(out.ops).toEqual([]);
    expect(written.size).toBe(0);
    expect(out.text).toMatch(/keep: "takes-[a-z0-9]+:<n>"/);
    expect(out.text).toContain('Ink');
    expect(out.text).toContain('Paper');
  });

  it('draws the takes of the only direction when it is given a count', async () => {
    const draw = vi.spyOn(api, 'generateImages').mockImplementation(async (ask) => made(ask.n));
    const { ctx } = ctxOf(filesWith(plan([direction('Ink')])));
    confirm.turnBegins(true);
    await run({ count: 3 }, ctx);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0][0].n).toBe(3);
  });

  it('draws nothing when the frames are off, and says to build from the direction', async () => {
    const draw = vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    setPrefs({ styleFrames: 0 });
    const { ctx, written } = ctxOf(filesWith(plan([direction('Ink')])));
    const out = await run({}, ctx);
    expect(draw).not.toHaveBeenCalled();
    expect(written.size).toBe(0);
    expect(out.ops).toEqual([]);
    expect(out.text).toMatch(/off in the settings/);
    expect(out.text).toMatch(/build from the direction/);
  });

  it('asks for the film plan first when there is none', async () => {
    const draw = vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    const { ctx } = ctxOf(filesWith(null));
    const out = await run({}, ctx);
    expect(draw).not.toHaveBeenCalled();
    expect(out.text).toContain('film-plan');
  });

  it('says to build from the direction when the turn\'s allowance is used up, and writes nothing', async () => {
    vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    setPrefs({ paidPerTurn: 0 });
    const { ctx, written } = ctxOf(filesWith(plan([direction('Ink'), direction('Paper')])));
    confirm.turnBegins(true);
    const out = await run({}, ctx);
    expect(out.ops).toEqual([]);
    expect(written.size).toBe(0);
    expect(out.text).toMatch(/allowance/);
    expect(out.text).toMatch(/build from the direction/);
  });

  it('keeps the only frame drawn before the allowance ran out, and says so', async () => {
    vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    setPrefs({ paidPerTurn: 1 });
    const { ctx } = ctxOf(filesWith(plan([direction('Ink'), direction('Paper')])));
    confirm.turnBegins(true);
    const out = await run({}, ctx);
    expect(out.text).toMatch(/Style frame kept at assets\/frames\/the-app-ink\.jpg/);
    expect(out.text).toMatch(/allowance/);
  });

  it('keeps a held frame as the target: its file and record, the plan, the palette; never an asset or a layer', async () => {
    vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    const files = filesWith(plan([direction('Ink'), direction('Paper')]));
    const { ctx, written } = ctxOf(files);
    confirm.turnBegins(true);
    const held = await run({}, ctx);
    const id = /keep: "(takes-[a-z0-9]+):<n>"/.exec(held.text!)![1];
    const out = await run({ keep: `${id}:2` }, ctx);

    expect([...written.keys()].sort()).toEqual(['assets/film-plan.json', 'assets/frames/the-app-paper.jpg', 'assets/frames/the-app-paper.json']);
    expect(await (written.get('assets/frames/the-app-paper.jpg') as Blob).text()).toBe('frame 1');
    const record = JSON.parse(written.get('assets/frames/the-app-paper.json') as string);
    expect(record).toMatchObject({ provider: 'openai', model: 'gpt-image', direction: 'Paper', scene: 'the-app' });
    expect(record.prompt).toContain('Paper lettering');

    const saved = JSON.parse(written.get(FILM_PLAN_PATH) as string) as FilmPlan;
    expect(saved.target).toBe('assets/frames/the-app-paper.jpg');
    expect(saved.frames).toEqual([{ path: 'assets/frames/the-app-paper.jpg', direction: 'Paper', scene: 'the-app', provider: 'openai', model: 'gpt-image' }]);
    expect(saved.directions.map((d) => d.name)).toEqual(['Paper', 'Ink']);

    const ops = out.ops as { op: string; path: string }[];
    expect(ops.map((o) => o.path)).toContain('/assets/film-plan');
    expect(ops.map((o) => o.path)).toEqual(expect.arrayContaining(['/tokens/plate', '/tokens/ink', '/tokens/accent']));
    expect(ops.filter((o) => o.path.startsWith('/assets/') && o.path !== '/assets/film-plan')).toEqual([]);
    expect(ops.filter((o) => o.path.includes('/layers/'))).toEqual([]);
    const order = ['retype', 'typefaces', 'compare', 'generate-image', 'remove-bg', 'rebuild the scene', 'animate'].map((w) => out.text!.indexOf(w));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out.text).toContain('assets/frames/the-app-paper.jpg');
  });

  it('answers that nothing is held to a second keep, and the plan keeps the first frame', async () => {
    vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    const files = filesWith(plan([direction('Ink'), direction('Paper')]));
    const { ctx, written } = ctxOf(files);
    confirm.turnBegins(true);
    const held = await run({}, ctx);
    const id = /keep: "(takes-[a-z0-9]+):<n>"/.exec(held.text!)![1];
    await run({ keep: `${id}:1` }, ctx);
    written.clear();
    const again = await run({ keep: `${id}:2` }, ctx);
    expect(again.ops).toEqual([]);
    expect(again.text).toMatch(/nothing is held/i);
    expect(written.size).toBe(0);
    expect((JSON.parse(files.get(FILM_PLAN_PATH)!) as FilmPlan).target).toBe('assets/frames/the-app-ink.jpg');
    const stale = await run({ keep: 'takes-from-an-earlier-session:1' }, ctx);
    expect(stale.text).toMatch(/nothing is held/i);
  });

  it('puts one choice per frame to the user, and keeps the one they pick', async () => {
    vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    setPrefs({ confirmPaid: false });
    const { ctx, written } = ctxOf(filesWith(plan([direction('Ink'), direction('Paper')])));
    const pending = run({}, ctx);
    await vi.waitFor(() => expect(confirm.question.peek()?.choices).toBeTruthy());
    expect(confirm.question.peek()!.choices).toHaveLength(2);
    confirm.choose(1);
    const out = await pending;
    expect(written.has('assets/frames/the-app-paper.jpg')).toBe(true);
    expect(out.ops!.length).toBeGreaterThan(0);
  });

  it('draws over a still of the video when it dresses footage', async () => {
    const draw = vi.spyOn(api, 'generateImages').mockImplementation(async () => made());
    const { ctx } = ctxOf(filesWith(plan([direction('Ink')])));
    confirm.turnBegins(true);
    await run({ over: 'frame', provider: 'openai' }, ctx);
    expect(draw.mock.calls[0][0].reference).toBe('data:,reference');
    expect(draw.mock.calls[0][0].prompt).toMatch(/picture given/);
  });
});
