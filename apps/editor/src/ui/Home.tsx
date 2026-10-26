// Home screen: a film starts from words. The direction box takes what the
// user wants (the subject, the tone, the length) and the material it is made
// from (documents, pictures, videos, sounds, a whole folder, dropped or
// picked), in the format chosen; the project opens in the studio with the
// assistant already at work. Below, the projects in storage, most recent
// first, and the examples. A blank project, a .tramme archive or a Lottie
// animation are a menu away; each card opens its project, its menu renames,
// duplicates, saves the archive on the computer or deletes.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Manifest } from '@tramme/project';
import { api, ApiError } from '../api.ts';
import { saveBlob } from '../download.ts';
import { safeName } from '../files.ts';
import { ago } from '../model.ts';
import { createFromWords, droppedOf, importArchive, ImportError, importFile, importSources, importVideo, isSourceFile, isVideoFile, pickedOf, type Picked, type Progress } from '../importer.ts';
import { kindOf } from '../sources.ts';
import { S, toast } from '../state.ts';
import { listCommands, type Command } from '../ai/commands.ts';
import { packCommands, shippedPacks } from '../packs.ts';
import { useCommandMenu } from './composer.tsx';
import { Modal, longPress, openMenu, Seg } from './controls.tsx';
import { Icon } from './icons.tsx';
import { LogoMark } from './Logo.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { Overlays } from './shell.tsx';
import { HelpButton } from './Help.tsx';
import { WindowControls, windowBar } from './WindowControls.tsx';
import { personal } from '../mode.ts';
import { install, installable } from '../install.ts';
import { offerTours } from '../tours/index.ts';
import { settingsOpen } from '../settings.ts';
import { IDEAS } from '../ideas.ts';
import { t } from '../i18n/index.ts';

interface Example { file: string; name: string; description: string; width: number; height: number; duration: number; thumbnail?: string }

const PRESETS: [string, string, number, number][] = [
  ['16x9', t('home.landscape'), 1920, 1080],
  ['9x16', t('home.vertical'), 1080, 1920],
  ['1x1', t('common.square'), 1080, 1080],
  ['4x5', t('home.portrait'), 1080, 1350],
  ['4k', '4K', 3840, 2160],
];
/** the formats a film starts in (4K is a blank project's) */
const FILM_FORMATS = PRESETS.filter(([id]) => id !== '4k');


const open = (id: string) => location.assign(`/p/${encodeURIComponent(id)}`);

const dims = (m: { width?: number; height?: number; duration?: number }) =>
  [m.width && m.height ? `${m.width}×${m.height}` : null, m.duration ? `${+m.duration.toFixed(2)} s` : null].filter(Boolean).join(' · ');

