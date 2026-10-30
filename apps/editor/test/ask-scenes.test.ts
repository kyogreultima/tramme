// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_USAGE } from '@tramme/assistant';
import type { AiEvent, ChatItem } from '../src/api.ts';
import type { FilmPlan } from '../src/filmplan.ts';

const ai = await import('../src/ai/index.ts');
const { ServerSession } = await import('../src/ai/server.ts');
const { api } = await import('../src/api.ts');
const { newProject } = await import('@tramme/project');
const { load, S } = await import('../src/state.ts');
const { setStatus } = await import('../src/filmplan.ts');

const project = newProject({ name: 'Test', width: 1920, height: 1080, fps: 30, duration: 12 });
for (const c of ['c1', 'c2', 'c3']) project.doc.compositions[c] = { name: c, width: 1920, height: 1080, fps: 30, duration: 4, layers: {}, order: [] } as never;
load(project.doc, project.manifest, '', '');

let store: FilmPlan | null = null;
const written = (): FilmPlan => ({ version: 1, kind: 'film-plan', updated: new Date().toISOString(), idea: 'x', kinds: ['type', 'object'], directions: [], scenes: ['c1', 'c2', 'c3'].map((c, i) => ({ id: `s${i + 1}`, name: `S${i + 1}`, kind: 'type' as const, idea: 'i', comp: c, status: 'todo' as const })) });
const calls: { prompt: string; system: unknown }[] = [];

async function ask(text = 'make a film') {
  const items: ChatItem[] = [];
  for await (const ev of ai.ask({ text, context: {}, doc: S.doc.peek(), decisions: [] }, new AbortController().signal) as AsyncGenerator<AiEvent>) if (ev.type === 'item') items.push(ev.item);
  return items;
}
/** the director's turn writes the plan (unless it is told not to); each scene's turn marks its scene built */
function mockTurns(director: boolean) {
  let n = 0;
  vi.spyOn(ServerSession.prototype, 'turn').mockImplementation(async function* (prompt: string, _m: string, system: unknown) {
    calls.push({ prompt, system });
    if (n++ === 0 && director) store = written();
    else if (store) { const id = /\(id (s\d)\)/.exec(prompt)?.[1]; if (id) store = setStatus(store, id, 'built'); }
    yield { type: 'usage', usage: { ...NO_USAGE, requests: 1, input: 10 } } as AiEvent;
  } as never);
}

beforeEach(() => {
  calls.length = 0; store = null;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 404 })));
  vi.spyOn(api, 'readText').mockImplementation(async (_p: string, path: string) => (path.endsWith('film-plan.json') && store ? { text: JSON.stringify(store) } : null) as never);
  vi.spyOn(api, 'write').mockImplementation((async (_p: string, path: string, content: string) => { if (path.endsWith('film-plan.json')) store = JSON.parse(content); }) as never);
  ai.aiStatus.value = { ...ai.aiStatus.value, server: true, companion: 'absent' };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('a film built scene by scene, in ask()', () => {
  it('runs three scene turns after the director, then the assembly in the director\'s conversation, each scene with its own usage line', async () => {
    mockTurns(true);
    const items = await ask();
    expect(calls).toHaveLength(5);
    expect(calls[1].prompt).toContain('S1');
    expect(calls[3].prompt).toContain('S3');
    expect(calls[4].prompt).toMatch(/assemble/);
    expect(calls[1].prompt).not.toBe(calls[2].prompt);
    expect(items.filter((i) => i.usage?.scene).map((i) => i.usage!.scene)).toEqual(['S1', 'S2', 'S3']);
    // the director's own usage line closes the turn and holds the assembly too
    expect(items.at(-1)?.usage?.scene).toBeUndefined();
    expect(items.at(-1)?.usage?.requests).toBe(2);
    expect(store!.scenes.map((s) => s.status)).toEqual(['built', 'built', 'built']);
  });

  it('runs no scene when the director did not write the plan this turn', async () => {
    store = { ...written(), updated: '2020-01-01T00:00:00.000Z' };
    mockTurns(false);
    await ask('what time is it');
    expect(calls).toHaveLength(1);
  });

  it('runs no scene when the setting says never', async () => {
    mockTurns(true);
    ai.setAiSettings({ scenesApart: 'off' });
    await ask();
    expect(calls).toHaveLength(1);
    ai.setAiSettings({ scenesApart: 'auto' });
  });
});
