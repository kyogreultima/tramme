// @vitest-environment happy-dom
// The quick bubble's panel with a project open: its play, loop and history
// buttons, what they ask of the main window (and that they do not bring it to
// the front), and what the main window does when asked (quick-link.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';
import type { Manifest } from '../src/api.ts';
import type { QuickState } from '../src/quick-link.ts';

type Handler = (e: { payload: unknown }) => void;
const listeners = new Map<string, Handler[]>();
const emitted: [string, unknown][] = [];
const invoked: [string, unknown][] = [];

// the desktop app's global, as the native window injects it
(globalThis as unknown as { __TAURI__: unknown }).__TAURI__ = {
  core: { invoke: async (cmd: string, args?: unknown) => { invoked.push([cmd, args]); return []; }, Channel: class {} },
  event: {
    listen: async (name: string, handler: Handler) => { listeners.set(name, [...(listeners.get(name) ?? []), handler]); return () => {}; },
    emit: async (name: string, payload?: unknown) => { emitted.push([name, payload]); },
  },
  window: { getCurrentWindow: () => ({ startDragging: async () => {} }) },
};

const { Quick } = await import('../src/ui/Quick.tsx');
const { startQuickLink } = await import('../src/quick-link.ts');
const { S, canUndo, canRedo } = await import('../src/state.ts');
const { setPrefs, DEFAULT_PREFERENCES } = await import('../src/settings.ts');

const say = (name: string, payload: unknown) => (listeners.get(name) ?? []).forEach((h) => h({ payload }));
const state = (over: Partial<QuickState> = {}): QuickState => ({
  project: { id: 'film-1', name: 'My film' }, playing: false, time: 0, at: Date.now(), duration: 10, loop: false, canUndo: false, canRedo: false, lastExport: null, ...over,
});

let host: HTMLElement;
const was = { doc: S.doc.peek(), project: S.project.peek(), playing: S.playing.peek(), loop: S.loop.peek(), time: S.time.peek() };

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  emitted.length = 0; invoked.length = 0;
});
afterEach(() => {
  render(null, host); host.remove(); vi.restoreAllMocks();
  S.doc.value = was.doc; S.project.value = was.project; S.playing.value = was.playing; S.loop.value = was.loop; S.time.value = was.time;
  history.replaceState({}, '', '/');
});

/** the bubble, opened into its panel with this said of the project */
async function panel(s: QuickState) {
  await act(() => { render(h(Quick, {}), host); });
  await act(() => { say('quick-state', s); });
  await act(() => { (host.querySelector('.quick-bubble') as HTMLElement).click(); });
}
const button = (label: string) => host.querySelector(`.quick-transport [aria-label="${label}"]`) as HTMLButtonElement;

describe('the panel of a project', () => {
  it('has play, back to the start, the loop and the history, in order', async () => {
    await panel(state());
    const labels = [...host.querySelectorAll('.quick-transport button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Back to the start', 'Play', 'Loop', 'Undo', 'Redo']);
  });

  it('says Pause while the film plays, and Play while it does not', async () => {
    await panel(state({ playing: true }));
    expect(button('Pause')).not.toBeNull();
    expect(button('Play')).toBeNull();
    await act(() => { say('quick-state', state({ playing: false })); });
    expect(button('Play')).not.toBeNull();
  });

  it('shows the loop as pressed when it is on', async () => {
    await panel(state({ loop: true }));
    expect(button('Loop').getAttribute('aria-pressed')).toBe('true');
    expect(button('Loop').className).toContain('on');
  });

  it('turns undo and redo on only when the history has something', async () => {
    await panel(state());
    expect([button('Undo').disabled, button('Redo').disabled]).toEqual([true, true]);
    await act(() => { say('quick-state', state({ canUndo: true })); });
    expect([button('Undo').disabled, button('Redo').disabled]).toEqual([false, true]);
    await act(() => { say('quick-state', state({ canUndo: true, canRedo: true })); });
    expect([button('Undo').disabled, button('Redo').disabled]).toEqual([false, false]);
  });

  it('asks the main window for each control without bringing it to the front, and stays open', async () => {
    await panel(state({ canUndo: true, canRedo: true }));
    emitted.length = 0; invoked.length = 0;
    for (const label of ['Back to the start', 'Play', 'Loop', 'Undo', 'Redo']) await act(() => { button(label).click(); });
    expect(emitted.filter(([name]) => name === 'quick-action').map(([, a]) => (a as { kind: string }).kind))
      .toEqual(['to-start', 'play-pause', 'loop', 'undo', 'redo']);
    // desktop_quick_do brings Tramme forward: none of these goes through it, and the panel is not folded
    expect(invoked.filter(([cmd]) => cmd === 'desktop_quick_do')).toEqual([]);
    expect(invoked.filter(([cmd, a]) => cmd === 'desktop_quick_open' && (a as { open: boolean }).open === false)).toEqual([]);
    expect(host.querySelector('.quick-panel')).not.toBeNull();
  });

  it('opens the export panel of Tramme through the app, which brings it forward, and folds', async () => {
    await panel(state());
    invoked.length = 0;
    const row = [...host.querySelectorAll('.quick-row')].find((r) => r.textContent?.includes('Export the film')) as HTMLElement;
    await act(() => { row.click(); });
    expect(invoked.find(([cmd]) => cmd === 'desktop_quick_do')?.[1]).toEqual({ action: { kind: 'export' } });
  });
});

describe('what the main window does when the bubble asks', () => {
  let linked = false;
  /** a project open on its own page, with the bubble's link started */
  async function open() {
    history.replaceState({}, '', '/p/film-1');
    S.project.value = { id: 'film-1', name: 'My film' } as Manifest;
    S.doc.value = newProject({ name: 'My film', width: 1920, height: 1080, fps: 30, duration: 10 }).doc;
    setPrefs({ ...DEFAULT_PREFERENCES, quickLauncher: true });
    // started once: each start adds its listeners
    if (!linked) { linked = true; startQuickLink(); }
  }
  const ask = async (kind: string) => { say('quick-action', { kind }); await new Promise((r) => setTimeout(r, 0)); };

  it('plays and pauses the film, and sets the loop and the time', async () => {
    await open();
    S.playing.value = false; S.loop.value = false; S.time.value = 4;
    await ask('play-pause');
    expect(S.playing.peek()).toBe(true);
    await ask('play-pause');
    expect(S.playing.peek()).toBe(false);
    await ask('loop');
    expect(S.loop.peek()).toBe(true);
    await ask('to-start');
    expect(S.time.peek()).toBe(0);
  });

  it('tells the bubble whether there is anything to undo or redo', async () => {
    await open();
    emitted.length = 0;
    // a change the bubble draws (the loop) is told with the rest of what it shows
    S.loop.value = !S.loop.peek();
    await new Promise((r) => setTimeout(r, 0));
    const told = emitted.filter(([name]) => name === 'quick-state').at(-1)?.[1] as QuickState;
    expect(told.project?.id).toBe('film-1');
    expect(told.canUndo).toBe(canUndo.peek());
    expect(told.canRedo).toBe(canRedo.peek());
  });

  it('does nothing to a project when none is open', async () => {
    history.replaceState({}, '', '/');
    S.playing.value = false;
    setPrefs({ ...DEFAULT_PREFERENCES, quickLauncher: true });
    await ask('play-pause');
    expect(S.playing.peek()).toBe(false);
  });
});
