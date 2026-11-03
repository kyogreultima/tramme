import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startCompanion } from '../src/companion.ts';
import { runEngine, type Turn } from '../src/agents.ts';

const mocks = vi.hoisted(() => ({ handler: null as unknown as (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> }));
const token = 'companion-test-token-with-at-least-32-characters';
vi.mock('node:fs', () => ({ default: { existsSync: () => true, readFileSync: () => JSON.stringify({ token: 'companion-test-token-with-at-least-32-characters' }) } }));
vi.mock('node:http', () => ({ default: { createServer: (handler: typeof mocks.handler) => {
  mocks.handler = handler;
  return { once() {}, listen: (_port: number, _host: string, ready: () => void) => ready() };
} } }));
vi.mock('../src/agents.ts', () => ({ engines: async () => ({}), runEngine: vi.fn(), serveTools: vi.fn(), claudeModelList: vi.fn(), codexModels: vi.fn(), antigravityModels: vi.fn() }));

const turns: { turn: Turn; finish: () => void }[] = [];
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  turns.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(runEngine).mockImplementation((_engine, turn) => new Promise<void>((finish) => { turns.push({ turn, finish }); }));
  await startCompanion({ port: 4317 });
});

function post(route: string, body: unknown) {
  const req = Object.assign(new EventEmitter(), { method: 'POST', url: route, headers: { host: '127.0.0.1:4317', authorization: `Bearer ${token}` } });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, writableFinished: false, headersSent: false,
    writeHead() { this.headersSent = true; return this; }, write() {},
    end() { this.writableEnded = this.writableFinished = true; return this; },
  });
  const done = mocks.handler(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
  req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
  return done;
}

it('lets a tool-free critique finish without aborting the authoring turn or losing its pending tool result', async () => {
  const author = post('/turn', { prompt: 'Make the film', system: 's' });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const result = vi.fn();
  turns[0].turn.pending.set('critique-tool', result);
  const consult = post('/turn', { prompt: 'Review it', system: 's', tools: false });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  try {
    expect(turns[0].turn.abort.signal.aborted).toBe(false);
    turns[1].finish(); await consult;
    await post('/tool-result', { callId: 'critique-tool', result: { content: [{ type: 'text', text: 'review complete' }] } });
    expect(result).toHaveBeenCalledOnce();
    expect(turns[0].turn.abort.signal.aborted).toBe(false);
  } finally { turns.forEach((t) => t.finish()); await Promise.all([author, consult]); }
});

it('still stops the previous authoring turn when a new user turn starts', async () => {
  const first = post('/turn', { prompt: 'First', system: 's' });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const second = post('/turn', { prompt: 'Second', system: 's' });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[0].turn.abort.signal.aborted).toBe(true);
  expect(turns[1].turn.abort.signal.aborted).toBe(false);
  turns.forEach((t) => t.finish()); await Promise.all([first, second]);
});
