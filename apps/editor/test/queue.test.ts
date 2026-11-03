// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiEvent } from '../src/api.ts';

// the agent is replaced (see beforeEach): each turn waits for the test to end it, and the payload it got is kept
const asked: { text: string; queued?: { text: string; context: { selection?: { id: string }[] } }[]; attachments?: unknown[] }[] = [];
let release: (() => void) | null = null;
let fail = '';
let take: { id: string; label: string; ops: import('@tramme/core').Op[] } | null = null;
const ai = await import('../src/ai/index.ts');
const { chat, chatId, aiSettings, openChat } = ai;
const { api } = await import('../src/api.ts');
const { running, send, decide, stop } = await import('../src/ai/conversation.ts');
const { queue, dequeue, queueWaits, flushQueue } = await import('../src/ai/queue.ts');
const { S, propose, load } = await import('../src/state.ts');
const { newProject } = await import('@tramme/project');
const { pending } = await import('../src/attachments.ts');

/** the running turn ends (its events, then the end of `consume`) */
const endTurn = async () => { release!(); release = null; await new Promise((r) => setTimeout(r, 30)); };
const settle = () => new Promise((r) => setTimeout(r, 0));
const texts = (i: number) => asked[i].queued?.map((m) => m.text);

// a project with one title layer to select
const project = newProject({ name: 'Test', width: 1920, height: 1080, fps: 30, duration: 5 });
load(project.doc, project.manifest, '', '');
const main = S.doc.peek().compositions[S.compId.peek()];
(main.layers as Record<string, unknown>).l1 = { type: 'text', name: 'Title', props: {} };
main.order.push('l1');

// the project's files, in memory
const files = new Map<string, string>();

beforeEach(async () => {
  files.clear();
  vi.spyOn(ai, 'ask').mockImplementation(async function* (p: unknown): AsyncGenerator<AiEvent> {
    asked.push(p as (typeof asked)[number]);
    await new Promise<void>((r) => { release = r; });
    if (take) yield { type: 'proposal', ...take };
    if (fail) yield { type: 'error', message: fail };
    yield { type: 'done' };
  });
  vi.spyOn(api, 'write').mockImplementation(async (_id: string, path: string, body: unknown) => { files.set(path, String(body)); return undefined as never; });
  vi.spyOn(api, 'readText').mockImplementation(async (_id: string, path: string) => (files.has(path) ? { text: files.get(path)!, etag: '' } as never : null));
  if (running.value) { stop(); release?.(); await vi.waitFor(() => expect(running.value).toBe(false)); }
  asked.length = 0; release = null; fail = ''; take = null;
  queue.value = []; chat.value = []; pending.value = []; S.proposal.value = null; S.selection.value = [];
  aiSettings.value = { ...aiSettings.value, apply: 'off' };
});

/** a turn under way, started by a first message */
async function begin() {
  void send('a');
  await vi.waitFor(() => expect(asked).toHaveLength(1));
}