function NewProject({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(t('home.untitled'));
  const [preset, setPreset] = useState('16x9');
  const [size, setSize] = useState<[number, number]>([1920, 1080]);
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);
  const pick = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x[0] === id);
    if (p) setSize([p[2], p[3]]);
  };
  const valid = name.trim() && size.every((v) => Number.isInteger(v) && v >= 16 && v <= 8192);
  const create = async (e: Event) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const m = await api.create({ name: name.trim(), width: size[0], height: size[1], fps });
      open(m.id);
    } catch (x) { toast(t('home.couldNotCreateError', { error: (x as Error).message }), 'error'); setBusy(false); }
  };
  return (
    <Modal title={t('home.blankProject')} onClose={onClose} wide>
      <form class="modal-body" onSubmit={create}>
        <label class="lbl">{t('common.name')}</label>
        <div class="field"><input value={name} autoFocus onFocus={(e) => (e.target as HTMLInputElement).select()} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <label class="lbl">{t('common.format')}</label>
        <div class="presets">
          {PRESETS.map(([id, label, w, h]) => (
            <button type="button" key={id} class={preset === id ? 'on' : ''} onClick={() => pick(id)}>
              <span class="shape"><i style={{ aspectRatio: `${w} / ${h}`, [w >= h ? 'width' : 'height']: '100%' }} /></span>
              <span>{label}</span><span class="faint mono">{w}×{h}</span>
            </button>
          ))}
          <button type="button" class={preset === 'custom' ? 'on' : ''} onClick={() => setPreset('custom')}>
            <span class="shape"><Icon name="edit" /></span><span>{t('home.custom')}</span><span class="faint mono">{preset === 'custom' ? `${size[0]}×${size[1]}` : t('home.anySize')}</span>
          </button>
        </div>
        {preset === 'custom' && (
          <div class="inline-fields">
            <div class="field num"><span class="axis">L</span><input type="number" min={16} max={8192} value={size[0]} onInput={(e) => setSize([Math.round(Number((e.target as HTMLInputElement).value)), size[1]])} /><span class="unit">px</span></div>
            <div class="field num"><span class="axis">H</span><input type="number" min={16} max={8192} value={size[1]} onInput={(e) => setSize([size[0], Math.round(Number((e.target as HTMLInputElement).value))])} /><span class="unit">px</span></div>
          </div>
        )}
        {/* no duration asked: the assistant sets it to the content it builds, the inspector changes it */}
        <label class="lbl">{t('common.frameRate')}</label>
        <Seg value={String(fps)} options={[24, 25, 30, 50, 60].map((f) => [String(f), String(f)] as [string, string])} onChange={(v) => setFps(Number(v))} />
        <div class="modal-foot">
          <button type="button" class="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" class="btn primary" disabled={!valid || busy}><Icon name={busy ? 'spinner' : 'plus'} />{t('home.createProject')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Rename({ project, onClose, onDone }: { project: Manifest; onClose: () => void; onDone: (m: Manifest) => void }) {
  const [name, setName] = useState(project.name);
  const save = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { onDone(await api.update(project.id, { name: name.trim() })); onClose(); }
    catch (x) { toast(t('common.couldNotRenameError', { error: (x as Error).message }), 'error'); }
  };
  return (
    <Modal title={t('common.rename')} onClose={onClose}>
      <form class="modal-body" onSubmit={save}>
        <div class="field"><input value={name} autoFocus onFocus={(e) => (e.target as HTMLInputElement).select()} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" class="btn primary" disabled={!name.trim()}>{t('common.rename')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Remove({ project, onClose, onDone }: { project: Manifest; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try { await api.remove(project.id); onDone(); onClose(); }
    catch (x) { toast(t('home.couldNotDeleteError', { error: (x as Error).message }), 'error'); setBusy(false); }
  };
  return (
    <Modal title={t('home.deleteProject')} onClose={onClose}>
      <div class="modal-body">
        <p>{t('home.nameAndAllIts', { name: project.name })}</p>
        <div class="modal-foot">
          <button class="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button class="btn danger solid" disabled={busy} onClick={remove}><Icon name="trash" />{t('common.delete')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Failure({ error, onClose }: { error: ImportError | Error; onClose: () => void }) {
  const issues = error instanceof ImportError ? error.issues : error instanceof ApiError ? error.issues ?? [] : [];
  return (
    <Modal title={t('home.importFailed')} onClose={onClose} wide>
      <div class="modal-body">
        <p>{error.message}</p>
        {issues.length > 0 && <ul class="issues mono">{issues.slice(0, 30).map((i, n) => <li key={n}><b>{i.path || '/'}</b> {i.message}</li>)}</ul>}
        {issues.length > 30 && <p class="faint">{t('home.andNMore', { n: issues.length - 30 })}</p>}
        <div class="modal-foot"><button class="btn primary" onClick={onClose}>{t('common.close')}</button></div>
      </div>
    </Modal>
  );
}

function Card({ m, onMenu }: { m: Manifest; onMenu: (e: MouseEvent | { clientX: number; clientY: number }) => void }) {
  const [broken, setBroken] = useState(false);
  // every thumb sits in the same 16/10 box, whatever the film's format: the grid keeps
  // one row height (a vertical film fills it, cropped); the placeholder keeps the shape
  const vertical = (m.height ?? 9) > (m.width ?? 16);
  return (
    <div class="card interactive" role="button" tabIndex={0} onClick={() => open(m.id)} onKeyDown={(e) => e.key === 'Enter' && open(m.id)}
      onPointerDown={(e) => longPress(e, onMenu)} onContextMenu={(e) => { e.preventDefault(); onMenu(e); }}>
      <div class="card-thumb">
        {m.thumbnail && !broken
          ? <img src={`${api.fileUrl(m.id, m.thumbnail)}?v=${encodeURIComponent(m.modified)}`} alt="" loading="lazy" onError={() => setBroken(true)} />
          : <span class="frame" style={{ aspectRatio: `${m.width ?? 16} / ${m.height ?? 9}`, ...(vertical ? { width: 'auto', height: '62%' } : {}) }}><Icon name="film" /></span>}
      </div>
      <div class="card-meta">
        <div class="card-name" title={m.name}>{m.name}</div>
        <div class="card-sub">{[dims(m), ago(m.modified)].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="icon-btn sm card-more" title={t('home.actions')} onClick={(e) => { e.stopPropagation(); onMenu(e); }}><Icon name="more" /></button>
    </div>
  );
}

/** the direction box: the words of the film, the material it is made from, the model that makes it, its format */
function DirectionBox({ busy, onStart }: { busy: boolean; onStart: (words: string, material: Picked[], format: [number, number]) => void }) {
  const [words, setWords] = useState('');
  const [material, setMaterial] = useState<Picked[]>([]);
  const [format, setFormat] = useState('16x9');
  const area = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(260, Math.max(92, el.scrollHeight))}px`; } }, [words]);
  const add = (list: Picked[]) => setMaterial((had) => [...had, ...list.filter((p) => !had.some((h) => h.path === p.path))]);
  const ready = !busy && (words.trim().length > 0 || material.length > 0);
  const start = () => { if (!ready) return; const f = FILM_FORMATS.find(([id]) => id === format)!; onStart(words.trim(), material, [f[2], f[3]]); };
  // the / menu, as in the message box: a workflow starts the project with it, a tool waits in the editor's box with its form.
  // The shipped packs' commands come from the index, so the menu offers them before a project holds any pack.
  const [packCmds, setPackCmds] = useState<Command[]>([]);
  useEffect(() => { void shippedPacks().then((p) => setPackCmds(packCommands(p))); }, []);
  const commands = useMemo(() => [...listCommands(S.registry.value), ...packCmds], [S.registry.value, packCmds]);
  const commandMenu = useCommandMenu(words, commands, (c) => { setWords(`/${c.name} `); area.current?.focus(); });
  const chosen = (e: Event) => { const input = e.target as HTMLInputElement, list = pickedOf(input.files ?? []); input.value = ''; add(list); };
  return (
    <div class="hero">
      <h1>{t('home.heroTitle')}</h1>
      <p class="hero-sub">{t('home.heroSub')}</p>
      <form class="brief-box" data-tour="home-new" onSubmit={(e) => { e.preventDefault(); start(); }}
        onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
        onDrop={(e) => { if (!e.dataTransfer) return; e.preventDefault(); e.stopPropagation(); droppedOf(e.dataTransfer).then((list) => add(list.filter((p) => isSourceFile(p.file)))); }}>
        <textarea ref={area} value={words} placeholder={t('home.heroPlaceholder')} autoFocus
          role="combobox" aria-expanded={commandMenu.open} aria-autocomplete="list"
          onInput={(e) => { setWords((e.target as HTMLTextAreaElement).value); commandMenu.typed(); }}
          onKeyDown={(e) => { if (commandMenu.keyDown(e)) return; if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); start(); } }} />
        {commandMenu.view}
        {material.length > 0 && (
          <div class="brief-files">
            {material.map((p) => (
              <span key={p.path} class={`file-chip ${kindOf(p.file)}`} title={p.path}>
                <Icon name={kindOf(p.file) === 'image' ? 'image' : kindOf(p.file) === 'video' ? 'film' : kindOf(p.file) === 'audio' ? 'audio' : 'doc'} />
                <span class="file-name">{p.file.name}</span>
                <button type="button" class="icon-btn xs" title={t('common.remove')} onClick={() => setMaterial(material.filter((x) => x !== p))}><Icon name="x" /></button>
              </span>
            ))}
          </div>
        )}
        <div class="brief-bar">
          <button type="button" class="btn sm ghost" title={t('home.addMaterialHint')} onClick={() => files.current?.click()}><Icon name="attach" />{t('home.addMaterial')}</button>
          <button type="button" class="icon-btn sm" title={t('home.fromSourcesFolder')} onClick={() => folder.current?.click()}><Icon name="folder" /></button>
          <input ref={files} type="file" multiple hidden accept="image/*,video/*,audio/*,.pdf,application/pdf,.md,.markdown,.json,.ttf,.otf,.woff,.woff2,.glb,.gltf" onChange={chosen} />
          <input ref={folder} type="file" multiple hidden {...{ webkitdirectory: true }} onChange={chosen} />
          <span class="grow" />
          <ModelPicker />
          <Seg value={format} role="radiogroup" ariaLabel={t('common.format')}
            options={FILM_FORMATS.map(([id, , w, h]) => ({ value: id, label: <><i class="fmt" style={{ aspectRatio: `${w} / ${h}`, [w >= h ? 'width' : 'height']: '13px' }} />{id.replace('x', ':')}</> }))}
            onChange={setFormat} />
          <button type="submit" class="btn primary" disabled={!ready}><Icon name={busy ? 'spinner' : 'arrow'} />{t('home.start')}</button>
        </div>
      </form>
      <div class="hero-ideas">
        {IDEAS.map(({ label, words: w }) => <button key={label} class="chip" onClick={() => { setWords(t(w)); requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }}>{t(label)}</button>)}
      </div>
    </div>
  );
}

export function Home() {
  const [projects, setProjects] = useState<Manifest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [dialog, setDialog] = useState<null | { kind: 'new' } | { kind: 'rename' | 'remove'; m: Manifest } | { kind: 'failure'; error: Error }>(null);
  const [busy, setBusy] = useState<{ label: string; done: number; total: number; bytes?: boolean } | null>(null);
  const [drag, setDrag] = useState(false);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);

  const refresh = () => api.list().then(setProjects).catch((e) => setLoadError((e as Error).message));
  // the home tour, the first time, once the page has its content
  useEffect(() => { if (projects !== null) { const timer = setTimeout(() => offerTours('home'), 500); return () => clearTimeout(timer); } }, [projects !== null]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); settingsOpen.value = !settingsOpen.value; } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    document.title = `${t('home.projects')} · Tramme`;
    refresh();
    fetch('/examples/index.json').then((r) => (r.ok ? r.json() : [])).then(setExamples).catch(() => {});
  }, []);

  const run = async (label: string, job: (progress: Progress) => Promise<Manifest>, bytes = false) => {
    if (busy) return;
    setBusy({ label, done: 0, total: 1, bytes });
    try {
      const m = await job((done, total) => setBusy({ label, done, total, bytes }));
      open(m.id);
    } catch (e) {
      setBusy(null);
      setDialog({ kind: 'failure', error: e as Error });
    }
  };
  /** the direction box: words alone make a film; one video is dressed or used as the words say; other material is read first */
  const start = (words: string, material: Picked[], [width, height]: [number, number]) => {
    if (!material.length) { run(t('home.starting'), () => createFromWords(words, { width, height })); return; }
    const lone = material.length === 1 && isVideoFile(material[0].file) ? material[0].file : null;
    if (lone) run(t('home.uploadingTheVideoName', { name: lone.name }), (p) => importVideo(lone, p, { prompt: words }), true);
    else run(t('home.uploadingSources', { n: material.length }), (p) => importSources(material, p, { prompt: words, format: { width, height } }), true);
  };
  const fromSources = (list: Picked[]) => run(t('home.uploadingSources', { n: list.length }), (p) => importSources(list, p), true);
  const openFiles = (picked: Picked[]) => {
    const f = picked[0]?.file;
    if (!f) return;
    // a folder, several pictures, videos, sounds or documents, or one picture, sound or document: the sources of a video to make
    const folder = picked.some((it) => it.path.includes('/'));
    if (folder || (picked.length > 1 && picked.some((it) => isSourceFile(it.file))) || (isSourceFile(f) && !isVideoFile(f))) { fromSources(picked); return; }
    run(isVideoFile(f) ? t('home.uploadingTheVideoName', { name: f.name }) : t('home.importingName', { name: f.name }), (p) => importFile(f, p), isVideoFile(f));
  };
  /** the chosen files, the input emptied so the same choice can be made again */
  const chosen = (e: Event) => { const input = e.target as HTMLInputElement, list = pickedOf(input.files ?? []); input.value = ''; return list; };
  const useExample = (x: Example) => run(t('home.copyingTheExampleName', { name: t(x.name) }), async (p) => {
    const r = await fetch(`/examples/${x.file}`);
    if (!r.ok) throw new Error(t('home.exampleNotFoundHttp', { status: r.status }));
    // shipped with the app, checked: their code never asks
    return importArchive(await r.blob(), p, { ask: null });
  });
  const menu = (e: MouseEvent | { clientX: number; clientY: number }, m: Manifest) => openMenu(e, [
    { label: t('common.open'), icon: 'folder', onClick: () => open(m.id) },
    { label: t('common.rename'), icon: 'edit', onClick: () => setDialog({ kind: 'rename', m }) },
    { label: t('common.duplicate'), icon: 'copy', onClick: async () => { try { await api.duplicate(m.id); refresh(); } catch (x) { toast(t('home.couldNotDuplicateError', { error: (x as Error).message }), 'error'); } } },
    { label: t('home.saveToComputerTramme'), icon: 'download', onClick: async () => {
      try {
        const r = await fetch(api.exportUrl(m.id));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await saveBlob(await r.blob(), `${safeName(m.name)}.tramme`);
      } catch (x) { toast(t('home.couldNotExportError', { error: (x as Error).message }), 'error'); }
    } },
    'sep',
    { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => setDialog({ kind: 'remove', m }) },
  ]);

  return (
    <div class={`home${drag ? ' dragging' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer) droppedOf(e.dataTransfer).then(openFiles).catch((x) => setDialog({ kind: 'failure', error: x as Error })); }}>
      <header class="home-top" {...windowBar}>
        <div class="brand"><LogoMark /><span>Tramme</span></div>
        <span class="grow" />
        {installable.value && <button class="btn outline sm" title={t('home.installAppHint')} onClick={install}><Icon name="download" /><span class="label">{t('home.installApp')}</span></button>}
        <HelpButton page="home" />
        <button class="icon-btn" data-tour="settings" title={t('common.settingsCtrl')} onClick={() => { settingsOpen.value = true; }}><Icon name="gear" /></button>
        {/* the other ways in: a blank project, a video to dress, a file to open */}
        <button class="btn outline sm" data-tour="home-more" onClick={(e) => openMenu((e.currentTarget as HTMLElement).getBoundingClientRect(), [
          { label: t('home.blankProject'), icon: 'plus', detail: t('home.blankProjectDetail'), onClick: () => setDialog({ kind: 'new' }) },
          { label: t('home.fromAVideo'), icon: 'film', detail: t('home.fromAVideoDetail'), onClick: () => video.current?.click() },
          'sep',
          { label: t('common.openAFile'), icon: 'upload', detail: t('home.openAFileDetail'), onClick: () => input.current?.click() },
        ])}><Icon name="plus" /><span class="label">{t('home.otherWays')}</span></button>
        <input ref={input} type="file" accept=".tramme,.trame,.emotion,.zip,.json,application/json" hidden onChange={(e) => openFiles(chosen(e))} />
        <input ref={video} type="file" accept="video/*,.mp4,.mov,.webm,.mkv" hidden onChange={(e) => openFiles(chosen(e))} />
        <WindowControls />
      </header>
      <main class="home-main">
        <DirectionBox busy={!!busy} onStart={start} />
        <section data-tour="home-projects">
          <div class="home-h">
            <h2>{t('home.yourFilms')}</h2>
            {projects && projects.length > 0 && <span class="faint">{projects.length}</span>}
            {projects && projects.length > 5 && (
              <span class="home-search"><Icon name="search" /><input value={query} placeholder={t('home.findAProject')} spellcheck={false}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)} /></span>
            )}
          </div>
          {/* personal mode: nothing is kept on the server, the user should know where the projects are */}
          {personal && <div class="home-note"><Icon name="info" /><span>{t('personal.storedHere')}</span></div>}
          {loadError && <div class="home-note err"><Icon name="alert" /><span>{t('home.projectsCannotBeRead', { error: loadError })}</span></div>}
          {!projects && !loadError && <div class="cards">{[0, 1, 2].map((i) => <div key={i} class="card ghost-card"><div class="card-thumb" /><div class="card-meta"><i /><i /></div></div>)}</div>}
          {projects && projects.length === 0 && <p class="faint" style={{ margin: '8px 0 0' }}>{t('home.noFilmsYet')}</p>}
          {projects && projects.length > 0 && (() => {
            const q = query.trim().toLowerCase();
            const shown = q ? projects.filter((m) => m.name.toLowerCase().includes(q)) : projects;
            if (!shown.length) return <p class="faint" style={{ margin: '8px 0 0' }}>{t('home.noProjectNamed', { query: query.trim() })}</p>;
            return <div class="cards">{shown.map((m) => <Card key={m.id} m={m} onMenu={(e) => menu(e, m)} />)}</div>;
          })()}
        </section>
        {examples.length > 0 && (
          <section data-tour="home-examples">
            <div class="home-h"><h2>{t('home.examples')}</h2><span class="faint">{t('home.aCopyBecomesYour')}</span></div>
            <div class="examples">
              {examples.map((x) => (
                <button key={x.file} class="example card interactive" onClick={() => useExample(x)}>
                  <span class="example-thumb">{x.thumbnail ? <img src={`/examples/${x.thumbnail}`} alt="" loading="lazy" /> : <span class="frame" style={{ aspectRatio: `${x.width} / ${x.height}` }}><Icon name="film" /></span>}</span>
                  <span class="example-text" title={t(x.description)}><b>{t(x.name)}</b><span class="faint example-about">{t(x.description)}</span><span class="faint mono">{dims(x)}</span></span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      {drag && <div class="drop-hint"><Icon name="upload" /><span>{t('home.dropATrammeProject')}</span></div>}
      {busy && (
        <div class="modal-back"><div class="modal">
          <div class="modal-body">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="spinner" /><span>{busy.label}</span></div>
            <div class="progress"><i style={{ width: `${(100 * busy.done) / Math.max(1, busy.total)}%` }} /></div>
            <div class="faint mono" style={{ fontSize: 11 }}>{busy.bytes ? t('home.doneTotalMb', { done: (busy.done / 1e6).toFixed(1), total: (busy.total / 1e6).toFixed(1) }) : t('home.doneTotalFileS', { done: busy.done, total: busy.total })}</div>
          </div>
        </div></div>
      )}
      {dialog?.kind === 'new' && <NewProject onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rename' && <Rename project={dialog.m} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'remove' && <Remove project={dialog.m} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'failure' && <Failure error={dialog.error} onClose={() => setDialog(null)} />}
      <Overlays />
    </div>
  );
}
