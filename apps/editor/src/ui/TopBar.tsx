// Top bar: project, the view (studio or atelier), history, format, frame rate, export.

import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { pointer, stringifyDoc, type TrammeDoc } from '@tramme/core';
import { DOCUMENT } from '@tramme/project';
import { api } from '../api.ts';
import { confirmWith } from '../confirm.ts';
import { saveBlob } from '../download.ts';
import { safeName, takenPaths, upload } from '../files.ts';
import { canRedo, canUndo, comp, commit, redo, redoLabel, S, saveNow, toast, undo, undoLabel } from '../state.ts';
import { ago, contentEnd, fmtSeconds, snap } from '../model.ts';
import { shortsOf } from '../shorts.ts';
import { openMenu, Popover, Select, Toggle, type MenuItem } from './controls.tsx';
import { VIDEO, WEB_FORMATS, type WebFormat } from '../formats.ts';
import { Icon } from './icons.tsx';
import { LogoMark } from './Logo.tsx';
import { settingsOpen, prefs, VIEWS } from '../settings.ts';
import { setView, VIEW_LABEL, ViewSwitch } from './views.tsx';
import { HelpButton, helpMenu } from './Help.tsx';
import { WindowControls, windowBar } from './WindowControls.tsx';
import { locale, t } from '../i18n/index.ts';

const FORMATS: [string, string, number, number][] = [
  ['9x16', '9:16 · 1080×1920', 1080, 1920],
  ['4x5', '4:5 · 1080×1350', 1080, 1350],
  ['1x1', '1:1 · 1080×1080', 1080, 1080],
  ['16x9', '16:9 · 1920×1080', 1920, 1080],
  ['4k', '16:9 · 3840×2160', 3840, 2160],
];

interface Done { blob: Blob; name: string; seconds: number; warnings: string[]; saved?: string }

// ── the project's versions: named points one can come back to ──
/** the saved document itself is the current version; the snapshots live beside it */
const VERSIONS_INDEX = 'versions/index.json';
interface Snap { file: string; label: string; at: string }

async function listVersions(): Promise<Snap[]> {
  try {
    const r = await api.readText(S.project.peek().id, VERSIONS_INDEX);
    if (!r) return [];
    const j = JSON.parse(r.text) as { versions?: Snap[] };
    return Array.isArray(j.versions) ? j.versions.slice(0, 30) : [];
  } catch { return []; }
}

