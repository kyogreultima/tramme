// The notification's branches: native and away, attention asked for a
// question, and the toast in front of the window. The Tauri global is
// stubbed before the module loads (it reads it once), document.hasFocus
// decides the branch per call.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async () => undefined);
const requestUserAttention = vi.fn(async () => undefined);
let focusHandlers: (() => void)[] = [];

function stub(hasFocus: boolean) {
  focusHandlers = [];
  vi.stubGlobal('window', {
    __TAURI__: { core: { invoke }, window: { getCurrentWindow: () => ({ requestUserAttention }) } },
    addEventListener: (_name: string, fn: () => void) => { focusHandlers.push(fn); },
    removeEventListener: (_name: string, fn: () => void) => { focusHandlers = focusHandlers.filter((h) => h !== fn); },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  vi.stubGlobal('document', { hidden: false, hasFocus: () => hasFocus, documentElement: { dataset: {} }, querySelector: () => null });
  vi.stubGlobal('addEventListener', () => {});
}

beforeEach(() => {
  vi.resetModules();
  invoke.mockClear();
  requestUserAttention.mockClear();
});

describe('notify', () => {
  it('sends a native notification away from the window', async () => {
    stub(false);
    const m = await import('../src/notify.ts');
    m.notify('T', 'B');
    expect(invoke).toHaveBeenCalledWith('plugin:notification|notify', { options: { title: 'T', body: 'B' } });
  });

  it('asks for attention when a question waits', async () => {
    stub(false);
    const m = await import('../src/notify.ts');
    m.notify('T', 'B', 'info', { attention: true });
    expect(requestUserAttention).toHaveBeenCalledWith(2);
  });

  it('cancels the attention on the window\'s next focus', async () => {
    stub(false);
    const m = await import('../src/notify.ts');
    m.attend();
    for (const fn of focusHandlers) fn();
    expect(requestUserAttention).toHaveBeenCalledWith(null);
  });

  it('cancels the attention when the question goes before the window is focused', async () => {
    stub(false);
    const m = await import('../src/notify.ts');
    const stop = m.attend();
    stop();
    expect(requestUserAttention).toHaveBeenCalledWith(null);
  });

  it('stays a toast in front of the window', async () => {
    stub(true);
    const m = await import('../src/notify.ts');
    m.notify('T', 'B');
    expect(invoke).not.toHaveBeenCalled();
    expect(requestUserAttention).not.toHaveBeenCalled();
  });
});
