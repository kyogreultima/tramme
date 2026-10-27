// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_USAGE } from '@tramme/assistant';
import type { AiEvent, ChatItem } from '../src/api.ts';

const ai = await import('../src/ai/index.ts');
const { ServerSession } = await import('../src/ai/server.ts');
const { api } = await import('../src/api.ts');
const { newProject } = await import('@tramme/project');
const { load, S } = await import('../src/state.ts');

const project = newProject({ name: 'Test', width: 1920, height: 1080, fps: 30, duration: 5 });
load(project.doc, project.manifest, '', '');

/** the turn's events, the usage item at the end among them */
async function turn(events: AiEvent[]): Promise<ChatItem | undefined> {
  vi.spyOn(ServerSession.prototype, 'turn').mockImplementation(async function* () { yield* events; });
  const out: AiEvent[] = [];
  for await (const ev of ai.ask({ text: 'hi', context: {}, doc: S.doc.peek(), decisions: [] }, new AbortController().signal)) out.push(ev);
  return out.flatMap((e) => (e.type === 'item' && e.item.usage ? [e.item] : []))[0];
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 404 })));
  vi.spyOn(api, 'readText').mockResolvedValue(null);
  ai.aiStatus.value = { ...ai.aiStatus.value, server: true, companion: 'absent' };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the usage line of a turn', () => {
  it('names its route', async () => {
    const item = await turn([{ type: 'usage', usage: { ...NO_USAGE, requests: 1, input: 10 } }, { type: 'done' }]);
    expect(item?.usage).toMatchObject({ route: 'server', requests: 1, input: 10 });
    expect(item?.usage?.unknown).toBeUndefined();
  });

  it('marks a turn that reported no usage as unknown, not as zero', async () => {
    const item = await turn([{ type: 'done' }]);
    expect(item?.usage).toMatchObject({ route: 'server', unknown: true });
  });
});
