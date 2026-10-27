import { describe, expect, it } from 'vitest';
import { queuedPrompt, userPrompt, type TurnContext } from '../src/index.ts';

const a = { text: 'make it bigger', ctx: { compId: 'main', time: 1, frame: 30, selection: [{ id: 'l1', name: 'Title', type: 'text' }] } satisfies TurnContext };
const b = { text: 'and now the subtitle', ctx: { compId: 'main', time: 4, frame: 120, selection: [{ id: 'l2', name: 'Subtitle', type: 'text' }] } satisfies TurnContext };
const notes = ['Note: the brief is calm.'];

describe('queuedPrompt', () => {
  it('one message is the usual prompt', () => {
    expect(queuedPrompt([a], notes)).toBe(userPrompt(a.text, a.ctx, notes));
  });

  it('several messages keep their order and their own context', () => {
    const p = queuedPrompt([a, b], notes);
    expect(p.split(a.text)).toHaveLength(2);
    expect(p.split(b.text)).toHaveLength(2);
    expect(p.indexOf(a.text)).toBeLessThan(p.indexOf(b.text));
    // each selection sits between its own message's opening and its text
    const first = p.slice(p.indexOf('<message n="1">'), p.indexOf('<message n="2">'));
    const second = p.slice(p.indexOf('<message n="2">'));
    expect(first).toContain('Selection: Title (l1, text)');
    expect(first).not.toContain('Subtitle');
    expect(second).toContain('Selection: Subtitle (l2, text)');
    expect(second).toContain('time 4 s');
    // the notes once, before the first message
    expect(p.split(notes[0])).toHaveLength(2);
    expect(p.indexOf(notes[0])).toBeLessThan(p.indexOf('<message n="1">'));
    expect(p).toMatch(/while you were working/);
  });

  it('the autonomous line appears once', () => {
    const p = queuedPrompt([a, { ...b, ctx: { ...b.ctx, autonomous: true } }], []);
    expect(p.match(/Mode: on your own/g)).toHaveLength(1);
  });
});
