import { describe, expect, it } from 'vitest';
import { claudeModelAsked, claudeOptions } from '../src/agents.ts';

describe('the Claude model a turn asks for', () => {
  it('is the model the editor names, an id or an alias', () => {
    expect(claudeModelAsked('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(claudeModelAsked('claude-fable-5-1')).toBe('claude-fable-5-1');
    expect(claudeModelAsked('opus')).toBe('opus');
    expect(claudeModelAsked('sonnet[1m]')).toBe('sonnet[1m]');
  });

  it('is none when the editor names nothing sensible, so the SDK takes the model Claude Code recommends', () => {
    expect(claudeModelAsked('')).toBeUndefined();
    expect(claudeModelAsked(undefined)).toBeUndefined();
    expect(claudeModelAsked('openai:gpt-5')).toBeUndefined();
    expect(claudeModelAsked('../../x')).toBeUndefined();
    expect(claudeModelAsked('claude-opus-5-5 --dangerously')).toBeUndefined();
  });
});

describe('what Claude is given for the thinking of a model', () => {
  const turn = { send: () => {}, abort: new AbortController(), stop: () => {} } as never;
  const request = { prompt: 'p', system: 's', model: 'claude-opus-5-5', images: [], mcpUrl: '' };

  it('is adaptive thinking, shown summarized, and the effort, for a model that says it thinks when it needs to', () => {
    const options = claudeOptions(turn, request, 'claude-opus-5-5', 'max', true);
    expect(options.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(options.effort).toBe('max');
    expect(options.model).toBe('claude-opus-5-5');
  });

  it('is neither for a model that does not, or that nobody listed', () => {
    const options = claudeOptions(turn, request, 'claude-haiku-4-5-20251001', 'high', false);
    expect(options.thinking).toBeUndefined();
    expect(options.effort).toBeUndefined();
    expect(claudeOptions(turn, request, 'claude-x', 'high').thinking).toBeUndefined();
  });

  it('leaves the model to the SDK when none is asked', () => {
    expect('model' in claudeOptions(turn, request, undefined, 'high', true)).toBe(false);
  });
});
