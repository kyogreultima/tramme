// The quick bubble (desktop app, switched on in the settings): its own small
// window, always over the other apps while Tramme is behind them. Closed it is a
// round button that can be moved, and that draws the playback of the open film
// as a ring filling around it. Open it suggests where to go next. With no
// project open: say what film to make, one of the usual films to start from, a
// recent project. With one open: its play, loop and history controls, files
// dropped here join its assets, a few requests for the assistant, the export
// panel and the last export. What is picked goes to the main
// window (quick-link.ts answers it); this window only asks.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Manifest } from '@tramme/project';
import { api } from '../api.ts';
import { IDEAS } from '../ideas.ts';
import { t } from '../i18n/index.ts';
import { PREFERENCES_KEY } from '../theme/pref.ts';
import { reloadPrefs } from '../settings.ts';
import { tauri } from '../tauri.ts';
import type { QuickAction, QuickState } from '../quick-link.ts';
import { Icon } from './icons.tsx';
import { LogoMark } from './Logo.tsx';

const RECENT = 3;
/** what the bubble asks without bringing Tramme to the front */
const STAY_BEHIND: ReadonlySet<QuickAction['kind']> = new Set(['save-export', 'play-pause', 'to-start', 'loop', 'undo', 'redo']);
/** how far the pointer goes before a press on the bubble is a move, not a click (px) */
const MOVE = 4;

/** where the playback is, 0 to 1, from what the main window last said */
export function progressOf(s: QuickState, now = Date.now()): number {
  if (!s.playing || s.duration <= 0) return 0;
  const t = s.time + (now - s.at) / 1000;
  return s.loop ? (t % s.duration) / s.duration : Math.min(1, t / s.duration);
}

