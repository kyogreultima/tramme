// The quick bubble's two ends, the main window's one: what the bubble needs to
// know (which project is open, whether it plays and where, the last export) is
// told to it as events; what it asks (a film to describe, a project, files
// dropped on it, a request for the assistant) comes back and is carried out
// here, on the open page. The bubble is another window (ui/Quick.tsx) and
// touches none of the editor's state.

import { effect } from '@preact/signals';
import { canRedo, canUndo, comp, redo, S, setTime, undo } from './state.ts';
import { exportQueue, queueVersion } from './export-queue.ts';
import { go } from './nav.ts';
import { prefs } from './settings.ts';
import { saveBlob } from './download.ts';
import { tauri } from './tauri.ts';

/** what the bubble is told: the open project (none on the home screen), the playback it can draw, the last finished export */
export interface QuickState {
  project: { id: string; name: string } | null;
  playing: boolean;
  /** where the playhead was, in seconds, when this was said (`at`, ms since the epoch) */
  time: number;
  at: number;
  duration: number;
  loop: boolean;
  /** whether the history has something to undo, to redo */
  canUndo: boolean;
  canRedo: boolean;
  lastExport: string | null;
}

/** what the bubble asks of the main window */
export type QuickAction =
  | { kind: 'brief'; text: string }
  | { kind: 'open'; id: string }
  | { kind: 'home' }
  | { kind: 'drop' }
  | { kind: 'save-export' }
  | { kind: 'ask'; text: string }
  // the open project's own controls: play or pause, back to the start, the loop, the history
  | { kind: 'play-pause' }
  | { kind: 'to-start' }
  | { kind: 'loop' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  // Tramme in front, its export panel open
  | { kind: 'export' };

const lastExport = () => [...exportQueue.jobs].reverse().find((j) => j.status === 'done' && j.result);

function state(): QuickState {
  const open = /^\/p\//.test(location.pathname) && !!S.project.peek()?.id && !!S.doc.peek();
  return {
    project: open ? { id: S.project.peek().id, name: S.project.peek().name } : null,
    playing: open && S.playing.peek(),
    time: S.time.peek(),
    at: Date.now(),
    duration: open ? comp.peek().duration : 0,
    loop: S.loop.peek(),
    canUndo: open && canUndo.peek(),
    canRedo: open && canRedo.peek(),
    lastExport: open ? lastExport()?.result?.name ?? null : null,
  };
}

const tell = () => { void tauri?.event.emit('quick-state', state()); };

/** The bubble kept informed while it is switched on; the answers to what it asks. */
export function startQuickLink(): void {
  const app = tauri;
  if (!app) return;
  // told at each change that matters to it, and again every second while playing (a seek, a loop, a drift)
  effect(() => {
    if (!prefs.value.quickLauncher) return;
    void [S.project.value, S.doc.value, S.compId.value, S.playing.value, S.loop.value, canUndo.value, canRedo.value, queueVersion.value];
    tell();
    if (S.playing.peek()) { const timer = setInterval(tell, 1000); return () => clearInterval(timer); }
  });
  // a bubble that just appeared asks where things stand
  void app.event.listen('quick-ready', tell);
  void app.event.listen('quick-action', (e) => { void answer(e.payload as QuickAction); });
}

async function answer(a: QuickAction): Promise<void> {
  if (a?.kind === 'brief' && typeof a.text === 'string' && a.text.trim()) location.assign(`/?prompt=${encodeURIComponent(a.text.trim().slice(0, 2000))}`);
  else if (a?.kind === 'open' && typeof a.id === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(a.id)) go(`/p/${a.id}`);
  else if (a?.kind === 'home') go('/');
  else if (a?.kind === 'drop') await take();
  else if (a?.kind === 'save-export') { const j = lastExport(); if (j?.result) await saveBlob(j.result.blob, j.result.name); }
  else if (a?.kind === 'ask' && typeof a.text === 'string' && state().project) { const { send } = await import('./ai/conversation.ts'); await send(a.text.slice(0, 2000)); }
  else if (state().project) control(a);
}

/** the open project's controls, as its own buttons and keys do them */
function control(a: QuickAction): void {
  if (a?.kind === 'play-pause') S.playing.value = !S.playing.peek();
  else if (a?.kind === 'to-start') setTime(0);
  else if (a?.kind === 'loop') S.loop.value = !S.loop.peek();
  else if (a?.kind === 'undo') undo();
  else if (a?.kind === 'redo') redo();
  // the export button of the top bar opens the panel with the film's options: they are chosen in Tramme
  else if (a?.kind === 'export') document.querySelector<HTMLElement>('[data-tour="export"]')?.click();
}

/** the files dropped on the bubble go into the open project, as files dropped on its assets would; the bubble is told how many */
async function take(): Promise<void> {
  const app = tauri!;
  let added = 0;
  try {
    if (state().project) {
      const names = (await app.core.invoke('desktop_quick_drop_names')) as string[];
      const files: File[] = [];
      for (let i = 0; i < names.length; i++) {
        const raw = (await app.core.invoke('desktop_quick_drop_file', { index: i })) as ArrayBuffer | number[];
        const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw ?? []);
        if (data.length) files.push(new File([data], names[i]));
      }
      if (files.length) {
        const { importFiles } = await import('./ui/LeftPanel.tsx');
        await importFiles(files);
        added = files.length;
      }
    }
  } catch (e) { console.warn('[tramme] quick drop:', (e as Error).message); }
  void app.event.emit('quick-done', { added });
}
