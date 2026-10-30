import { afterEach, describe, expect, it } from 'vitest';
import { claudeModel, claudeModels, defaultClaudeModel, effortLevels, effortFor, isAdaptive, modelLabel, parseApiModels, parseSdkModels, setClaudeModels } from '../src/index.ts';

// what the Agent SDK's supportedModels() answered on a computer signed in to Claude Code
const ALL = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const SDK_ROWS = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportedEffortLevels: [...ALL], supportsAdaptiveThinking: true },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportedEffortLevels: [...ALL], supportsAdaptiveThinking: true },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', supportedEffortLevels: [...ALL], supportsAdaptiveThinking: true },
  { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1', supportedEffortLevels: [...ALL], supportsAdaptiveThinking: true },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
  { value: 'claude-opus-4-6', resolvedModel: 'claude-opus-4-6', displayName: 'Opus 4.6', supportedEffortLevels: ['low', 'medium', 'high', 'max'], supportsAdaptiveThinking: true },
  { value: 'claude-opus-5-5', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportedEffortLevels: [...ALL], supportsAdaptiveThinking: true },
];

const supported = (on = true) => ({ supported: on });
const apiModel = (id: string, name: string, extra: Record<string, unknown> = {}, caps: Record<string, unknown> = {}) => ({
  type: 'model', id, display_name: name, lifecycle: 'active', line: null, created_at: '2026-09-21T00:00:00Z',
  capabilities: { effort: { supported: true, low: supported(), medium: supported(), high: supported(), max: supported(), xhigh: supported() }, thinking: { supported: true, types: { adaptive: supported() } }, ...caps },
  ...extra,
});

afterEach(() => setClaudeModels([]));

describe("the Claude models the Agent SDK lists for a Claude Code login", () => {
  const models = parseSdkModels(SDK_ROWS);

  it('are one per model, by the id each row resolves to, in the order the SDK gives them', () => {
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001', 'claude-opus-4-6']);
  });

  it('carry the name, the effort levels and the adaptive thinking each says it has, none when it says nothing', () => {
    expect(models[0]).toMatchObject({ label: 'Opus 5.5', adaptive: true, efforts: ALL });
    expect(models.find((m) => m.id === 'claude-opus-4-6')?.efforts).toEqual(['low', 'medium', 'high', 'max']);
    expect(models.find((m) => m.id === 'claude-haiku-4-5-20251001')).toMatchObject({ label: 'Haiku 4.5', adaptive: false, efforts: [] });
  });

  it('mark the one the SDK recommends, the default row', () => {
    expect(models.filter((m) => m.recommended).map((m) => m.id)).toEqual(['claude-opus-5-5']);
  });

  it('are none from an answer that is not a list of models', () => {
    expect(parseSdkModels(undefined as never)).toEqual([]);
    expect(parseSdkModels([{ nothing: true }] as never)).toEqual([]);
  });
});

describe("the Claude models the Anthropic API lists for a key", () => {
  const body = { data: [
    apiModel('claude-opus-5-5', 'Claude Opus 5.5', { line: 'opus' }),
    apiModel('claude-sonnet-5-5', 'Claude Sonnet 5.5', { line: 'sonnet' }),
    apiModel('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', { line: 'haiku' }, { effort: { supported: false }, thinking: { supported: true, types: { adaptive: supported(false) } } }),
    apiModel('claude-opus-4-1', 'Claude Opus 4.1', { line: 'opus', lifecycle: 'deprecated' }),
    apiModel('claude-3-haiku', 'Claude Haiku 3', { lifecycle: 'retired' }),
  ], has_more: false };

  it('are the active ones, newest first as the API gives them, named without the "Claude" the menu already says', () => {
    expect(parseApiModels(body).map((m) => [m.id, m.label])).toEqual([['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-4-5-20251001', 'Haiku 4.5']]);
  });

  it('carry the effort levels and the adaptive thinking of their capabilities, and their line', () => {
    const [opus, , haiku] = parseApiModels(body);
    expect(opus).toMatchObject({ adaptive: true, efforts: ALL, line: 'opus' });
    expect(haiku).toMatchObject({ adaptive: false, efforts: [], line: 'haiku' });
  });

  it('take a model that comes without capabilities as one that says nothing', () => {
    const [m] = parseApiModels({ data: [{ id: 'claude-new', display_name: 'Claude New', lifecycle: 'active', capabilities: null }] });
    expect(m).toMatchObject({ id: 'claude-new', label: 'New', adaptive: false, efforts: [] });
  });

  it('are none from an answer that is not a list of models', () => {
    expect(parseApiModels(null)).toEqual([]);
    expect(parseApiModels({ error: { message: 'nope' } })).toEqual([]);
    expect(parseApiModels({ data: [{ display_name: 'no id' }] })).toEqual([]);
  });
});