export function Quick() {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState('');
  const [recent, setRecent] = useState<Manifest[]>([]);
  const [link, setLink] = useState<QuickState | null>(null);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');
  const woke = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const linkRef = useRef<QuickState | null>(null);
  linkRef.current = link;

  const show = (next: boolean) => {
    setOpen(next);
    tauri?.core.invoke('desktop_quick_open', { open: next }).catch(() => {});
  };
  // what needs Tramme in front goes through the app (it brings the window forward); saving the last export and the
  // project's own controls do not: the film plays on behind the bubble
  const ask = (action: QuickAction, fold = true) => {
    if (STAY_BEHIND.has(action.kind)) void tauri?.event.emit('quick-action', action);
    else tauri?.core.invoke('desktop_quick_do', { action }).catch(() => {});
    setWords('');
    if (fold) show(false);
  };

  // what the main window says, and the foldings and drops the app reports
  useEffect(() => {
    const app = tauri;
    if (!app) return;
    const off: Promise<() => void>[] = [
      app.event.listen('quick-state', (e) => setLink(e.payload as QuickState)),
      app.event.listen('quick-fold', () => { setOpen(false); setOver(false); woke.current = false; }),
      app.event.listen('quick-drag', (e) => {
        const kind = e.payload as string;
        const project = !!linkRef.current?.project;
        if (kind === 'enter' && project) { setOver(true); setNote(''); if (!woke.current) { woke.current = true; show(true); } }
        else if (kind === 'leave') { setOver(false); if (woke.current) { woke.current = false; show(false); } }
        else if (kind === 'drop') { setOver(false); if (project) setNote(t('quick.adding')); }
      }),
      app.event.listen('quick-done', (e) => {
        const added = (e.payload as { added: number }).added;
        setNote(added ? t('quick.added', { n: added }) : t('quick.nothingAdded'));
        setTimeout(() => { setNote(''); if (woke.current) { woke.current = false; show(false); } }, 2200);
      }),
    ];
    void app.event.emit('quick-ready');
    return () => { off.forEach((p) => void p.then((f) => f())); };
  }, []);

  // the theme and the other settings are the main window's: read again when it saves, and on each look at the bubble
  useEffect(() => {
    const again = () => reloadPrefs();
    const storage = (e: StorageEvent) => { if (e.key === PREFERENCES_KEY) again(); };
    addEventListener('storage', storage);
    addEventListener('focus', again);
    addEventListener('pointerenter', again);
    return () => { removeEventListener('storage', storage); removeEventListener('focus', again); removeEventListener('pointerenter', again); };
  }, []);

  // the ring: filled by the playback, drawn from what was last said, again and again while it plays (a loop starts it over)
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const circle = ring.current, s = linkRef.current;
      if (circle) circle.style.strokeDashoffset = String(1 - (s ? progressOf(s) : 0));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!link?.project) api.list().then((all) => setRecent([...all].sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, RECENT))).catch(() => setRecent([]));
    field.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') show(false); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [open, !!link?.project]);

  const playing = !!link?.playing;
  const ringEl = (
    <svg class={`quick-ring${playing ? ' on' : ''}`} viewBox="0 0 56 56" aria-hidden="true">
      <circle class="quick-track" cx="28" cy="28" r="26" />
      <circle ref={ring} class="quick-fill" cx="28" cy="28" r="26" pathLength={1} stroke-dasharray="1" stroke-dashoffset="1" />
    </svg>
  );

  if (!open) {
    // a press that moves is the window's drag; one that stays is a click
    const press = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const x = e.clientX, y = e.clientY;
      const move = (m: PointerEvent) => {
        if (Math.hypot(m.clientX - x, m.clientY - y) < MOVE) return;
        stop();
        void tauri?.window.getCurrentWindow().startDragging();
      };
      const stop = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', stop); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', stop);
    };
    return (
      <button class="quick-bubble" title={t('quick.open')} aria-label={t('quick.open')} onPointerDown={press} onClick={() => show(true)}>
        {ringEl}<LogoMark size={24} />
      </button>
    );
  }

  const project = link?.project ?? null;
  const send = (e: Event) => { e.preventDefault(); if (words.trim()) ask({ kind: 'brief', text: words.trim() }); };
  return (
    <div class={`quick-panel${over ? ' over' : ''}`}>
      <header class="quick-head" data-tauri-drag-region>
        <span class="quick-mark">{ringEl}<LogoMark size={16} /></span>
        <span class="quick-title">{project ? project.name : 'Tramme'}</span>
        <span class="grow" />
        <button class="icon-btn xs" title={t('quick.close')} onClick={() => show(false)}><Icon name="x" /></button>
      </header>
      {project ? (
        <>
          <div class="quick-transport">
            <button class="icon-btn" title={t('quick.toStart')} aria-label={t('quick.toStart')} onClick={() => ask({ kind: 'to-start' }, false)}><Icon name="start" /></button>
            <button class="icon-btn primary" title={playing ? t('quick.pause') : t('quick.play')} aria-label={playing ? t('quick.pause') : t('quick.play')} onClick={() => ask({ kind: 'play-pause' }, false)}><Icon name={playing ? 'pause' : 'play'} /></button>
            <button class={`icon-btn${link?.loop ? ' on' : ''}`} title={t('quick.loop')} aria-label={t('quick.loop')} aria-pressed={!!link?.loop} onClick={() => ask({ kind: 'loop' }, false)}><Icon name="loop" /></button>
            <span class="grow" />
            <button class="icon-btn" title={t('quick.undo')} aria-label={t('quick.undo')} disabled={!link?.canUndo} onClick={() => ask({ kind: 'undo' }, false)}><Icon name="undo" /></button>
            <button class="icon-btn" title={t('quick.redo')} aria-label={t('quick.redo')} disabled={!link?.canRedo} onClick={() => ask({ kind: 'redo' }, false)}><Icon name="redo" /></button>
          </div>
          <div class="quick-drop"><Icon name="upload" /><span>{note || t('quick.drop')}</span></div>
          <section class="quick-group">
            <h3>{t('quick.assistant')}</h3>
            <button class="quick-row" onClick={() => ask({ kind: 'ask', text: t('quick.captionsAsk') })}><Icon name="wand" /><span>{t('quick.captions')}</span></button>
            <button class="quick-row" onClick={() => ask({ kind: 'ask', text: t('quick.cleanSoundAsk') })}><Icon name="audio" /><span>{t('quick.cleanSound')}</span></button>
          </section>
          <section class="quick-group">
            <h3>{t('quick.export')}</h3>
            <button class="quick-row" onClick={() => ask({ kind: 'export' })}><Icon name="download" /><span>{t('quick.exportOpen')}</span></button>
            {link?.lastExport && <button class="quick-row" onClick={() => ask({ kind: 'save-export' }, false)}><Icon name="download" /><span>{link.lastExport}</span></button>}
          </section>
        </>
      ) : (
        <>
          <form class="quick-ask" onSubmit={send}>
            <input ref={field} value={words} placeholder={t('quick.describe')} spellcheck={false} onInput={(e) => setWords((e.target as HTMLInputElement).value)} />
            <button class="btn primary sm" type="submit" disabled={!words.trim()}><Icon name="arrow" />{t('quick.start')}</button>
          </form>
          <section class="quick-group">
            <h3>{t('quick.ideas')}</h3>
            <div class="quick-ideas">
              {IDEAS.map((i) => <button key={i.label} class="chip" onClick={() => ask({ kind: 'brief', text: t(i.words) })}>{t(i.label)}</button>)}
            </div>
          </section>
          {recent.length > 0 && (
            <section class="quick-group">
              <h3>{t('quick.recent')}</h3>
              {recent.map((p) => <button key={p.id} class="quick-row" onClick={() => ask({ kind: 'open', id: p.id })}><Icon name="film" /><span>{p.name}</span></button>)}
            </section>
          )}
        </>
      )}
      <footer class="quick-foot"><button class="btn ghost sm" onClick={() => ask({ kind: 'home' })}>{t('quick.openTramme')}</button></footer>
    </div>
  );
}
