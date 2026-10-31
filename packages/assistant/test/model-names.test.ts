import { describe, expect, it } from 'vitest';
import { modelLabel, readableModel, setModelLabels } from '../src/index.ts';

describe('the names of the models that are not Claude\'s', () => {
  it('writes a key out: the words capitalised, the version kept, GPT and GLM in capitals', () => {
    expect(readableModel('gpt-5')).toBe('GPT-5');
    expect(readableModel('gpt-5.1-codex-max')).toBe('GPT-5.1 Codex Max');
    expect(readableModel('gpt-4o')).toBe('GPT-4o');
    expect(readableModel('o3-mini')).toBe('o3 Mini');
    expect(readableModel('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
    expect(readableModel('models/gemini-3-flash')).toBe('Gemini 3 Flash');
    expect(readableModel('glm-4-plus')).toBe('GLM-4 Plus');
    expect(readableModel('deepseek-chat')).toBe('Deepseek Chat');
    expect(readableModel('anthropic/claude-sonnet-4')).toBe('Claude Sonnet 4');
  });

  it('leaves a name that already has capitals as it is', () => {
    expect(readableModel('GPT-6-Astra')).toBe('GPT-6-Astra');
  });

  it('shows the name a listing gave, else the key written out; a local tag stays as it is', () => {
    expect(modelLabel('codex:gpt-6-astra')).toBe('GPT-6 Astra');
    setModelLabels([['codex:gpt-6-astra', 'GPT-6-Astra'], ['codex:gpt-6-sol', 'gpt-6-sol']]);
    expect(modelLabel('codex:gpt-6-astra')).toBe('GPT-6-Astra');
    // a name that is only the key says nothing: the key is written out
    expect(modelLabel('codex:gpt-6-sol')).toBe('GPT-6 Sol');
    expect(modelLabel('antigravity:gemini-3.1-pro-low')).toBe('Gemini 3.1 Pro Low');
    expect(modelLabel('local:qwen3:8b')).toBe('qwen3:8b');
  });
});
