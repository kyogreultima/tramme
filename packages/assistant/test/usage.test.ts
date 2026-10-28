import { describe, expect, it } from 'vitest';
import { addUsage, NO_USAGE, UsageMeter } from '../src/index.ts';

describe('usage', () => {
  it('UsageMeter reads the 1-hour cache writes', () => {
    const meter = new UsageMeter();
    meter.event({
      type: 'message_start',
      message: { usage: { input_tokens: 10, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 }, output_tokens: 1 } },
    });
    expect(meter.usage).toEqual({ requests: 1, input: 10, cacheRead: 0, cacheWrite: 300, cacheWrite1h: 200, output: 1 });
  });

  it('a request that says nothing about lifetimes has no 1-hour writes', () => {
    const meter = new UsageMeter();
    meter.event({ type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 300, output_tokens: 1 } } });
    expect(meter.usage.cacheWrite).toBe(300);
    expect(meter.usage.cacheWrite1h).toBe(0);
  });

  it('addUsage sums cacheWrite1h', () => {
    const a = { ...NO_USAGE, cacheWrite: 5, cacheWrite1h: 2 };
    const b = { ...NO_USAGE, cacheWrite: 7, cacheWrite1h: 3 };
    expect(addUsage(a, b)).toMatchObject({ cacheWrite: 12, cacheWrite1h: 5 });
    expect(NO_USAGE.cacheWrite1h).toBe(0);
  });
});
