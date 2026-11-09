// The assistant's tools, run here in the editor whichever way Claude is
// reached: the document (with the assistant's pending proposal applied), the
// node vocabulary, the engine's values, stills from the same renderer, the
// project's text files, and the tools its plugins bring. The document itself
// only changes through proposals the user applies.

import { copiesFor, copyId, installedTypes, sandboxedDoc } from '../installed.ts';
import { applyOps, getAt, isTranscript, pointer, remapTranscript, silences, toolInputIssues, toolOutput, validate, type TrammeDoc, type Op, type Registry, type ToolContext, type Transcript } from '@tramme/core';
import { editorEvaluator } from '../evaluator.ts';
import { DOCUMENT, isChatPath, MANIFEST, pathIssue, srcPath } from '@tramme/project';
import { VideoFrames } from '@tramme/render';
import { Stills } from '../frames.ts';
import type { ToolResult } from '@tramme/assistant';
import { inputIssues, vocabularyDetail, vocabularyIndex } from './answers.ts';
import { uid } from './calls.ts';
import { api, type AiEvent } from '../api.ts';
import { describeOp, freshId } from '../model.ts';
import { analyses, jpegOf, loadImage } from '../perception.ts';
import { fileProject, requireFileProject, sameFileProject, safeName } from '../files.ts';
import { transcriptFor, transcriptIdOf } from '../speech.ts';
import { placeTemplate, TEMPLATES } from '../templates.ts';
import { S } from '../state.ts';
import { t } from '../i18n/index.ts';
import { readProjectText } from '../plugins/read-project-text.ts';
import { approvedProjectResource, readLimitedBody } from '../plugins/host.ts';
import { pluginHost } from '../plugins/index.ts';
import { ensureDeclared, ensureSandboxDoc, moduleItemsOf } from '../plugins/sandbox-draw.ts';
import { preview } from '../preview.ts';
import { prefs } from '../settings.ts';

const text =(s: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: s }], isError });
const STILL_WIDTH = 768;
const TEXT_FILE = /\.(js|mjs|json|svg|md|markdown)$/i;
/** a file read in parts of this many characters (about 15k tokens) */
const READ_PART = 50_000;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

/** what a scene builder may change: its own composition (and its takes), under a root it must leave alone; `tokens` are the existing tokens it may change */
export interface Scope { comp: string; root: string; tokens: string[] }

/** a path as its parts, the ~0 and ~1 of a pointer undone */
const partsOf = (path: string) => path.split('/').filter(Boolean).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));

/**
 * Why an operation is not a scene builder's to make, or null when it is: the
 * scene's composition and its takes, compositions, assets and tokens of its own
 * (a component it defines, a colour it adds, changed again later), the plan's
 * record, plugins added. Another scene's composition, the root, and an asset or
 * a token that existed before the scene are refused. `doc` is the document as
 * it was when the scene began.
 */
export function outOfScope(op: Op, scope: Scope, doc: TrammeDoc): string | null {
  const [section, id] = partsOf(op.path);
  if (section === 'compositions') {
    if (id === scope.comp || (id !== undefined && (id.startsWith(`${scope.comp}~take`) || !doc.compositions[id]))) return null;
    if (id === scope.root) return `the root composition "${id}" is not yours: scenes are laid by the director, build only "${scope.comp}"`;
    return id === undefined ? 'the compositions as a whole are not yours' : `the composition "${id}" belongs to another scene: build only "${scope.comp}"`;
  }
  if (section === 'assets' || section === 'tokens') {
    if (id === undefined) return `all the ${section} at once are not yours`;
    if (section === 'assets' && id === 'film-plan') return null;
    const had = (doc as unknown as Record<string, Record<string, unknown> | undefined>)[section]?.[id] !== undefined;
    return had && !(section === 'tokens' && scope.tokens.includes(id)) ? `the ${section.slice(0, -1)} "${id}" existed before this scene: add one of your own instead` : null;
  }
  if (section === 'plugins' && op.op === 'add') return null;
  return `"${op.path}" is not part of a scene`;
}

interface Pending { id: string; label: string; ops: Op[]; steps: string[] }

