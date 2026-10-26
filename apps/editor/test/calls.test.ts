import { describe, expect, it } from 'vitest';
import type { AiEvent } from '../src/api.ts';
import { paused, runCall } from '../src/ai/calls.ts';
import type { ToolRunner } from '../src/ai/tools.ts';

/** a runner whose tool reports its progress three times, then answers (or fails), with the notice it gives the user */
function runner(answer: { text: string; isError?: boolean } = { text: 'done' }, told = '') {
  const r = {
    events: [] as AiEvent[],
    onProgress: null as ToolRunner['onProgress'],
    told,
    ran: 0,
    async run() {
      r.ran++;
      for (let k = 1; k <= 3; k++) { await new Promise((ok) => setTimeout(ok, 5)); r.onProgress?.(k, 3, 'step'); }
      return { content: [{ type: 'text', text: answer.text }], ...(answer.isError ? { isError: true } : {}) };
    },
  };
  return r;
}

/** every event of a call */
async function all(calls: AsyncGenerator<AiEvent, unknown>): Promise<AiEvent[]> {
  const seen: AiEvent[] = [];
  for (;;) { const n = await calls.next(); if (n.done) return seen; seen.push(n.value); }
}

describe('a tool call', () => {
  it('shows the progress of the tool while it runs, then its end', async () => {
    const r = runner(), seen: AiEvent[] = [];
    const calls = runCall(r as unknown as ToolRunner, 'use_tool', { name: 'cutout' });
    for (;;) { const n = await calls.next(); if (n.done) { expect(n.value).toMatchObject({ content: [{ text: 'done' }] }); break; } seen.push(n.value); }
    expect(seen.map((e) => e.type)).toEqual(['item', 'tool-progress', 'tool-progress', 'tool-progress', 'tool-done']);
    expect(seen[3]).toMatchObject({ progress: { done: 3, total: 3, step: 'step' } });
    expect(r.onProgress).toBeNull();
  });

  it('tells under its line who made what, or the first line of why it failed', async () => {
    const made = await all(runCall(runner({ text: 'sfx made by hydracept' }, 'Sound "rain" made by hydracept (eleven_text_to_sound_v2).') as unknown as ToolRunner, 'use_tool', { name: 'generate-sound' }));
    expect(made.at(-1)).toMatchObject({ type: 'tool-done', error: false, detail: 'Sound "rain" made by hydracept (eleven_text_to_sound_v2).' });
    const failed = await all(runCall(runner({ text: 'generate-sound (plugin core) failed: hydracept: no ElevenLabs connection\nmore', isError: true }) as unknown as ToolRunner, 'use_tool', { name: 'generate-sound' }));
    expect(failed.at(-1)).toMatchObject({ type: 'tool-done', error: true, detail: 'generate-sound (plugin core) failed: hydracept: no ElevenLabs connection' });
    const quiet = await all(runCall(runner({ text: 'oops', isError: true }) as unknown as ToolRunner, 'use_tool', { name: 'x' }, undefined, false));
    expect(quiet.at(-1)).not.toHaveProperty('detail');
  });

  it('waits while the turn is paused, goes on once resumed, and never starts once stopped', async () => {
    const r = runner(), stop = new AbortController();
    paused.value = true;
    const going = all(runCall(r as unknown as ToolRunner, 'use_tool', { name: 'cutout' }));
    await new Promise((ok) => setTimeout(ok, 20));
    expect(r.ran).toBe(0);
    paused.value = false;
    expect((await going).at(-1)).toMatchObject({ type: 'tool-done' });
    expect(r.ran).toBe(1);
    paused.value = true;
    const stopped = all(runCall(r as unknown as ToolRunner, 'use_tool', { name: 'cutout' }, stop.signal));
    stop.abort();
    expect(await stopped).toEqual([]);
    paused.value = false;
    expect(r.ran).toBe(1);
  });
});