describe('the message queue', () => {
  it('a message sent during a turn waits', async () => {
    await begin();
    await send('b');
    expect(queue.value.map((q) => q.text)).toEqual(['b']);
    expect(asked).toHaveLength(1);
    await endTurn();
  });

  it('the queue leaves when the turn ends, as one turn, in order', async () => {
    await begin();
    await send('b'); await send('c');
    await endTurn();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(texts(1)).toEqual(['b', 'c']);
    expect(queue.value).toEqual([]);
    const users = chat.value.filter((it) => it.role === 'user').map((it) => it.text);
    expect(users).toEqual(['a', 'b', 'c']);
    expect(chat.value.filter((it) => it.role === 'user').every((it) => it.context)).toBe(true);
    await endTurn();
  });

  it('each message keeps the selection it was written with', async () => {
    await begin();
    S.selection.value = ['l1'];
    await send('b');
    S.selection.value = [];
    await send('c');
    await endTurn();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    const [b, c] = asked[1].queued!;
    expect(b.context.selection).not.toEqual(c.context.selection);
    await endTurn();
  });

  it('it waits for the decision on a pending proposal', async () => {
    await begin();
    await send('b');
    propose({ id: 'p1', label: 'Change', ops: [] });
    await endTurn();
    await settle();
    expect(asked).toHaveLength(1);
    expect(queueWaits.value).toBe('decision');
    decide(false);
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    await endTurn();
  });

  it('a stopped turn keeps the queue', async () => {
    await begin();
    await send('b');
    stop();
    release!(); release = null;
    await vi.waitFor(() => expect(running.value).toBe(false));
    await settle();
    expect(asked).toHaveLength(1);
    expect(queueWaits.value).toBe('stopped');
    void flushQueue();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(texts(1) ?? [asked[1].text]).toEqual(['b']);
    await endTurn();
  });

  it('a failed turn keeps the queue', async () => {
    fail = 'boom';
    await begin();
    await send('b');
    await endTurn();
    await settle();
    expect(asked).toHaveLength(1);
    expect(queueWaits.value).toBe('stopped');
  });

  it('a new message after a stop leaves with the queue', async () => {
    await begin();
    await send('b');
    stop();
    release!(); release = null;
    await vi.waitFor(() => expect(running.value).toBe(false));
    void send('d');
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(texts(1)).toEqual(['b', 'd']);
    await endTurn();
  });

  it('a deleted message never leaves', async () => {
    await begin();
    await send('b'); await send('c');
    dequeue(queue.value[0].id);
    await endTurn();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].text).toBe('c');
    expect(asked[1].queued).toBeUndefined();
    await endTurn();
  });

  it('a command is not queued', async () => {
    await begin();
    await send('/x', { command: { cmd: { kind: 'prompt', name: 'x', title: 'x', description: '', from: 'tramme', prompt: '' } } });
    expect(queue.value).toEqual([]);
    await endTurn();
  });

  it('the queue is kept with the conversation', async () => {
    await begin();
    await send('b');
    const id = await vi.waitFor(() => { const v = chatId.value; expect(v).toBeTruthy(); return v!; });
    await vi.waitFor(() => expect(JSON.parse(files.get(`.tramme/chats/${id}.json`) ?? '{}').queue?.map((q: { text: string }) => q.text)).toEqual(['b']));
    stop();
    release!(); release = null;
    await vi.waitFor(() => expect(running.value).toBe(false));
    queue.value = [];
    await openChat(id);
    expect(queue.value.map((q) => q.text)).toEqual(['b']);
    // read back from a file, it does not leave by itself
    expect(queueWaits.value).toBe('stopped');
  });

  it('a take still waiting is kept with the conversation, even after a failed turn', async () => {
    take = { id: 'p9', label: 'Sound', ops: [{ op: 'add', path: '/tokens/pulse', value: { type: 'color', value: '#000000' } }] };
    fail = 'usage limit';
    await begin();
    await endTurn();
    const id = chatId.value!;
    const saved = () => JSON.parse(files.get(`.tramme/chats/${id}.json`) ?? '{}').items.find((it: { proposal?: { id: string } }) => it.proposal?.id === 'p9').proposal;
    await vi.waitFor(() => expect(saved().ops).toHaveLength(1));
    // the page is left and opened again: the take comes back, ready to keep
    S.proposal.value = null; chat.value = [];
    await openChat(id);
    expect(S.proposal.value).toMatchObject({ id: 'p9', status: 'pending', ops: take.ops });
    const ok = decide(true);
    expect(ok).toBe(true);
    expect(S.doc.peek().tokens?.pulse).toBeTruthy();
    // decided, its changes no longer weigh on the file
    await vi.waitFor(() => expect(saved()).toMatchObject({ status: 'accepted' }));
    expect(saved().ops).toBeUndefined();
  });
});
