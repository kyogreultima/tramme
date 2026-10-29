// The multicam panel: cameras set up on tracks (multicamOps), the one on show
// changing where the playhead is when a camera's button is pressed (Alt and
// its number), while the film plays or not. The cuts it makes are plain clips.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { multicamOps, switchAngleOps, trackClips } from '@tramme/core';
import { comp, commit, S, toast, uiTime } from '../state.ts';
import { snap } from '../model.ts';
import { syncClips } from '../sync.ts';
import { t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';

/** the tracks of the cameras being cut between, if a multicam is open */
export const multicam = signal<{ tracks: string[] } | null>(null);

/** the selected videos lined up by their sound, set up as cameras, and the panel opened on them */
export async function makeMulticam(ids: string[]): Promise<boolean> {
  const c0 = S.doc.peek().compositions[S.compId.peek()];
  const cams = ids.filter((id) => c0.layers[id]?.type === 'video');
  if (cams.length < 2) { toast(t('timeline.multicamNeedsTwo'), 'error'); return false; }
  await syncClips(cams);
  const compId = S.compId.peek();
  if (!commit(t('timeline.makeMulticam'), multicamOps(S.doc.peek(), compId, cams))) return false;
  const c = S.doc.peek().compositions[compId];
  multicam.value = { tracks: cams.map((id) => c.layers[id].track!).filter(Boolean) };
  return true;
}

export function MulticamPanel() {
  // over every page, the start page too: the document is read only once there is one and the panel is open
  const open = multicam.value, c = open && S.doc.value ? comp.value : null, now = uiTime.value;
  const cut = (track: string) => {
    const compId = S.compId.peek(), at = snap(S.time.peek(), S.doc.peek().compositions[compId].fps);
    commit(t('timeline.switchCamera'), switchAngleOps(S.doc.peek(), compId, multicam.peek()?.tracks ?? [], track, at));
  };
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      const n = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (!e.altKey || !n || (e.target as HTMLElement).tagName === 'INPUT') return;
      const track = multicam.peek()?.tracks[Number(n) - 1];
      if (track) { e.preventDefault(); cut(track); }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [open]);
  if (!open || !c || open.tracks.some((id) => !c.tracks?.some((x) => x.id === id))) return null;
  // the camera on show at the playhead: the visible clip of its track
  const shown = (track: string) => trackClips(c, track).some((k) => k.in <= now && now < k.out && c.layers[k.id].visible !== false);
  return (
    <div class="multicam-panel" role="dialog" aria-label={t('timeline.multicam')}>
      <div class="source-head"><Icon name="film" size={13} /><span class="name">{t('timeline.multicam')}</span><button class="icon-btn xs" title={t('timeline.closeMulticam')} onClick={() => { multicam.value = null; }}><Icon name="x" /></button></div>
      <div class="source-marks">
        {open.tracks.map((track, i) => (
          <button key={track} class={`btn sm${shown(track) ? ' primary' : ''}`} title={`Alt+${i + 1}`} onClick={() => cut(track)}>{t('timeline.cameraN', { n: i + 1 })}</button>
        ))}
      </div>
    </div>
  );
}
