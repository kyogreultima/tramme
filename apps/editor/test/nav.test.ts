// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { go, LEAVE_WAIT } from '../src/nav.ts';

describe('going to another page behind the cover', () => {
  let assign: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="boot" class="done"></div>';
    assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as unknown as Location);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const cover = () => document.getElementById('boot')!;

  it('closes the cover, then leaves', () => {
    go('/space');
    expect(cover().classList.contains('done')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(assign).toHaveBeenCalledWith('/space');
  });

  it('shows the page again when it did not go (its leaving refused, a failed load)', () => {
    go('/space');
    vi.advanceTimersByTime(200 + LEAVE_WAIT);
    expect(cover().classList.contains('done')).toBe(true);
  });

  it('leaves the cover closed over a page that is going', () => {
    go('/space');
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(LEAVE_WAIT);
    expect(cover().classList.contains('done')).toBe(false);
  });
});
