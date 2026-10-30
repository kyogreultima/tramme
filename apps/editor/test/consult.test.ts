import { afterEach, describe, expect, it, vi } from 'vitest';
import { addConsult, consult, criticModel, freshTurn, seesPictures } from '../src/ai/consult.ts';
import type { TurnUsage } from '../src/api.ts';

const sse = (events: object[]) => new Response(new Blob([events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('')]).stream(), { status: 200 });
const said = (text: string) => sse([
  { type: 'message_start', message: { id: 'm', role: 'assistant', content: [], usage: { input_tokens: 120, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
  { type: 'message_stop' },
]);

afterEach(() => { vi.unstubAllGlobals(); });

describe('who the critic is', () => {
  it('is Opus 5.5 on the server and with the companion\'s Claude, the turn\'s own model elsewhere', () => {
    expect(criticModel('server', 'claude-sonnet-5-5')).toBe('claude-opus-5-5');
    expect(criticModel('companion', 'claude-sonnet-5-5')).toBe('claude-opus-5-5');
    expect(criticModel('remote', 'openai:gpt-5')).toBe('openai:gpt-5');
    expect(criticModel('local', 'local:llama3.1:8b')).toBe('local:llama3.1:8b');
  });

  it('sees pictures unless it is a local model that does not say so', () => {
    expect(seesPictures('local:llama3.1:8b')).toBe(false);
    expect(seesPictures('local:llava:13b')).toBe(true);
    expect(seesPictures('local:qwen2.5-vl:7b')).toBe(true);
    expect(seesPictures('claude-opus-5-5')).toBe(true);
    expect(seesPictures('openai:gpt-5')).toBe(true);
  });
});

describe('a call in a fresh context', () => {
  it('gives the answer and what it cost, with one message and no tools sent', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return said('{"verdict":"done"}'); }));
    const out = await consult({ system: 'You review.', text: 'Look.', images: [{ mediaType: 'image/jpeg', data: 'AAAA' }], signal: new AbortController().signal }, { route: 'server', model: 'claude-opus-5-5' });
    expect(out.text).toBe('{"verdict":"done"}');
    expect(out.usage.input).toBe(120);
    expect(out.usage.output).toBe(30);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].messages).toHaveLength(1);
    expect('tools' in bodies[0]).toBe(false);
    expect(bodies[0].messages[0].content.some((b: { type: string }) => b.type === 'image')).toBe(true);
  });

  it('throws with the route\'s message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'nope' } }), { status: 401 })));
    await expect(consult({ system: 's', text: 't', images: [], signal: new AbortController().signal }, { route: 'server', model: 'claude-opus-5-5' })).rejects.toThrow(/nope/);
  });

  it('adds the usage of consults to a turn\'s, apart from its own', () => {
    const turn = { requests: 3, input: 10, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 5, tools: 2, images: 1, ms: 9, model: 'claude-sonnet-5-5', route: 'server' } as TurnUsage;
    const one = addConsult(turn, { requests: 1, input: 100, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 20 }, 'claude-opus-5-5');
    const two = addConsult(one, { requests: 1, input: 50, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 10 }, 'claude-opus-5-5');
    expect(two.consults).toMatchObject({ n: 2, input: 150, output: 30, model: 'claude-opus-5-5' });
    expect(two.input).toBe(10);
  });
});

describe('a fresh turn on any route', () => {
  const runner = { run: async () => ({ content: [] }) } as never;

  it('on the server, with tools on, posts the tool specs and one message', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return said('built'); }));
    const events: any[] = [];
    for await (const ev of freshTurn({ prompt: 'Build the scene.', system: 'You build.', tools: true, via: { route: 'server', model: 'claude-sonnet-5-5' }, runner, signal: new AbortController().signal })) events.push(ev);
    expect(Array.isArray(bodies[0].tools) && bodies[0].tools.length > 0).toBe(true);
    expect(bodies[0].messages).toHaveLength(1);
    expect(events.some((e) => e.type === 'usage')).toBe(true);
  });

  it('with the companion, sends no session and keeps none', async () => {
    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response('{"type":"session","id":"new"}\n{"type":"done"}\n'); }));
    const kept: string[] = [];
    for await (const _ of freshTurn({ prompt: 'p', system: 'sys', tools: true, via: { route: 'companion', model: 'claude-sonnet-5-5', engine: 'claude', link: { url: 'http://x', token: 't' } }, runner, signal: new AbortController().signal, onSession: (id) => kept.push(id) })) void _;
    expect(sent[0].sessionId).toBeUndefined();
    expect(sent[0].tools).toBe(true);
    // the session the engine opened is not the conversation's: the caller decides, and here it is told, not stored
    expect(kept).toEqual(['new']);
  });
});
