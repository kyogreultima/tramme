// @vitest-environment happy-dom
// The system prompt is the same from one turn and one project to the next (it
// stays in the cache); the project's brief, plan and installed plugins go with
// the message, and again only when they changed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemParts } from '@tramme/assistant';
import { listClaude, unlistClaude } from './claude-listed.ts';

const ai = await import('../src/ai/index.ts');
const { ServerSession } = await import('../src/ai/server.ts');
const { api } = await import('../src/api.ts');
const { newProject } = await import('@tramme/project');
const { load, S } = await import('../src/state.ts');

const project = newProject({ name: 'Test', width: 1920, height: 1080, fps: 30, duration: 5 });
load(project.doc, project.manifest, '', '');

let brief = '{"about":"Kestrel Freight, air cargo"}';
const sent: { prompt: string; system: SystemParts }[] = [];

async function turn(text: string) {
  for await (const ev of ai.ask({ text, context: {}, doc: S.doc.peek(), decisions: [] }, new AbortController().signal)) void ev;
  return sent[sent.length - 1];
}

beforeEach(() => {
  listClaude();
  ai.newChat();
  sent.length = 0;
  ai.setAiSettings({ model: 'claude-opus-5-5' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 404 })));
  vi.spyOn(api, 'readText').mockImplementation(async (_id: string, path: string) => (path === 'assets/brief.json' ? { text: brief, etag: '' } : null) as never);
  vi.spyOn(ServerSession.prototype, 'turn').mockImplementation(async function* (this: InstanceType<typeof ServerSession>, prompt: string, _model: string, system: SystemParts | string) {
    sent.push({ prompt, system: system as SystemParts });
    // the conversation goes on: the next turn is not the first
    this.messages.push({ role: 'user', content: prompt } as never);
    yield { type: 'done' };
  });
  ai.aiStatus.value = { ...ai.aiStatus.value, server: true, companion: 'absent' };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); unlistClaude(); });

describe("the project's note", () => {
  it('leaves the system prompt alone and rides with the first message', async () => {
    const first = await turn('make the intro');
    expect(first.system.variable).toBe('');
    expect(first.system.fixed).not.toContain('Kestrel');
    expect(first.prompt).toMatch(/^<project>[\s\S]*Kestrel Freight[\s\S]*<\/project>/);
  });

  it('is given again only when it changed', async () => {
    const first = await turn('make the intro');
    const second = await turn('slower');
    expect(second.system).toEqual(first.system);
    expect(second.prompt).not.toContain('<project>');
    brief = '{"about":"Kestrel Freight, air cargo, night flights"}';
    const third = await turn('darker');
    expect(third.system).toEqual(first.system);
    expect(third.prompt).toContain('night flights');
  });
});
