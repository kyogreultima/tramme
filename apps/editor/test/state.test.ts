// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S, toast } from '../src/state.ts';

describe('toasts', () => {
  beforeEach(() => { vi.useFakeTimers(); S.toasts.value = []; });
  afterEach(() => { vi.useRealTimers(); S.toasts.value = []; });

  it('coalesces an identical active notification and keeps the newest lifetime', () => {
    toast('sandbox failed', 'error', 1000);
    vi.advanceTimersByTime(500);
    toast('sandbox failed', 'error', 1000);
    expect(S.toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(501);
    expect(S.toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(S.toasts.value).toHaveLength(0);
  });

  it('keeps notifications with a different kind or text separate', () => {
    toast('same', 'info');
    toast('same', 'error');
    toast('another', 'info');
    expect(S.toasts.value).toHaveLength(3);
  });
});
