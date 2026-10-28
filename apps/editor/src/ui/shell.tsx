// What every page of the editor carries whatever its layout (the studio, the
// atelier, the home): the keyboard shortcuts of a project, the toasts, and
// the dialogs and menus that float over the page.

import { useEffect } from 'preact/hooks';
import { pointer } from '@tramme/core';
import { S, undo, redo, frameStep, setTime, commit, comp, saveNow, toast, select, selectAll } from '../state.ts';
import { freshId, snap } from '../model.ts';
import { MenuHost } from './controls.tsx';
import { deleteSelection, duplicateSelection } from './LeftPanel.tsx';
import { deleteKeys, pps } from './Timeline.tsx';
import { rippleOnMagnetic, runEditKey } from './timeline/edit-keys.ts';
import { uploads } from '../files.ts';
import { transcriptions } from '../speech.ts';
import { SettingsDialog } from './Settings.tsx';
import { settingsOpen } from '../settings.ts';
import { QuestionDialog } from './QuestionDialog.tsx';
import { t } from '../i18n/index.ts';

/** the shortcuts of a project open, the same in the studio and the atelier */
export function useShortcuts() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow().catch((x) => toast(x.message, 'error')); return; }
      if (mod && e.key === ',') { e.preventDefault(); settingsOpen.value = !settingsOpen.value; return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
      if (runEditKey(e)) return;
      // Shift+Z: the whole timeline in view
      if (!mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); pps.value = 0; return; }
      if (e.code === 'Space') { e.preventDefault(); S.playing.value = !S.playing.value; return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? comp.peek().fps : 1);
        S.playing.value = false; frameStep(n); return;
      }
      if (e.key === 'Home') { setTime(0); return; }
      if (e.key === 'End') { setTime(comp.peek().duration); return; }
      // M drops a marker at the playhead; 1..9 jump to the markers in order (bare keys only: with a modifier they belong to the browser)
      if (!mod && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const c = comp.peek(), list = [...(c.markers ?? [])].sort((a, b) => a.t - b.t);
        const id = freshId(Object.fromEntries(list.map((x) => [x.id, 1])), 'marker');
        commit(t('timeline.addMarkerHere'), [{ op: 'add', path: pointer('compositions', S.compId.value, 'markers'), value: [...list, { id, t: snap(S.time.peek(), c.fps), label: t('timeline.markerN', { n: list.length + 1 }) }].sort((a, b) => a.t - b.t) }]);
        return;
      }
      if (!mod && /^[1-9]$/.test(e.key)) {
        const m = [...(comp.peek().markers ?? [])].sort((a, b) => a.t - b.t)[Number(e.key) - 1];
        if (m) { S.playing.value = false; setTime(m.t); }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (!deleteKeys() && !rippleOnMagnetic()) deleteSelection(); return; }
      if (e.key === 'Escape') { select([]); S.keys.value = []; S.assistantFull.value = false; }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
}

export function Toasts() {
  return (
    <div class="toasts">
      {transcriptions.value.map((j) => (
        <div key={`t${j.id}`} class="toast upload">
          <span>{t('common.transcriptOfName', { name: j.name })} · {t(j.stage)}{j.total > 1 ? ` · ${j.done} / ${j.total}` : ''}</span>
          <div class="progress"><i style={{ width: `${(100 * j.done) / Math.max(1, j.total)}%` }} /></div>
        </div>
      ))}
      {uploads.value.map((u) => (
        <div key={`u${u.id}`} class="toast upload">
          <span>{t('app.uploadingName', { name: u.name })} · {Math.round((100 * u.sent) / Math.max(1, u.total))} %</span>
          <div class="progress"><i style={{ width: `${(100 * u.sent) / Math.max(1, u.total)}%` }} /></div>
        </div>
      ))}
      {S.toasts.value.map((x) => <div key={x.id} class={`toast ${x.kind ?? ''}`}>{x.text}</div>)}
    </div>
  );
}

/** the settings, the questions asked, the menus and the toasts, over any page (the question last: it waits on top) */
export function Overlays() {
  return <><SettingsDialog /><MenuHost /><Toasts /><QuestionDialog /></>;
}