export class ToolRunner {
  pending: Pending | null = null;
  private scoped: Scope | null = null;
  /** the proposal as it stood when the scene began: all a discard in the scene goes back to */
  private before: Pending | null = null;
  /** the document as it stood when the scene began: what is not in it is the scene's own */
  private base: TrammeDoc | null = null;
  /** set while a scene is built apart: the proposals are kept to it, and its tools work on its composition */
  get scope(): Scope | null { return this.scoped; }
  set scope(s: Scope | null) {
    this.scoped = s;
    this.before = s && this.pending ? { ...this.pending, ops: [...this.pending.ops], steps: [...this.pending.steps] } : null;
    this.base = s ? this.liveDoc() : null;
  }
  /** the composition the tools work on by default: the scene's while one is built apart, else the one on screen, else the root */
  private compOf(doc: TrammeDoc): string {
    if (this.scoped && doc.compositions[this.scoped.comp]) return this.scoped.comp;
    return doc.compositions[S.compId.peek()] ? S.compId.peek() : doc.root;
  }
  /** the turn's signal, handed to the plugins' tools */
  private signal: AbortSignal = new AbortController().signal;
  /** the last plugin tool's message for the user */
  notice = '';
  /** the last tool's own notice (not its text), shown on its activity line */
  told = '';
  /** stills drawn on a renderer of their own (never the preview's) */
  private stills = new Stills();
  /** events for the conversation (images, proposals, reloads), read after each tool */
  events: AiEvent[] = [];
  /** where a running tool reports how far it is (set by the call that runs it) */
  onProgress: ((done: number, total: number, step?: string) => void) | null = null;
  /** the calls run so far (a turn's count is the difference) */
  calls = 0;
  /** the plugin files this turn wrote (the user is told of them at its end) */
  wrotePlugins = new Set<string>();

  /** the document the tools see: the user's, plus the pending proposal */
  liveDoc(): TrammeDoc {
    const doc = S.doc.peek();
    if (!this.pending) return doc;
    try { return applyOps(doc, this.pending.ops).doc; } catch { return doc; }
  }

  /** the vocabulary of a document: the editor's when its plugins are the same */
  private async registry(doc: TrammeDoc): Promise<Registry> {
    const cur = S.doc.peek();
    // a copy of a pack or an installed plugin the editor has attached (its id, its file) brings nothing its registry lacks
    const copies = new Map([...installedTypes.values()].map((p) => [copyId(p), `plugins/${p.file}`])), had = new Set(cur.plugins ?? []);
    const own = (doc.plugins ?? []).filter((id) => had.has(id) || copies.get(id) !== doc.assets[id]?.src);
    const same = JSON.stringify(own) === JSON.stringify(cur.plugins ?? []) && own.every((id) => doc.assets[id]?.src === cur.assets[id]?.src);
    return same ? S.registry.peek() : (await this.stills.rendererFor(doc)).registry;
  }

  /** the user applied or refused the proposal, or wrote a new message without deciding (what a scene's discard went back to is gone with it) */
  clear() { this.pending = null; this.before = null; }

  dispose() { this.stills.dispose(); for (const v of this.videos.values()) v.then((x) => x.dispose()).catch(() => {}); this.videos.clear(); }