describe('the Claude model taken when none was chosen', () => {
  it('is the one the SDK recommends', () => {
    expect(defaultClaudeModel(parseSdkModels(SDK_ROWS))).toBe('claude-opus-5-5');
  });

  it('is, without a recommendation, the newest of the Opus line, then the first of the list', () => {
    const list = parseApiModels({ data: [apiModel('claude-sonnet-5-5', 'Claude Sonnet 5.5', { line: 'sonnet' }), apiModel('claude-opus-5-5', 'Claude Opus 5.5', { line: 'opus' }), apiModel('claude-opus-4-6', 'Claude Opus 4.6', { line: 'opus' })] });
    expect(defaultClaudeModel(list)).toBe('claude-opus-5-5');
    expect(defaultClaudeModel(list.filter((m) => m.line !== 'opus'))).toBe('claude-sonnet-5-5');
  });

  it('is nothing from an empty list, and the registry\'s when none is given', () => {
    expect(defaultClaudeModel([])).toBeUndefined();
    setClaudeModels(parseSdkModels(SDK_ROWS));
    expect(defaultClaudeModel()).toBe('claude-opus-5-5');
  });
});

describe('what the registry of Claude models tells the rest of the assistant', () => {
  it('is nothing at first: no model is known, no effort, no adaptive thinking, the id as the name', () => {
    expect(claudeModels()).toEqual([]);
    expect(claudeModel('claude-opus-5-5')).toBeUndefined();
    expect(effortLevels('claude-opus-5-5')).toEqual([]);
    expect(isAdaptive('claude-opus-5-5')).toBe(false);
    expect(modelLabel('claude-opus-5-5')).toBe('claude-opus-5-5');
  });

  it('is what the last listing set: the name, the effort levels, the adaptive thinking', () => {
    setClaudeModels(parseSdkModels(SDK_ROWS));
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1');
    expect(effortLevels('claude-fable-5-1')).toEqual(ALL);
    expect(effortLevels('claude-opus-4-6')).toEqual(['low', 'medium', 'high', 'max']);
    expect(effortLevels('claude-haiku-4-5-20251001')).toEqual([]);
    expect(isAdaptive('claude-sonnet-5-5')).toBe(true);
    expect(isAdaptive('claude-haiku-4-5-20251001')).toBe(false);
  });

  it('gives a Claude model the high level by default when it has levels, and nothing when it has none', () => {
    setClaudeModels(parseSdkModels(SDK_ROWS));
    expect(effortFor('claude-opus-5-5', {})).toBe('high');
    expect(effortFor('claude-opus-5-5', { 'claude-opus-5-5': 'max' })).toBe('max');
    expect(effortFor('claude-haiku-4-5-20251001', { 'claude-haiku-4-5-20251001': 'high' })).toBeUndefined();
  });

  it('does not touch the other providers', () => {
    expect(effortLevels('openai:gpt-5')).toEqual(['low', 'medium', 'high']);
    expect(modelLabel('openai:gpt-5')).toBe('gpt-5');
  });
});