function VersionsPop({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const [list, setList] = useState<Snap[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listVersions().then(setList); }, []);
  // the state is saved first: the snapshot says exactly what the user sees
  const create = async () => {
    setBusy(true);
    try {
      await saveNow();
      const id = S.project.peek().id, now = new Date();
      const file = `versions/${now.toISOString().replace(/[:.]/g, '-')}.json`;
      await api.write(id, file, stringifyDoc(S.doc.peek() as TrammeDoc), { type: 'application/json' });
      const prev = await listVersions();
      const next = [{ file, label: now.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }), at: now.toISOString() }, ...prev].slice(0, 30);
      await api.write(id, VERSIONS_INDEX, JSON.stringify({ versions: next }), { type: 'application/json' });
      // a version pushed out by the cap is deleted with its index row: the file would otherwise stay forever
      await Promise.all(prev.filter((v) => !next.some((n) => n.file === v.file)).map((v) => api.removeFile(id, v.file).catch(() => {})));
      setList(next);
      toast(t('topbar.versionAdded'));
    } catch (e) { toast(t('common.couldNotSaveError', { error: (e as Error).message }), 'error'); }
    setBusy(false);
  };
  // the document of the snapshot becomes the document: the page reloads on it
  const restore = async (v: Snap) => {
    if (!await confirmWith(t('topbar.restoreVersion'), t('topbar.restoreVersionBody', { label: v.label }), t('topbar.restore'))) return;
    setBusy(true);
    try {
      const id = S.project.peek().id, r = await api.readText(id, v.file);
      if (!r) throw new Error(`${v.file}: missing`);
      JSON.parse(r.text) as TrammeDoc;
      await api.write(id, DOCUMENT, r.text, { type: 'application/json' });
      // the reloaded page must not be asked to save what it is only starting to read: the write above is the state of record
      S.save.value = 'saved';
      location.reload();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  const remove = async (v: Snap) => {
    try {
      const id = S.project.peek().id;
      await api.removeFile(id, v.file);
      const next = (await listVersions()).filter((x) => x.file !== v.file);
      await api.write(id, VERSIONS_INDEX, JSON.stringify({ versions: next }), { type: 'application/json' });
      setList(next);
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} class="versions-pop" align="left">
      <div style={{ fontWeight: 600 }}>{t('topbar.versions')}</div>
      <div class="faint" style={{ fontSize: 11 }}>{t('topbar.versionsHint')}</div>
      <button class="btn sm" disabled={busy} onClick={create}><Icon name="clock" />{t('topbar.addVersionNow')}</button>
      {list === null && <span class="faint" style={{ fontSize: 11 }}>{t('common.searching')}</span>}
      {list !== null && list.length === 0 && <span class="faint" style={{ fontSize: 11 }}>{t('topbar.noVersionYet')}</span>}
      {list?.map((v) => (
        <div key={v.file} class="versions-row">
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
            <span class="faint" style={{ fontSize: 11 }}>{ago(v.at)}</span>
          </span>
          <button class="btn sm" disabled={busy} onClick={() => restore(v)}>{t('topbar.restore')}</button>
          <button class="icon-btn" disabled={busy} title={t('common.delete')} onClick={() => remove(v)}><Icon name="trash" /></button>
        </div>
      ))}
    </Popover>
  );
}
type ExpState = { done: number; total: number } | Done | { error: string };

// the export lives outside the popover: closing it (a click beside, the button
// again) neither stops the export nor loses the finished file — opening the
// popover again shows the progress or the result as it stands
const expState = signal<ExpState | null>(null);
const expFormat = signal<WebFormat>('mp4');
const expSamples = signal('doc');
/** 10 bits a channel (MP4, WebM), when this browser encodes it */
const expDeep = signal(false);
const expBatch = signal<{ i: number; n: number; name: string } | null>(null);
const expAbort: { current: AbortController | null } = { current: null };
const expStop = { current: false };
const running = () => (expState.value !== null && 'total' in expState.value) || expBatch.value !== null;

function ExportPop({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const c = comp.value;
  const format = expFormat.value, samples = expSamples.value, state = expState.value, batch = expBatch.value;
  const setFormat = (id: WebFormat) => { expFormat.value = id; expState.value = null; };
  const video = VIDEO.has(format);
  // a 10-bit codec this browser encodes at this size, asked before the export offers it (undefined: still asking)
  const deepable = format === 'mp4' || format === 'webm';
  const [deepLabel, setDeepLabel] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!deepable) return;
    let live = true;
    setDeepLabel(undefined);
    import('@tramme/render').then(({ deepCodec }) => deepCodec(format, c.width, c.height)).then((d) => { if (live) setDeepLabel(d?.label ?? null); }).catch(() => { if (live) setDeepLabel(null); });
    return () => { live = false; };
  }, [format, c.width, c.height]);
  // the shorts of the document, named short-* by the build: exported one by one, in the format chosen above
  const shorts = shortsOf(S.doc.value);
  // time left empty after the last layer: the composition can be brought back to its content before the export
  const end = snap(contentEnd(c), c.fps), empty = format !== 'svg' && end > 0 && end < c.duration - 0.5 / c.fps;
  const trim = () => commit(t('topbar.trimToContent'), [{ op: 'replace', path: pointer('compositions', S.compId.peek(), 'duration'), value: end }]);
  const run = async () => {
    const t0 = performance.now(), at = S.time.peek();
    expAbort.current = new AbortController();
    expState.value = { done: 0, total: VIDEO.has(expFormat.value) ? Math.round(c.duration * c.fps) : 1 };
    try {
      const { exportInBrowser } = await import('../webexport.ts');
      const r = await exportInBrowser(S.doc.peek(), new URL(S.docUrl.peek(), location.href).href, expFormat.value, {
        compId: S.compId.peek(), registry: S.registry.peek(), t: at, signal: expAbort.current.signal,
        samples: expSamples.value === 'doc' ? undefined : Number(expSamples.value),
        depth: expDeep.value && deepable && deepLabel ? 10 : 8,
        onProgress: (done, total) => { if (done % 3 === 0 || done === total) expState.value = { done, total }; },
      });
      const stem = safeName(S.project.peek().name);
      const name = expFormat.value === 'svg' ? `${stem}_${at.toFixed(2)}.svg` : `${stem}.${r.ext}`;
      expState.value = { blob: r.blob, name, seconds: (performance.now() - t0) / 1000, warnings: r.warnings };
    } catch (e) {
      expState.value = (e as Error).name === 'AbortError' ? null : { error: (e as Error).message };
    } finally { expAbort.current = null; }
  };
  // all the shorts, one after another for the memory's sake, each named after its title
  const exportAll = async () => {
    expStop.current = false;
    expAbort.current = new AbortController();
    try {
      const { exportInBrowser } = await import('../webexport.ts');
      for (let i = 0; i < shorts.length; i++) {
        if (expStop.current) break;
        const { id: cid, name } = shorts[i];
        expBatch.value = { i: i + 1, n: shorts.length, name };
        expState.value = null;
        const r = await exportInBrowser(S.doc.peek(), new URL(S.docUrl.peek(), location.href).href, expFormat.value, {
          compId: cid, registry: S.registry.peek(), signal: expAbort.current.signal,
          samples: expSamples.value === 'doc' ? undefined : Number(expSamples.value),
        });
        const file = `${safeName(name)}.${r.ext}`;
        await saveBlob(r.blob, file);
        try { await upload(await takenPaths(), `renders/${name.replace(/\.png\.zip$/, '.zip')}`, r.blob); } catch { /* the file is on disk anyway */ }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') expState.value = { error: (e as Error).message };
    } finally { expBatch.value = null; expAbort.current = null; }
  };
  // a copy in the project's renders/ folder (kept out of .tramme archives)
  const keep = async (done: Done) => {
    try {
      const path = await upload(await takenPaths(), `renders/${done.name.replace(/\.png\.zip$/, '.zip').replace(/\.lottie\.json$/, '.json')}`, done.blob);
      expState.value = { ...done, saved: path };
    } catch (e) { toast(t('topbar.couldNotSaveTo', { error: (e as Error).message }), 'error'); }
  };
  return (
    <Popover anchor={anchor} onClose={running() ? () => {} : onClose} class="export-pop" align="right">
      <div style={{ fontWeight: 600 }}>{t('common.export')}</div>
      <div class="export-formats">
        {WEB_FORMATS.map(([id, label, hint]) => (
          <button key={id} class={format === id ? 'on' : ''} disabled={running()} onClick={() => setFormat(id)}>
            <span>{t(label)}</span><span class="faint">{t(hint)}</span>
          </button>
        ))}
      </div>
      <div class="row"><span class="muted">{t('common.image')}</span><span class="mono">{c.width}×{c.height} · {t('common.nFps', { n: c.fps })} · {fmtSeconds(c.duration)}</span></div>
      {empty && <div class="export-trim"><span>{t('topbar.contentEndsAt', { end: fmtSeconds(end), duration: fmtSeconds(c.duration) })}</span><button class="btn sm" disabled={running()} onClick={trim}>{t('topbar.trimToContent')}</button></div>}
      {shorts.length > 1 && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {batch
          ? <>
            <div class="progress"><i style={{ width: `${(100 * (batch.i - 1)) / batch.n}%` }} /></div>
            <div class="faint mono" style={{ fontSize: 11 }}>{t('topbar.shortOfN', { name: batch.name, i: batch.i, n: batch.n })}</div>
            <button class="btn" onClick={() => { expStop.current = true; expAbort.current?.abort(); }}><Icon name="stop" />{t('topbar.cancelExport')}</button>
          </>
          : <button class="btn" disabled={running()} onClick={exportAll}><Icon name="film" />{t('topbar.exportAllShorts', { n: shorts.length })}</button>}
      </div>}
      {video && <div class="row"><span class="muted">{t('topbar.blur')}</span>
        <Select value={samples} options={[['doc', t('topbar.documentSetting')], ['1', t('topbar.noBlurFast')], ['8', t('topbar.nSubFrames', { n: 8 })], ['16', t('topbar.nSubFrames', { n: 16 })]]} onChange={(v) => { expSamples.value = v; }} />
      </div>}
      {deepable && <div class="row"><span class="muted">{t('topbar.tenBit')}</span>
        {deepLabel
          ? <span title={deepLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Toggle on={expDeep.value} onChange={(v) => { expDeep.value = v; }} /><span class="faint" style={{ fontSize: 11 }}>{deepLabel}</span></span>
          : <span class="faint" style={{ fontSize: 11 }}>{deepLabel === null ? t('topbar.tenBitUnavailable') : t('common.searching')}</span>}
      </div>}
      {state && 'total' in state && video && <>
        <div class="progress"><i style={{ width: `${(100 * state.done) / Math.max(1, state.total)}%` }} /></div>
        <div class="faint mono" style={{ fontSize: 11 }}>{t('common.frameDoneTotal', { done: state.done, total: state.total })}</div>
      </>}
      {state && 'blob' in state && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ color: 'var(--ok)' }}>{t('topbar.doneInSS', { s: state.seconds.toFixed(1) })}</div>
        <div class="mono faint" style={{ fontSize: 11, userSelect: 'text', wordBreak: 'break-all' }}>{state.name} · {t('topbar.nMb', { n: (state.blob.size / 1e6).toFixed(2) })}</div>
        {state.warnings.length > 0 && <ul class="export-warn">{state.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button class="btn sm" onClick={() => saveBlob(state.blob, state.name)}><Icon name="download" />{t('topbar.saveToComputer')}</button>
          {state.saved
            ? <span class="faint" style={{ fontSize: 11 }}>{t('topbar.keptInPath', { path: state.saved })}</span>
            : <button class="btn sm" onClick={() => keep(state)}><Icon name="folder" />{t('topbar.keepInTheProject')}</button>}
        </div>
      </div>}
      {state && 'error' in state && <div class="prop-note err">{state.error}</div>}
      {running()
        ? <button class="btn" onClick={() => expAbort.current?.abort()}><Icon name="stop" />{t('topbar.cancelExport')}</button>
        : <button class="btn primary" onClick={run}><Icon name="download" />{t('common.export')}</button>}
    </Popover>
  );
}

/** back to the projects, once the last changes are saved */
async function leave(e: MouseEvent) {
  e.preventDefault();
  try { await saveNow(); location.assign('/'); } catch (x) { toast(t('common.couldNotSaveError', { error: (x as Error).message }), 'error'); }
}

async function rename(value: string) {
  const name = value.trim();
  if (!name || name === S.project.peek().name) return;
  try {
    S.project.value = await api.update(S.project.peek().id, { name });
    document.title = `${name} · Tramme`;
    if (S.doc.peek().meta.title !== name) commit(t('topbar.projectName'), [{ op: 'replace', path: '/meta/title', value: name }]);
  } catch (e) { toast(t('common.couldNotRenameError', { error: (e as Error).message }), 'error'); }
}

const FPS = [24, 25, 30, 50, 60];

interface FormatChoice { fmt: string; fps: number; setFormat: (id: string) => void; setFps: (n: number) => void; comps: [string, string][] }

/** the compositions, the format and the frame rate, as menu items */
function formatItems(o: FormatChoice): MenuItem[] {
  const items: MenuItem[] = [];
  if (o.comps.length) items.push({ section: t('common.composition') }, ...o.comps.map(([id, name]): MenuItem => ({ label: name, icon: id === S.compId.peek() ? 'check' : undefined, onClick: () => { S.compId.value = id; S.selection.value = []; } })), 'sep');
  items.push({ section: t('common.format') }, ...FORMATS.map(([id, label]): MenuItem => ({ label, icon: id === o.fmt ? 'check' : undefined, onClick: () => o.setFormat(id) })));
  items.push('sep', { section: t('common.frameRate') }, ...FPS.map((n): MenuItem => ({ label: t('common.nFps', { n }), icon: n === o.fps ? 'check' : undefined, onClick: () => o.setFps(n) })));
  return items;
}

/** format, frame rate, compositions, view, versions, help and settings, for the narrow bar; `versions` opens their list under the button */
function moreMenu(e: MouseEvent, o: FormatChoice, versions: (anchor: HTMLElement) => void) {
  const btn = e.currentTarget as HTMLElement, r = btn.getBoundingClientRect();
  openMenu({ clientX: r.right, clientY: r.bottom + 4 }, [
    ...formatItems(o),
    'sep',
    { section: t('views.view') },
    ...VIEWS.map((id): MenuItem => ({ label: t(VIEW_LABEL[id]), icon: prefs.value.view === id ? 'check' : undefined, onClick: () => setView(id) })),
    'sep',
    { label: t('topbar.versions'), icon: 'clock', onClick: () => versions(btn) },
    { label: t('common.helpAndGuidedTours'), icon: 'help', onClick: () => helpMenu({ currentTarget: btn } as unknown as MouseEvent, 'editor') },
    { label: t('common.settings'), icon: 'gear', onClick: () => { settingsOpen.value = true; } },
  ]);
}

export function TopBar() {
  const doc = S.doc.value, c = comp.value, save = S.save.value, project = S.project.value;
  const [exp, setExp] = useState<HTMLElement | null>(null);
  const [ver, setVer] = useState<HTMLElement | null>(null);
  const doneWaiting = expState.value !== null && 'blob' in expState.value && !expState.value.saved;
  const cp = pointer('compositions', S.compId.value);
  const fmt = FORMATS.find((f) => f[2] === c.width && f[3] === c.height)?.[0] ?? 'custom';
  const setFormat = (id: string) => {
    const f = FORMATS.find((x) => x[0] === id);
    if (!f) return;
    commit(t('topbar.formatName', { name: f[1] }), [{ op: 'replace', path: `${cp}/width`, value: f[2] }, { op: 'replace', path: `${cp}/height`, value: f[3] }]);
  };
  const comps = Object.entries(doc.compositions);
  const studio = prefs.value.view === 'studio';
  const choice: FormatChoice = { fmt, fps: c.fps, setFormat, setFps: (n) => commit(t('common.frameRate'), [{ op: 'replace', path: `${cp}/fps`, value: n }]), comps: comps.length > 1 ? comps.map(([id, x]) => [id, x.name] as [string, string]) : [] };
  return (
    <header class={`topbar${studio ? ' in-studio' : ''}`} {...windowBar}>
      <a class="brand" href="/" title={t('topbar.allProjects')} onClick={leave}><LogoMark /><span>Tramme</span></a>
      <span class="sep" />
      <div class="project" data-tour="project">
        <input class="title" value={project.name} spellcheck={false} aria-label={t('topbar.projectName')}
          style={{ width: `${Math.max(6, project.name.length + 1)}ch` }}
          onChange={(e) => rename((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <span class={`save-state ${save === 'saved' ? '' : save === 'error' ? 'error' : 'dirty'}`} title={t('topbar.projectId', { id: project.id })}>
          <i class="dot" /><span>{save === 'saved' ? t('topbar.saved') : save === 'saving' ? t('topbar.saving') : save === 'error' ? t('topbar.notSaved') : t('topbar.modified')}</span>
        </span>
        <button class="icon-btn" data-tour="versions" title={t('topbar.versions')} onClick={(e) => setVer(ver ? null : (e.currentTarget as HTMLElement))}><Icon name="clock" /></button>
        {ver && <VersionsPop anchor={ver} onClose={() => setVer(null)} />}
      </div>
      {!studio && comps.length > 1 && <div style={{ width: 170 }} class="hide-sm"><Select value={S.compId.value} options={comps.map(([id, x]) => [id, x.name])} onChange={(v) => { S.compId.value = v; S.selection.value = []; }} /></div>}
      <span class="grow" />
      <ViewSwitch size="lg" />
      <span class="grow" />
      <div class="group" data-tour="history">
        <button class="icon-btn" title={undoLabel.value ? t('topbar.undoActionCtrlZ', { action: undoLabel.value }) : t('topbar.undoCtrlZ')} disabled={!canUndo.value} onClick={undo}><Icon name="undo" /></button>
        <button class="icon-btn" title={redoLabel.value ? t('topbar.redoActionCtrlShift', { action: redoLabel.value }) : t('topbar.redoCtrlShiftZ')} disabled={!canRedo.value} onClick={redo}><Icon name="redo" /></button>
      </div>
      <span class="sep" />
      <div class="settings" data-tour="format">
        <div style={{ width: 168 }} class="hide-sm">
          <Select value={fmt} options={[...FORMATS.map(([id, label]) => [id, label] as [string, string]), ...(fmt === 'custom' ? [['custom', `${c.width}×${c.height}`] as [string, string]] : [])]} onChange={setFormat} />
        </div>
        <div style={{ width: 84 }}>
          <Select value={String(c.fps)} options={['24', '25', '30', '50', '60'].map((f) => [f, t('common.nFps', { n: f })])} onChange={(v) => choice.setFps(Number(v))} />
        </div>
      </div>
      <HelpButton page="editor" />
      <button class="icon-btn" data-tour="settings" title={t('common.settingsCtrl')} onClick={() => { settingsOpen.value = true; }}><Icon name="gear" /></button>
      {/* the popover never closes on this button while an export runs: the progress stays visible;
          a finished file waits in the popover for its next open (kept outside of it, in the signals) */}
      <button class="btn primary" data-tour="export" title={doneWaiting ? t('topbar.exportReady') : undefined} onClick={(e) => {
        if (running()) { setExp((prev) => prev ?? (e.currentTarget as HTMLElement)); return; }
        setExp(exp ? null : (e.currentTarget as HTMLElement));
      }}><Icon name="download" />{doneWaiting && <i class="export-dot" />}<span class="label">{t('common.export')}</span></button>
      {/* narrow screens: what no longer fits in the bar moves here */}
      <button class="icon-btn more-btn" title={t('topbar.moreOptions')} aria-label={t('topbar.moreOptions')} onClick={(e) => moreMenu(e as unknown as MouseEvent, choice, setVer)}><Icon name="more" /></button>
      <WindowControls />
      {exp && <ExportPop anchor={exp} onClose={() => setExp(null)} />}
    </header>
  );
}

export const notify = toast;
