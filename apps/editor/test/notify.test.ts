// The notification's branches: native and away, attention asked for a
// question, and the toast in front of the window. The Tauri global is
// stubbed before the module loads (it reads it once), document.hasFocus
// decides the branch per call. The module is imported once: it pulls the
// editor's whole vocabulary (through state.ts), too long to load per test.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async () => undefined);
const requestUserAttention = vi.fn(async () => undefined);
let focusHandlers: (() => void)[] = [];
let focused = false;

function stub(hasFocus: boolean) {
  focusHandlers = [];
  focused = hasFocus;
}

let m: typeof import('../src/notify.ts');
beforeAll(async () => {
  vi.stubGlobal('window', {
    __TAURI__: { core: { invoke }, window: { getCurrentWindow: () => ({ requestUserAttention }) } },
    addEventListener: (_name: string, fn: () => void) => { focusHandlers.push(fn); },
    removeEventListener: (_name: string, fn: () => void) => { focusHandlers = focusHandlers.filter((h) => h !== fn); },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  vi.stubGlobal('document', { hidden: false, hasFocus: () => focused, documentElement: { dataset: {} }, querySelector: () => null });
  vi.stubGlobal('addEventListener', () => {});
  m = await import('../src/notify.ts');
}, 60_000);

beforeEach(() => {
  invoke.mockClear();
  requestUserAttention.mockClear();
});

describe('notify', () => {
  it('sends a native notification away from the window', async () => {
    stub(false);
    m.notify('T', 'B');
    expect(invoke).toHaveBeenCalledWith('plugin:notification|notify', { options: { title: 'T', body: 'B' } });
  });

  it('asks for attention when a question waits', async () => {
    stub(false);
    m.notify('T', 'B', 'info', { attention: true });
    expect(requestUserAttention).toHaveBeenCalledWith(2);
  });

  it('cancels the attention on the window\'s next focus', async () => {
    stub(false);
    m.attend();
    for (const fn of focusHandlers) fn();
    expect(requestUserAttention).toHaveBeenCalledWith(null);
  });

  it('cancels the attention when the question goes before the window is focused', async () => {
    stub(false);
    const stop = m.attend();
    stop();
    expect(requestUserAttention).toHaveBeenCalledWith(null);
  });

  it('stays a toast in front of the window', async () => {
    stub(true);
    m.notify('T', 'B');
    expect(invoke).not.toHaveBeenCalled();
    expect(requestUserAttention).not.toHaveBeenCalled();
  });
});