  // ── video dressing ───────────────────────────────────────────
  private videos = new Map<string, Promise<VideoFrames>>();
  private urlOf(src: string) {
    if (pathIssue(src) || /[%#]/.test(src) || !src.startsWith('assets/')) throw new Error(`${src}: media must be a project asset`);
    const base = new URL(S.docUrl.peek(), location.href), root = new URL('./', base), url = new URL(src, base);
    if (!approvedProjectResource(url, root.pathname, root.origin, root.protocol)) throw new Error(`${src}: media must belong to this project`);
    return url.href;
  }

  /** a transcript: of the asset itself (json), or of a sound or video (when missing, the user is asked to make it, if `ask`) */
  private async readTranscript(assetId: string, ask = true): Promise<{ t: Transcript; id: string }> {
    const project = fileProject();
    const doc = this.liveDoc(), a = doc.assets[assetId];
    if (!a) throw new Error(`unknown asset: ${assetId}`);
    let id = assetId;
    if (a.type === 'audio' || a.type === 'video') id = await transcriptFor(assetId, ask);
    else if (a.type !== 'json') throw new Error(`${assetId}: a sound, a video or a transcript is expected`);
    requireFileProject(project);
    const entry = S.doc.peek().assets[id] ?? doc.assets[id];
    const path = entry?.src;
    if (!path || pathIssue(path) || /[%#]/.test(path) || !path.startsWith('assets/')) throw new Error(`${id}: transcript must be a project asset`);
    const base = new URL(project.docUrl, location.href), root = new URL('./', base);
    const url = new URL(path, base);
    if (!approvedProjectResource(url, root.pathname, root.origin, root.protocol)) throw new Error(`${id}: transcript must belong to this project`);
    const r = await fetch(url.href, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${id}: transcript could not be read (HTTP ${r.status})`);
    const t = JSON.parse(new TextDecoder().decode(await readLimitedBody(r, MAX_TRANSCRIPT_BYTES, 'transcript')));
    requireFileProject(project);
    if (!isTranscript(t)) throw new Error(`${id} is not a transcript`);
    return { t, id };
  }

  private async transcript(assetId: string, from?: number, to?: number, words = false): Promise<ToolResult> {
    const { t, id } = await this.readTranscript(assetId);
    const lo = typeof from === 'number' ? from : 0, hi = typeof to === 'number' ? to : Infinity;
    const ws = t.words.filter((w) => w.e > lo && w.s < hi);
    // sentences: a pause or a sentence end closes one
    const lines: string[] = [];
    let cur: typeof ws = [];
    const flush = () => {
      if (!cur.length) return;
      const body = words ? cur.map((w) => `${w.w}@${w.s.toFixed(2)}`).join(' ') : cur.map((w) => w.w).join(' ');
      lines.push(`[${cur[0].s.toFixed(2)}-${cur[cur.length - 1].e.toFixed(2)}] ${body}`);
      cur = [];
    };
    ws.forEach((w, i) => { if (cur.length && w.s - ws[i - 1].e > 0.6) flush(); cur.push(w); if (/[.!?…]$/.test(w.w)) flush(); });
    flush();
    const pauses = silences(t, 0.7).filter((p) => p.to > lo && p.from < hi).map((p) => `${p.from.toFixed(2)}-${p.to.toFixed(2)}`);
    const fillers = ws.filter((w) => /^(euh+|heu+|hum+|bah|ben|uh+|um+|erm)[,.]?$/i.test(w.w)).map((w) => `${w.w}@${w.s.toFixed(2)}`);
    const head = `Transcript "${id}": ${t.language ?? 'language?'}, ${t.duration.toFixed(2)} s, ${t.words.length} words, ${t.keeps ? 'composition time (edit)' : 'file time'}.`;
    return text([head, pauses.length ? `Pauses longer than 0.7 s: ${pauses.join(', ')}` : 'No pause longer than 0.7 s.', fillers.length ? `Hesitations: ${fillers.join(', ')}` : '', '', ...lines].filter((l, i) => l || i === 3).join('\n'));
  }

  private async mediaFrame(assetId: string, t: number): Promise<ToolResult> {
    const project = fileProject();
    const a = this.liveDoc().assets[assetId];
    if (!a) return text(`unknown asset: ${assetId}`, true);
    let source: CanvasImageSource, w: number, h: number;
    if (a.type === 'image') {
      const img = await loadImage(this.urlOf(a.src));
      requireFileProject(project);
      source = img; w = img.naturalWidth; h = img.naturalHeight;
    } else if (a.type === 'video') {
      const key = `${project.id}\0${project.docUrl}\0${assetId}`;
      let v = this.videos.get(key);
      if (!v) { v = VideoFrames.open(this.urlOf(a.src)); this.videos.set(key, v); }
      const frames = await v;
      requireFileProject(project);
      await frames.request(t);
      requireFileProject(project);
      const f = frames.frameAt(t);
      if (!f.image) return text(`no frame at ${t} s`, true);
      source = f.image; w = frames.width; h = frames.height;
    } else return text(`${assetId}: a video or an image is expected`, true);
    requireFileProject(project);
    const url = jpegOf(source, w, h, Math.min(1, STILL_WIDTH / w));
    this.events.push({ type: 'item', item: { id: uid(), role: 'assistant', image: { url, caption: `${a.name ?? assetId}${a.type === 'video' ? ` · ${t.toFixed(2)} s` : ''}` } } });
    return { content: [{ type: 'image', data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' }] };
  }

  /** an edit of a media: the parts kept laid end to end, the transcript remapped, the captions rewired */
  private async cut(input: any): Promise<ToolResult> {
    const project = fileProject();
    const doc = this.liveDoc(), assetId = String(input.asset ?? ''), a = doc.assets[assetId];
    if (!a || (a.type !== 'video' && a.type !== 'audio')) return text('a sound or video asset is expected', true);
    const keeps = (input.keeps as { from: number; to: number }[]).map((k) => ({ from: Math.max(0, Number(k.from)), to: Number(k.to) })).filter((k) => k.to > k.from + 0.04);
    if (!keeps.length) return text('no passage to keep', true);
    const compId = input.compId && doc.compositions[input.compId] ? input.compId : S.compId.peek() in doc.compositions ? S.compId.peek() : doc.root;
    const c = doc.compositions[compId], at = Number(input.at ?? 0);
    const prop = a.type === 'video' ? 'video' : 'audio';
    const olds = c.order.filter((id) => c.layers[id]?.type === a.type && (c.layers[id].props?.[prop] as unknown) === assetId);
    const model = olds.length ? c.layers[olds[0]] : null;
    const ops: Op[] = [];
    const layers = { ...c.layers };
    for (const id of olds) { ops.push({ op: 'remove', path: pointer('compositions', compId, 'layers', id) }); delete layers[id]; }
    const order = c.order.filter((id) => !olds.includes(id));
    const ids: string[] = [];
    let cursor = at;
    keeps.forEach((k, i) => {
      const id = freshId(layers, `${a.type === 'video' ? 'take' : 'sound'}-${i + 1}`);
      layers[id] = {} as never;
      const len = k.to - k.from;
      const layer = model
        ? { ...model, name: `${a.name ?? assetId} · ${i + 1}`, in: +cursor.toFixed(4), out: +(cursor + len).toFixed(4), props: { ...model.props, [prop]: assetId, start: +k.from.toFixed(4) } }
        : { type: a.type, name: `${a.name ?? assetId} · ${i + 1}`, in: +cursor.toFixed(4), out: +(cursor + len).toFixed(4), ...(a.type === 'video' ? { transform: { position: [c.width / 2, c.height / 2] } } : {}), props: { [prop]: assetId, start: +k.from.toFixed(4), ...(a.type === 'video' ? { size: [c.width, c.height], fit: 'cover' } : {}) } };
      ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', id), value: layer });
      ids.push(id);
      cursor += len;
    });
    // the edit at the bottom, where the media was
    const first = model ? c.order.indexOf(olds[0]) : 0;
    order.splice(Math.max(0, Math.min(order.length, first)), 0, ...ids);
    ops.push({ op: 'replace', path: pointer('compositions', compId, 'order'), value: order });
    if (input.fitDuration !== false) ops.push({ op: 'replace', path: pointer('compositions', compId, 'duration'), value: +cursor.toFixed(3) });
    // the transcript of the edit, the captions on it
    let note = '';
    try {
      const { t, id: srcId } = await this.readTranscript(assetId, false);
      requireFileProject(project);
      const remapped = remapTranscript(t, keeps, at);
      const editId = `${transcriptIdOf(assetId)}-edit`.slice(0, 64);
      const path = `assets/transcripts/${safeName(`${assetId}-edit.json`)}`;
      await api.write(project.id, path, new Blob([JSON.stringify(remapped)], { type: 'application/json' }));
      requireFileProject(project);
      ops.push({ op: doc.assets[editId] ? 'replace' : 'add', path: pointer('assets', editId), value: { type: 'json', src: path, name: `Transcript · ${a.name ?? assetId} · edit` } });
      for (const [id, l] of Object.entries(c.layers)) {
        if (l.type === 'captions' && (l.props?.transcript === srcId || l.props?.transcript === editId)) {
          ops.push({ op: 'replace', path: pointer('compositions', compId, 'layers', id, 'props', 'transcript'), value: editId });
          ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', id, 'props', 'start'), value: 0 });
        }
      }
      // an edit made again: same file, new content
      if (S.doc.peek().assets[editId]) this.events.push({ type: 'reload', assets: [editId] });
      note = ` Transcript of the edit: asset "${editId}" (${remapped.words.length} words, composition time); place the captions, keywords and titles with it.`;
    } catch (e) { note = ` (transcript of the edit not made: ${(e as Error).message})`; }
    if (!sameFileProject(project)) return text('the project changed while the tool was running', true);
    const total = cursor - at;
    const r = await this.propose(t('ai.editOfName', { name: a.name ?? assetId }), ops, () => sameFileProject(project));
    if (r.isError) return r;
    return text(`Edit: ${keeps.length} passage(s), ${total.toFixed(2)} s kept, layers ${ids.join(', ')} from ${at.toFixed(2)} to ${cursor.toFixed(2)} s.${note}
${r.content[0].type === 'text' ? r.content[0].text : ''}`);
  }

  async run(name: string, input: any, signal?: AbortSignal): Promise<ToolResult> {
    this.signal = signal ?? new AbortController().signal;
    this.calls++;
    this.told = '';
    // the model reads the error and calls again rather than the tool guessing
    const issues = inputIssues(name, input);
    if (issues.length) return text(`input refused by ${name}:\n${issues.join('\n')}`, true);
    try {
      switch (name) {
        case 'get_document': {
          const doc = this.liveDoc();
          if (!input.path) return text(JSON.stringify(doc));
          const part = getAt(doc, String(input.path));
          return part === undefined ? text(`nothing at ${input.path} in the document`, true) : text(JSON.stringify(part));
        }
        case 'list_nodes': {
          const project = fileProject();
          const reg = await this.registry(this.liveDoc());
          requireFileProject(project);
          // the installed plugins' entries: tools by where they come from, the rest by the types they brought
          const installed = (section: string, name: string, from?: string) => (section === 'tools' ? !!from && (from.startsWith('installed:') || from.startsWith('packs:')) : installedTypes.has(`${section.slice(0, -1)}:${name}`));
          return text(Array.isArray(input.types) && input.types.length ? vocabularyDetail(reg, input.types.map(String)) : vocabularyIndex(reg, { query: typeof input.query === 'string' ? input.query : undefined, installed }));
        }
        case 'evaluate': {
          const project = fileProject();
          const doc = this.liveDoc(), reg = await this.registry(doc);
          requireFileProject(project);
          // the analyses and event lists reach the expressions that read them
          const data = await analyses(this.toolContext(doc, reg));
          requireFileProject(project);
          const compId = input.compId ?? (this.scoped ? this.compOf(doc) : doc.root);
          if (prefs.peek().sandboxPreview || sandboxedDoc(doc)) {
            const renderer = preview.renderer;
            if (!renderer) throw new Error('preview is not ready for isolated evaluation');
            const base = new URL(project.docUrl, location.href).href;
            const host = pluginHost(base);
            await ensureDeclared(host, moduleItemsOf(doc, base));
            requireFileProject(project);
            ensureSandboxDoc(host, { doc, docUrl: base, loaded: (id) => { try { return renderer.assets.get(id) ?? data(id); } catch { return data(id); } } });
            const value = await host.evaluateValue(String(input.address), Number(input.t), compId);
            requireFileProject(project);
            return text(JSON.stringify(value));
          }
          return text(JSON.stringify(editorEvaluator(doc, reg, { data }).value(String(input.address), Number(input.t), compId)));
        }
        case 'render_still': return await this.still(Number(input.t), input.compId, input.caption);
        case 'propose_changes': return await this.propose(String(input.label ?? 'Change'), input.ops as Op[]);
        case 'discard_proposal': {
          // a scene builder drops its own changes: the director's root and the scenes built before it stay proposed
          if (this.scoped && this.before) {
            this.pending = { ...this.before, ops: [...this.before.ops], steps: [...this.before.steps] };
            this.events.push({ type: 'proposal', id: this.pending.id, label: this.pending.label, ops: this.pending.ops });
            return text('Your changes to this scene are dropped; the rest of the film (the root and the other scenes) is kept as proposed.');
          }
          if (this.pending) this.events.push({ type: 'proposal-clear', id: this.pending.id });
          this.pending = null;
          return text('Proposal dropped.');
        }
        case 'list_files': {
          const project = fileProject();
          const { files } = await api.info(project.id);
          requireFileProject(project);
          return text(files.map((f) => `${f.path}\t${f.size} bytes`).join('\n') || '(no files)');
        }
        case 'read_file': return await this.read(String(input.path ?? ''), Number(input.offset ?? 0));
        case 'write_file': return await this.write(String(input.path ?? ''), String(input.content ?? ''));
        case 'get_transcript': return await this.transcript(String(input.asset ?? ''), input.from, input.to, !!input.words);
        case 'media_frame': return await this.mediaFrame(String(input.asset ?? ''), Number(input.t ?? 0));
        case 'cut_media': return await this.cut(input);
        case 'use_tool': return await this.useTool(String(input.name ?? ''), input.input ?? {});
        case 'apply_template': {
          const tpl = TEMPLATES[String(input.template)];
          if (!tpl) return text(`unknown template: ${input.template} (${Object.keys(TEMPLATES).join(', ')})`, true);
          const doc = this.liveDoc(), compId = input.compId && doc.compositions[input.compId] ? input.compId : this.compOf(doc);
          const { label, ops } = placeTemplate(doc, compId, String(input.template), { at: Number(input.at ?? 0), duration: input.duration, text: input.text, subtitle: input.subtitle, transcript: input.transcript, place: input.place });
          return await this.propose(label, ops);
        }
        default: return text(`unknown tool: ${name}`, true);
      }
    } catch (e) {
      return text((e as Error).message, true);
    }
  }

  /** a still of the live document, as a JPEG data URL */
  private stillUrl(t: number, compId?: string): Promise<string> {
    const doc = this.liveDoc();
    return this.stills.still(doc, t, compId && doc.compositions[compId] ? compId : this.scoped ? this.compOf(doc) : doc.root, STILL_WIDTH);
  }

  private async still(t: number, compId: string | undefined, caption?: string): Promise<ToolResult> {
    const project = fileProject();
    const url = await this.stillUrl(t, compId);
    requireFileProject(project);
    this.events.push({ type: 'item', item: { id: uid(), role: 'assistant', image: { url, caption: `${t.toFixed(2)} s${caption ? ` · ${caption}` : ''}` } } });
    return { content: [{ type: 'image', data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' }] };
  }

  // ── tools brought by the project's plugins ───────────────────
  private toolContext(doc: TrammeDoc, registry: Registry): ToolContext {
    const compId = this.compOf(doc);
    // A worker can ask for a capability after the user has opened another
    // project. Bind every bridge operation to the project that started it.
    const projectId = S.project.peek().id, docUrl = S.docUrl.peek();
    const current = () => {
      if (S.project.peek()?.id !== projectId || S.docUrl.peek() !== docUrl) throw new Error('the project changed while the tool was running');
    };
    const urlOf = (src: string) => {
      current();
      const base = new URL(docUrl, location.href), root = new URL('./', base);
      const url = new URL(src, base);
      if (!approvedProjectResource(url, root.pathname, root.origin, root.protocol)) throw new Error(`${src}: asset must belong to this project`);
      return url.href;
    };
    const projectPath = (path: string) => {
      current();
      const bad = pathIssue(path);
      if (bad || /[%#]/.test(path)) throw new Error(`${path}: ${bad ?? 'invalid project path'}`);
      return path;
    };
    const assetPath = (path: string) => {
      projectPath(path);
      if (!path.startsWith('assets/')) throw new Error(`${path}: tools can read project assets only`);
      return path;
    };
    return {
      doc, compId, registry,
      time: S.time.peek(),
      selection: S.selection.peek().filter((id) => doc.compositions[compId].layers[id]),
      assetUrl: (id) => { current(); const a = doc.assets[id]; if (!a) throw new Error(`unknown asset: ${id}`); const url = urlOf(a.src); assetPath(a.src); return url; },
      readText: async (path) => { const value = await readProjectText(projectId, assetPath(path)); current(); return value; },
      files: async () => { current(); const value = (await api.info(projectId)).files.filter(({ path }) => path.startsWith('assets/') && !pathIssue(path) && !/[%#]/.test(path)).map(({ path, size }) => ({ path, size })); current(); return value; },
      fileUrl: (path) => urlOf(assetPath(path)),
      writeFile: async (path, data) => {
        current();
        const bad = pathIssue(path) ?? (path.includes('%') ? 'invalid project path' : null);
        const plugin = /^plugins\/.+\.(js|mjs)$/i.test(path);
        if (bad || (!path.startsWith('assets/') && !plugin)) throw new Error(`${path}: ${bad ?? 'a tool writes under assets/, or a plugin under plugins/'}`);
        // a computed video (a cut-out mask) may pass the single request limit: sent in parts
        if (typeof data === 'string') await api.write(projectId, path, new Blob([data], { type: plugin ? 'text/javascript' : /\.json$/i.test(path) ? 'application/json' : 'text/plain' }));
        else await api.writeAny(projectId, path, data);
        current();
        if (plugin) this.wrotePlugins.add(path);
        return path;
      },
      renderStill: (t, id) => { current(); return this.stillUrl(t, id).then((value) => { current(); return value; }); },
      transcript: async (id, opts) => { current(); const value = (await this.readTranscript(id, opts?.ask ?? true)).t; current(); return value; },
      signal: this.signal,
      // a plugin's figures are not trusted: what is not a number is shown as a step without a share
      progress: (done, total, step) => this.onProgress?.(Number.isFinite(done) ? done : 0, Number.isFinite(total) ? total : 0, typeof step === 'string' ? step : undefined),
    };
  }

  /** a tool of the project's plugins: its text and images for the assistant, its operations added to the proposal */
  private async useTool(name: string, input: unknown): Promise<ToolResult> {
    this.notice = '';
    const projectId = S.project.peek().id, docUrl = S.docUrl.peek();
    const current = () => S.project.peek()?.id === projectId && S.docUrl.peek() === docUrl;
    const changed = () => text('the project changed while the tool was running', true);
    const doc = this.liveDoc(), reg = await this.registry(doc);
    if (!current()) return changed();
    if (!reg.hasTool(name)) {
      const names = reg.listTools().map((e) => e.tool.name);
      return text(`unknown tool: ${name}. ${names.length ? `Tools of this project: ${names.join(', ')}.` : 'This project has no tools (list_nodes).'}`, true);
    }
    const { tool, from } = reg.tool(name);
    const issues = toolInputIssues(tool.input, input);
    if (issues.length) return text(`input refused by ${name}:\n${issues.join('\n')}`, true);
    let out;
    // a plugin brought from the library is no plugin written in this turn: it is not offered back to it
    const brought = name === 'library-use' ? new Set(this.wrotePlugins) : null;
    try { out = toolOutput(await tool.run(input, this.toolContext(doc, reg))); if (!current()) return changed(); if (brought) this.wrotePlugins = brought; }
    catch (e) { if (this.signal.aborted) return text(`${name}: stopped by the user`, true); return text(`${name} (plugin ${from}) failed: ${(e as Error).message}`, true); }
    const content: ToolResult['content'] = [];
    for (const img of out.images ?? []) {
      const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(img.url);
      if (!m) continue;
      this.events.push({ type: 'item', item: { id: uid(), role: 'assistant', image: { url: img.url, caption: img.caption ?? tool.title ?? name } } });
      content.push({ type: 'image', data: img.url.slice(m[0].length), mimeType: m[1] });
    }
    if (out.reload?.length) this.events.push({ type: 'reload', assets: out.reload });
    // what the user reads after running it from the / menu: its notice, or its text when no proposal card shows the result
    this.notice = out.notice ?? (out.ops?.length ? '' : out.text ?? '');
    this.told = out.notice ?? '';
    const lines = out.text ? [out.text] : [];
    if (out.ops?.length) {
      const r = await this.propose(out.label ?? tool.title ?? name, out.ops, current);
      const said = r.content[0]?.type === 'text' ? r.content[0].text : '';
      if (r.isError) return text([said, ...lines].join('\n'), true);
      lines.push(said);
    }
    content.unshift({ type: 'text', text: lines.join('\n') || `${name}: done.` });
    return { content };
  }

  private async propose(label: string, ops: Op[], current?: () => boolean): Promise<ToolResult> {
    const project = fileProject();
    current ??= () => sameFileProject(project);
    const changed = () => text('the project changed while the tool was running', true);
    if (!current()) return changed();
    if (!Array.isArray(ops) || !ops.length) return text('no operations', true);
    if (this.scope) {
      // judged against the document as the scene found it: what the scene added itself stays its own
      const base = this.base ?? this.liveDoc();
      for (const op of ops) { const why = outOfScope(op, this.scope, base); if (why) return text(`operation refused, nothing is proposed: ${why}`, true); }
    }
    let merged = [...(this.pending?.ops ?? []), ...ops];
    // a layer, an effect or a modifier of a pack (or of an installed plugin): its plugin joins the proposal now, its files
    // written, so the stills, the check and the motion tool draw what is proposed; applying it then copies nothing more
    let copied: string[] = [];
    const copies = copiesFor(S.doc.peek(), merged);
    if (copies) {
      const id = S.project.peek().id;
      try { await Promise.all(copies.files.map(([path, blob]) => api.write(id, path, blob, blob.type ? { type: blob.type } : {}))); }
      catch (e) { return text(`the plugin ${copies.names.join(', ')} could not be copied into the project, nothing is proposed: ${(e as Error).message}`, true); }
      if (!current()) return changed();
      merged = copies.ops;
      copied = copies.names;
    }
    let next: TrammeDoc;
    try { next = applyOps(S.doc.peek(), merged).doc; } catch (e) { return text(`operations refused: ${(e as Error).message}`, true); }
    const issues = validate(next, await this.registry(next));
    if (!current()) return changed();
    if (issues.length) return text(`invalid document after these operations, nothing is proposed:\n${issues.slice(0, 30).map((i) => `${i.path}: ${i.message}`).join('\n')}`, true);
    // several steps in one proposal: each one named
    const steps = [...new Set([...(this.pending?.steps ?? []), label])];
    const all = steps.join(' · ');
    this.pending = { id: this.pending?.id ?? uid(), label: all.length > 90 ? `${steps[0]} and ${steps.length - 1} more step(s)` : all, ops: merged, steps };
    this.events.push({ type: 'proposal', id: this.pending.id, label: this.pending.label, ops: merged });
    return text(`Proposal "${this.pending.label}" ready (${merged.length} operations in all). The user sees it as a preview.${copied.length ? ` ${copied.join(', ')} came into the project with it (its plugin and files), so the stills and the checks draw it.` : ''}`);
  }

  private async read(path: string, offset = 0): Promise<ToolResult> {
    const project = fileProject();
    if (path === DOCUMENT) return text('read the document with get_document', true);
    const bad = pathIssue(path) ?? (/%|#/.test(path) ? 'invalid project path' : null);
    if (bad) return text(`${path}: ${bad}`, true);
    if (!TEXT_FILE.test(path) || path === MANIFEST || isChatPath(path)) return text('only .js, .mjs, .json, .svg and .md text files can be read', true);
    const body = await readProjectText(project.id, path);
    requireFileProject(project);
    if (body === null) return text(`file not found: ${path}`, true);
    if (offset === 0 && body.length <= READ_PART) return text(body);
    if (offset >= body.length) return text(`${path} has ${body.length} characters: nothing from ${offset}`, true);
    const end = Math.min(body.length, offset + READ_PART);
    const more = end < body.length ? `; the rest from offset ${end}` : '; end of the file';
    return text(`[${path}: characters ${offset} to ${end} of ${body.length}${more}]\n${body.slice(offset, end)}`);
  }

  private async write(path: string, content: string): Promise<ToolResult> {
    const project = fileProject();
    const bad = pathIssue(path) ?? (/%|#/.test(path) ? 'invalid project path' : null);
    if (bad) return text(`${path}: ${bad}`, true);
    const ok = (/^plugins\/.+\.(js|mjs)$/i.test(path)) || (/^assets\/.+\.(json|svg)$/i.test(path));
    if (!ok) return text('allowed writes: plugins/*.js|mjs and assets/*.json|svg. The document changes through propose_changes.', true);
    await api.write(project.id, path, content, { type: /\.(js|mjs)$/i.test(path) ? 'text/javascript' : undefined });
    requireFileProject(project);
    if (path.startsWith('plugins/')) this.wrotePlugins.add(path);
    // a plugin in use is loaded again in the preview
    const assets = Object.entries(S.doc.peek().assets).filter(([, a]) => srcPath(a.src) === path).map(([id]) => id);
    if (assets.length) this.events.push({ type: 'reload', assets });
    return text(`${path} written (${content.length} characters).`);
  }
}

/** a one-line summary of an op, for the proposal card */
export const opLine = (o: Op) => `${o.op}\t${describeOp(S.doc.peek(), o)}`;
