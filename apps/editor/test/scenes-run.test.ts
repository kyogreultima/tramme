import { describe, expect, it } from 'vitest';
import { NO_USAGE } from '@tramme/assistant';
import { newProject } from '@tramme/project';
import type { TrammeDoc } from '@tramme/core';
import type { AiEvent, TurnUsage } from '../src/api.ts';
import { assemblyNote, runScenes, scenePrompt } from '../src/ai/scenes-run.ts';
import { setStatus, type FilmPlan, type PlanScene } from '../src/filmplan.ts';

const names = ['Opening', 'Price', 'Proof', 'Plans', 'Ending'];
function film(n = 3): { plan: FilmPlan; doc: TrammeDoc } {
  const { doc } = newProject({ name: 'F', width: 1920, height: 1080, fps: 30, duration: 20 });
  const scenes: PlanScene[] = Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: names[i] ?? `Scene ${i + 1}`, kind: i % 2 ? 'object' : 'type', idea: `idea of ${i + 1}`, brief: `BRIEF-${i + 1}`, comp: `c${i + 1}`, status: 'todo' as const }));
  for (const s of scenes) doc.compositions[s.comp!] = { name: s.name, width: 1920, height: 1080, fps: 30, duration: 4, layers: {}, order: [] } as never;
  return { doc, plan: { version: 1, kind: 'film-plan', updated: '', idea: 'x', kinds: ['type', 'object'], scenes, directions: [], target: 'assets/style-frames/a.png' } };
}

/** a runner of scenes whose builders call scene-done unless their id is in `forget` */
function harness(plan: FilmPlan, doc: TrammeDoc, forget: string[] = []) {
  const store = { plan };
  const ran: string[] = [];
  const turn = async function* (prompt: string, scene: PlanScene): AsyncGenerator<AiEvent> {
    ran.push(scene.id);
    yield { type: 'item', item: { id: `t-${scene.id}`, role: 'assistant', text: `building ${scene.name}` } };
    if (!forget.includes(scene.id)) store.plan = setStatus(store.plan, scene.id, 'built');
    yield { type: 'usage', usage: { ...NO_USAGE, requests: 1, input: 100, output: 10 } };
  };
  const line = (scene: PlanScene, u: typeof NO_USAGE, ms: number): TurnUsage => ({ ...u, tools: 0, images: 0, ms, model: 'm', route: 'server', scene: scene.name });
  const o = (signal = new AbortController().signal) => ({ plan, doc: () => doc, turn, read: async () => store.plan, save: async (p: FilmPlan) => { store.plan = p; }, line, signal });
  return { store, ran, o };
}
async function drain(g: AsyncGenerator<AiEvent, unknown>) { const events: AiEvent[] = []; let r = await g.next(); while (!r.done) { events.push(r.value); r = await g.next(); } return { events, result: r.value as Awaited<ReturnType<typeof runScenes> extends AsyncGenerator<unknown, infer R> ? R : never> }; }

describe('running the scenes apart', () => {
  it('builds them in order, each item carrying its scene and each usage line its scene\'s name', async () => {
    const { plan, doc } = film();
    const h = harness(plan, doc);
    const { events, result } = await drain(runScenes(h.o()));
    expect(h.ran).toEqual(['s1', 's2', 's3']);
    const items = events.flatMap((e) => (e.type === 'item' ? [e.item] : []));
    expect(items.filter((i) => i.text).map((i) => i.building)).toEqual(['Opening', 'Price', 'Proof']);
    expect(items.filter((i) => i.usage).map((i) => i.usage!.scene)).toEqual(['Opening', 'Price', 'Proof']);
    expect(items.filter((i) => i.usage).every((i) => i.building)).toBe(true);
    expect(result.built).toEqual(['s1', 's2', 's3']);
  });

  it('marks a scene that never called scene-done as failed, and goes on to the next', async () => {
    const { plan, doc } = film();
    const h = harness(plan, doc, ['s2']);
    const { result } = await drain(runScenes(h.o()));
    expect(h.store.plan.scenes.map((s) => s.status)).toEqual(['built', 'failed', 'built']);
    expect(result.built).toEqual(['s1', 's3']);
    expect(result.failed.map((f) => f.id)).toEqual(['s2']);
  });

  it('stops when the signal is aborted, keeping what was built', async () => {
    const { plan, doc } = film();
    const ctl = new AbortController();
    const h = harness(plan, doc);
    const o = h.o(ctl.signal);
    const inner = o.turn;
    o.turn = async function* (p, s) { yield* inner(p, s); ctl.abort(); };
    await drain(runScenes(o));
    expect(h.ran).toEqual(['s1']);
    expect(h.store.plan.scenes[0].status).toBe('built');
    expect(h.store.plan.scenes[1].status).toBe('todo');
  });

  it('leaves a scene with no composition, and says why', async () => {
    const { plan, doc } = film();
    delete plan.scenes[1].comp;
    const h = harness(plan, doc);
    const { result } = await drain(runScenes(h.o()));
    expect(result.skipped).toEqual([{ id: 's2', why: 'it has no composition' }]);
    expect(h.ran).toEqual(['s1', 's3']);
  });

  it('a turn that throws marks its scene failed and the run goes on', async () => {
    const { plan, doc } = film();
    const h = harness(plan, doc);
    const o = h.o();
    o.turn = async function* (_p, s) { if (s.id === 's1') throw new Error('overloaded'); yield { type: 'usage', usage: NO_USAGE }; h.store.plan = setStatus(h.store.plan, s.id, 'built'); };
    const { result } = await drain(runScenes(o));
    expect(result.failed).toEqual([{ id: 's1', why: 'overloaded' }]);
    expect(result.built).toEqual(['s2', 's3']);
  });
});

describe('what a scene builder is told', () => {
  it('names its composition, its brief and its neighbours, and holds no other scene\'s brief', () => {
    const { plan, doc } = film(4);
    const p = scenePrompt(plan, plan.scenes[1], doc);
    expect(p).toContain('"c2"');
    expect(p).toContain('BRIEF-2');
    expect(p).toContain('Opening');
    expect(p).toContain('Proof');
    expect(p).toContain('scene-done');
    for (const other of [1, 3, 4]) expect(p).not.toContain(`BRIEF-${other}`);
    expect(scenePrompt(plan, plan.scenes[0], doc)).toMatch(/opens the film/);
    expect(scenePrompt(plan, plan.scenes[3], doc)).toMatch(/closes the film/);
  });

  it('does not grow with the scenes before it: 24 scenes, prompts within 20 % of one another', () => {
    const { plan, doc } = film(24);
    const lengths = plan.scenes.map((s) => scenePrompt(plan, s, doc).length);
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.2);
  });

  it('the assembly says what was built, failed and skipped, then to assemble and review', () => {
    const note = assemblyNote({ built: ['s1', 's3'], failed: [{ id: 's2', why: 'overloaded' }], skipped: [{ id: 's4', why: 'it has no composition' }] });
    expect(note).toContain('s2');
    expect(note).toContain('overloaded');
    expect(note).toContain('s4');
    expect(note).toContain('critique');
    expect(note).toMatch(/transitions/);
    expect(note).toMatch(/sound/);
  });
});
