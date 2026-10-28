import { describe, expect, it } from 'vitest';
import { ChatReader, toChat } from '../src/ai/compat.ts';
import type { Message } from '../src/ai/server.ts';

const img = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };

describe('chat format', () => {
  const messages: Message[] = [
    { role: 'user', content: [img, { type: 'text', text: 'Change the title.' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'reading' }, { type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name: 'render_still', input: { t: 1 } }, { type: 'tool_use', id: 't2', name: 'get_document', input: {} }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'frame at 1 s' }, img] },
      { type: 'tool_result', tool_use_id: 't2', content: 'too long', is_error: true },
    ] },
  ];

  it('translates the conversation: tool calls, results right after, their images as a user message', () => {
    const out = toChat(messages, 'system prompt');
    expect(out[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(out[1].role).toBe('user');
    expect(out[1].content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
    expect(out[2]).toMatchObject({ role: 'assistant', content: 'Let me look.' });
    expect(out[2].tool_calls.map((c: any) => [c.id, c.function.name, c.function.arguments])).toEqual([['t1', 'render_still', '{"t":1}'], ['t2', 'get_document', '{}']]);
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'frame at 1 s' });
    expect(out[4]).toEqual({ role: 'tool', tool_call_id: 't2', content: 'Error: too long' });
    expect(out[5].role).toBe('user');
    expect(out[5].content[1].type).toBe('image_url');
    expect(out).toHaveLength(6);
  });

  it('replaces the images by a note for a model without vision, plain strings for text alone', () => {
    const out = toChat(messages, 's', { vision: false });
    expect(out[1].content).toBe('[image this model cannot read]\nChange the title.');
    expect(JSON.stringify(out)).not.toContain('image_url');
  });

  it('sends the pictures of the current turn only', () => {
    const out = toChat(messages, 's', { imagesFrom: 2 });
    expect(out[1].content).toBe('[image seen earlier in the conversation]\nChange the title.');
    expect(out[5].content[1].type).toBe('image_url');
  });

  it('reads a streamed answer: text, reasoning, tool calls in pieces or whole', () => {
    const r = new ChatReader();
    const got = [
      { choices: [{ delta: { reasoning_content: 'Hmm' } }] },
      { choices: [{ delta: { content: 'I ' } }] },
      { choices: [{ delta: { content: 'propose.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'propose_changes', arguments: '{"label":"Ti' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tle"}' } }] } }] },
      // a server sending a whole call without index (Gemini)
      { choices: [{ delta: { tool_calls: [{ id: 'c2', function: { name: 'get_document', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ].map((ev) => r.push(ev));
    expect(got.map((g) => g.reasoning + g.text).join('')).toBe('HmmI propose.');
    expect(r.result()).toEqual({
      stop: 'tool_use',
      invalid: new Set(),
      content: [
        { type: 'text', text: 'I propose.' },
        { type: 'tool_use', id: 'c1', name: 'propose_changes', input: { label: 'Title' } },
        { type: 'tool_use', id: 'c2', name: 'get_document', input: {} },
      ],
    });
    const cut = new ChatReader();
    cut.push({ choices: [{ delta: { content: 'abc' }, finish_reason: 'length' }] });
    expect(cut.result().stop).toBe('max_tokens');
    expect(() => new ChatReader().push({ error: { message: 'quota' } })).toThrow('quota');
  });

  it('reads the usage of the last chunk', () => {
    const r = new ChatReader();
    r.push({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] });
    // the last event carries no choice, only the usage
    r.push({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } });
    expect(r.usage()).toEqual({ requests: 1, input: 200, cacheRead: 800, cacheWrite: 0, cacheWrite1h: 0, output: 50 });
    expect(r.result().stop).toBe('end_turn');
  });

  it('reads the cached share where each provider puts it, and none when nothing was said', () => {
    const read = (usage: object) => { const r = new ChatReader(); r.push({ choices: [], usage }); return r.usage(); };
    expect(read({ prompt_tokens: 100, completion_tokens: 5, cached_tokens: 60 })).toMatchObject({ input: 40, cacheRead: 60 });
    expect(read({ prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 30 })).toMatchObject({ input: 70, cacheRead: 30 });
    expect(read({ prompt_tokens: 100, completion_tokens: 5 })).toMatchObject({ input: 100, cacheRead: 0 });
    expect(new ChatReader().usage()).toBeNull();
  });

  it('tells a call cut off by the length limit from a complete one', () => {
    const r = new ChatReader();
    r.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'propose_changes', arguments: '{"label":"Ti' } }] }, finish_reason: 'length' }] });
    const { stop, invalid } = r.result();
    expect(stop).toBe('max_tokens');
    expect([...invalid]).toEqual(['c1']);
  });

  it('keeps the signatures Gemini puts on its tool calls and sends them back to Gemini only', () => {
    const sig = { google: { thought_signature: 'c2lnbmVk' } };
    const r = new ChatReader();
    r.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'g1', function: { name: 'get_document', arguments: '{}' }, extra_content: sig }] } }] });
    r.push({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'g2', function: { name: 'list_nodes', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
    const { content } = r.result();
    expect(content[0]).toEqual({ type: 'tool_use', id: 'g1', name: 'get_document', input: {}, extra_content: sig });
    expect(content[1]).not.toHaveProperty('extra_content');
    const history: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }, { role: 'assistant', content }];
    // to Gemini: its signature back, the placeholder for an unsigned call (another model's)
    const gemini = toChat(history, 's', { gemini: true })[2].tool_calls;
    expect(gemini[0].extra_content).toEqual(sig);
    expect(gemini[1].extra_content).toEqual({ google: { thought_signature: 'skip_thought_signature_validator' } });
    // to other providers: nothing they would not know
    expect(JSON.stringify(toChat(history, 's'))).not.toContain('extra_content');
  });
});
