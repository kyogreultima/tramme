// The source monitor: a media played alone, with an in point and an out point
// set on it (I and O), and the part between them put on the timeline (insert,
// overwrite) or kept under a name (a sub-clip). The file is the project's own,
// played by the browser: nothing is copied.

import { useEffect, useRef, useState } from 'preact/hooks';
import { comp, commit, S, toast } from '../state.ts';
import { preview } from '../preview.ts';
import { mediaOf, subclipOps, clipFromRange } from '../subclips.ts';
import { timecode } from '../model.ts';
import { t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';
import { assetLayer, insertLayer } from './LeftPanel.tsx';
import { placeRange } from './timeline/place.ts';
import { sourceOpen } from './timeline/assets-drag.ts';
import { defaultTrackOf } from './timeline/tracks.ts';

export function SourceMonitor() {
  const id = sourceOpen.value;
  const doc = S.doc.value, a = id ? doc.assets[id] : undefined;
  const media = id ? mediaOf(doc, id) : '', file = media ? doc.assets[media] : undefined;
  const el = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [marks, setMarks] = useState<{ in: number | null; out: number | null }>({ in: null, out: null });
  const [naming, setNaming] = useState<string | null>(null);
  // opened on a sub-clip, its range is the marks to begin with
  useEffect(() => { setMarks(a?.range ? { in: a.range[0], out: a.range[1] } : { in: null, out: null }); setNaming(null); }, [id]);
  if (!id || !a || !file || (file.type !== 'video' && file.type !== 'audio')) return null;
  let url = '';
  try { url = preview.renderer?.assets.url(media) ?? new URL(file.src, new URL(S.docUrl.peek(), location.href)).href; } catch { url = new URL(file.src, new URL(S.docUrl.peek(), location.href)).href; }
  const c = comp.value, fps = c.fps, now = () => Math.round((el.current?.currentTime ?? 0) * fps) / fps;
  const range = marks.in !== null && marks.out !== null && marks.out > marks.in ? [marks.in, marks.out] as [number, number] : null;
  const asked = () => { toast(t('source.needRange'), 'error'); };
  const to = (mode: 'insert' | 'overwrite') => {
    if (!range) return asked();
    const track = defaultTrackOf(S.doc.peek().compositions[S.compId.peek()], file.type === 'audio', S.selection.peek()[0]);
    if (track) void placeRange(media, range[0], range[1], S.time.peek(), track, mode);
  };
  const addLayer = async () => {
    if (!range) return asked();
    const built = await assetLayer(media, file);
    if (built) insertLayer(clipFromRange(built.layer, range[0], range[1]), media, built.ops);
  };
  const save = (name: string) => {
    const r = range && name.trim() ? subclipOps(S.doc.peek(), media, name.trim(), range[0], range[1]) : null;
    if (r && commit(t('source.saveSubclip'), r.ops)) toast(t('source.subclipSaved', { name: name.trim() }), 'info', 2000);
    setNaming(null);
  };
  const key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 'i') { e.preventDefault(); e.stopPropagation(); setMarks((m) => ({ ...m, in: now() })); }
    else if (e.key.toLowerCase() === 'o') { e.preventDefault(); e.stopPropagation(); setMarks((m) => ({ ...m, out: now() })); }
  };
  return (
    <div class="source-monitor" role="dialog" aria-label={t('source.title')} tabIndex={-1} onKeyDown={key}>
      <div class="source-head"><Icon name="film" size={13} /><span class="name">{a.name || id}</span><button class="icon-btn xs" title={t('source.close')} onClick={() => { sourceOpen.value = null; }}><Icon name="x" /></button></div>
      {file.type === 'video'
        ? <video ref={el} src={url} controls playsInline preload="metadata" />
        : <audio ref={el} src={url} controls preload="metadata" />}
      <div class="source-marks">
        <button class="btn sm" title={t('source.setIn')} onClick={() => setMarks((m) => ({ ...m, in: now() }))}>{t('source.markIn', { time: marks.in === null ? '—' : timecode(marks.in, fps) })}</button>
        <button class="btn sm" title={t('source.setOut')} onClick={() => setMarks((m) => ({ ...m, out: now() }))}>{t('source.markOut', { time: marks.out === null ? '—' : timecode(marks.out, fps) })}</button>
        {range && <span class="faint mono">{t('source.range', { length: `${(range[1] - range[0]).toFixed(2)} s` })}</span>}
      </div>
      <div class="source-actions">
        {c.tracks
          ? <><button class="btn sm" disabled={!range} onClick={() => to('insert')}>{t('source.insert')}</button><button class="btn sm" disabled={!range} onClick={() => to('overwrite')}>{t('source.overwrite')}</button></>
          : <button class="btn sm" disabled={!range} onClick={() => void addLayer()}>{t('source.addToTimeline')}</button>}
        {naming === null
          ? <button class="btn sm ghost" disabled={!range} onClick={() => setNaming('')}>{t('source.saveSubclip')}</button>
          : <input class="name-input" value={naming} autoFocus placeholder={t('source.subclipName')} spellcheck={false}
              onInput={(e) => setNaming((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(naming); if (e.key === 'Escape') setNaming(null); e.stopPropagation(); }} onBlur={() => setNaming(null)} />}
      </div>
    </div>
  );
}
