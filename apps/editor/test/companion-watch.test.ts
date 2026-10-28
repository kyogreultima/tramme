// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { aiStatus, watchCompanion } = await import('../src/ai/index.ts');

// the companion's /health, answering or not as the test decides
let healthy = false;
let hang = false;
const health = vi.fn(async (url: string): Promise<Response> => {
  if (!url.endsWith('/health')) return new Response('{}', { status: 404 });
  if (hang) return new Promise<Response>(() => {});
  if (!healthy) throw new Error('refused');
  return new Response(JSON.stringify({ engines: { claude: true } }), { status: 200 });
});

beforeEach(() => {
  vi.useFakeTimers();
  healthy = false; hang = false; health.mockClear();
  vi.stubGlobal('fetch', health);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const healthCalls = () => health.mock.calls.filter(([u]) => String(u).endsWith('/health')).length;

async function start() {
  aiStatus.value = { ...aiStatus.value, server: true, companion: 'absent' };
  return { aiStatus, stop: watchCompanion() };
}

describe('watchCompanion', () => {
  it('finds a companion started after the app, even when another route works', async () => {
    const { aiStatus, stop } = await start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(aiStatus.value.companion).not.toBe('ok');
    healthy = true;
    await vi.advanceTimersByTimeAsync(4000);
    expect(aiStatus.value.companion).toBe('ok');
    stop();
  });

  it('notices a companion that stops', async () => {
    healthy = true;
    const { aiStatus, stop } = await start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(aiStatus.value.companion).toBe('ok');
    healthy = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(aiStatus.value.companion).not.toBe('ok');
    stop();
  });

  it('never looks twice at once', async () => {
    hang = true;
    const { stop } = await start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(healthCalls()).toBe(1);
    stop();
  });

  it('looks again when the window regains focus', async () => {
    const { stop } = await start();
    await vi.advanceTimersByTimeAsync(1000);
    const before = healthCalls();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(10);
    expect(healthCalls()).toBe(before + 1);
    stop();
  });
});

describe('the model chosen', () => {
  it('stays chosen when the companion misses one look after it answered', async () => {
    const { aiModels, aiSettings, setAiSettings } = await import('../src/ai/index.ts');
    setAiSettings({ model: 'claude-opus-5-5', prefer: 'auto' });
    // another AI connected (OpenAI), with its models listed: what the assistant would turn to
    aiModels.value = { ...aiModels.value, remote: { openai: [{ id: 'gpt-5', label: 'gpt-5' }] } };
    aiStatus.value = { ...aiStatus.value, server: false, remote: { openai: true }, companion: 'absent' };
    healthy = true;
    const stop = watchCompanion();
    await vi.advanceTimersByTimeAsync(4000);
    expect(aiStatus.value.companion).toBe('ok');
    // busy for a moment (a transcription, a turn): one look fails
    healthy = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(aiStatus.value.companion).not.toBe('ok');
    expect(aiSettings.value.model).toBe('claude-opus-5-5');
    stop();
  });
});
