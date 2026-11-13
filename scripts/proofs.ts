// A feature's proof, made again from its manifest (docs/proofs-roadmap.md):
//   node scripts/proofs.ts <id> [--editor http://localhost:8790]
// apps/site/proofs/<id>/proof.json names the source (its address, its hash,
// its licence), the part used, the effects of the after, and the tools of
// the editor to run on it. The script downloads the source into
// out/proofs/<id>/ (never committed; the hash checked, written the first
// time), runs the tools in the editor when the proof has some (the trial
// server, see the editor-trial-server note: `--var DEV_OPEN:1`, its own
// state), renders before and after with the command line, puts them side
// by side or under a sweeping line in one Tramme document, and writes what
// the site shows: the two stills (src/assets/proofs/<id>-before.jpg and
// -after.jpg), the clip (src/videos/proof-<id>.webm, .mp4, .webp), and for a
// sound proof the two sounds (src/audio/proof-<id>-before.mp3, -after.mp3)
// with their waveforms as the stills. Run again, it gives the same files.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'apps/site');
const ffmpeg: string = createRequire(path.join(ROOT, 'packages/cli/package.json'))('ffmpeg-static');
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const id = args.find((a) => !a.startsWith('--') && a !== flag('editor'));
if (!id) { console.error('usage: node scripts/proofs.ts <id> [--editor http://localhost:8790]'); process.exit(1); }

type L = { en: string; fr: string };
/** a step in the editor: a tool run (its proposal accepted), a media transcribed as its button does, or operations applied ($comp is the composition) */
type Step = { tool: string; input: Record<string, unknown> } | { transcribe: string } | { ops: Record<string, unknown>[] };
interface Manifest {
  id: string; kind: 'picture' | 'sound'; compare: 'sweep' | 'side' | 'after'; name: L;
  /** the clip keeps the sound of the after (the before plays muted beside it) */
  sound?: boolean;
  source: { page: string; file: string; sha256?: string; type: 'video' | 'image' | 'audio'; author: string; licence: string; licenceUrl: string; start?: number; duration: number; width?: number; height?: number };
  still: number;
  /** the after's layer: its effects, and props over the source layer's */
  after?: { effects?: { type: string; props?: Record<string, unknown> }[]; props?: Record<string, unknown>; below?: Record<string, unknown>[]; above?: Record<string, unknown>[] };
  /** the before keeps the layers put above the source (the same title, over the clip rather than behind its subject) */
  beforeKeepsAbove?: boolean;
  /** tools of the editor run on the after, in order ($layer is the source's layer, $asset its file) */
  editor?: Step[];
}
type Doc = { schema: string; meta: { title: string }; tokens: object; assets: Record<string, { type: string; src: string }>; root: string; compositions: Record<string, any> };

const manifestFile = path.join(SITE, 'proofs', id, 'proof.json');
const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Manifest;
const dir = path.join(ROOT, 'out/proofs', id);
fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
const W = m.source.width ?? 1920, H = m.source.height ?? 1080, DUR = m.source.duration;
const run = (file: string, a: string[]) => execFileSync(file, a, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 }).toString();
const cli = (...a: string[]) => run(process.execPath, [path.join(ROOT, 'packages/cli/src/main.ts'), ...a]);
const ff = (...a: string[]) => run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

// ── the source ───────────────────────────────────────────────
async function source(): Promise<string> {
  const ext = path.extname(new URL(m.source.file).pathname) || { video: '.mp4', image: '.jpg', audio: '.wav' }[m.source.type];
  const file = path.join(dir, 'assets', `source${ext}`);
  if (!fs.existsSync(file)) {
    console.log(`downloading ${m.source.file}`);
    const r = await fetch(m.source.file, { headers: { 'user-agent': 'Mozilla/5.0 (proof download)' }, redirect: 'follow' });
    if (!r.ok) throw new Error(`${m.source.file}: ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (!m.source.sha256) {
    // written beside the source's file address, the manifest's layout kept
    const text = fs.readFileSync(manifestFile, 'utf8').replace(/("file": "[^"]*",)(\r?\n)(\s*)/, `$1$2$3"sha256": "${sha}",$2$3`);
    fs.writeFileSync(manifestFile, text);
    console.log(`source hash written: ${sha}`);
  } else if (sha !== m.source.sha256) throw new Error(`the source changed: ${sha}, the manifest says ${m.source.sha256}`);
  return `assets/${path.basename(file)}`;
}

// ── the documents ────────────────────────────────────────────
const doc = (assets: Doc['assets'], compositions: Doc['compositions'], root = 'main'): Doc => ({ schema: 'tramme/1', meta: { title: `proof ${id}` }, tokens: {}, assets, root, compositions });
const comp = (layers: Record<string, unknown>, order: string[], w = W, h = H) => ({ name: 'Main', width: w, height: h, fps: 30, duration: DUR, background: '#000000', motionBlur: { samples: 1, shutter: 0 }, order, layers });

/** the source as a layer filling the frame: a clip from its start, a picture, or a sound */
function sourceLayer(): Record<string, any> {
  const t = m.source.type, at = { transform: { position: [W / 2, H / 2] } };
  if (t === 'video') return { type: 'video', in: 0, out: DUR, ...at, props: { video: 'src', start: m.source.start ?? 0, size: [W, H], muted: m.kind !== 'sound' && !m.sound } };
  if (t === 'image') return { type: 'image', in: 0, out: DUR, ...at, props: { image: 'src', size: [W, H], fit: 'cover' } };
  return { type: 'audio', in: 0, out: DUR, props: { audio: 'src', start: m.source.start ?? 0 } };
}
const withAfter = (l: Record<string, any>) => ({ ...l, props: { ...l.props, ...m.after?.props }, ...(m.after?.effects?.length ? { effects: m.after.effects.map((e, i) => ({ id: `p${i}`, props: {}, ...e })) } : {}) });

/** the before and the after in one document: the after cut at a line sweeping across, the two side by side, or the after alone, full frame (its before is the picture view's) */
function compareDoc(before: Doc, after: Doc): Doc {
  if (m.compare === 'after') return after;
  const a = after.compositions[after.root], b = before.compositions[before.root];
  // the clip's sound, when it has one, is the after's: the before plays muted beside it
  const quiet = (c: any) => ({ ...c, layers: Object.fromEntries(Object.entries(c.layers as Record<string, any>).map(([k, l]) => [k, l.type === 'video' ? { ...l, props: { ...l.props, muted: true } } : l])) });
  const compositions: Doc['compositions'] = { ...after.compositions, proofBefore: m.sound ? quiet(b) : b };
  const c = (comp: string, x: number, y: number, s = 1, extra: object = {}) => ({ type: 'comp', in: 0, out: DUR, transform: { position: [x, y], scale: [s, s] }, props: { comp }, ...extra });
  if (m.compare === 'side') {
    const fit = (k: { width: number; height: number }) => Math.min((W / 2) / k.width, H / k.height) * 0.94;
    compositions.proofCompare = comp({ b: c('proofBefore', W / 4, H / 2, fit(b)), a: c(after.root, (3 * W) / 4, H / 2, fit(a)) }, ['b', 'a']);
  } else {
    const right = (x: number) => ({ v: [[x - W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [x - W / 2, H / 2]], closed: true });
    const keys = [[0, W * 0.85], [DUR / 2, W * 0.15], [DUR, W * 0.5]] as const;
    const ease = [0.65, 0, 0.35, 1];
    const k = <T>(f: (x: number) => T) => ({ $k: keys.map(([t, x], i) => ({ t, v: f(x), ...(i < keys.length - 1 ? { ease } : {}) })) });
    compositions.proofCompare = comp({
      b: c('proofBefore', W / 2, H / 2),
      a: c(after.root, W / 2, H / 2, 1, { masks: [{ id: 'm', props: { path: k(right) } }] }),
      line: { type: 'shape.rect', in: 0, out: DUR, transform: { position: k((x) => [x, H / 2]) }, props: { size: [4, H], fill: '#FFFFFF' } },
    }, ['b', 'a', 'line']);
  }
  // the tokens of both (a project made in the editor names its colours by tokens)
  return { ...doc({ ...before.assets, ...after.assets }, compositions, 'proofCompare'), tokens: { ...before.tokens, ...after.tokens } };
}

// ── the tools, in the editor ─────────────────────────────────
async function viaEditor(src: string, base: Doc): Promise<Doc> {
  const origin = flag('editor') ?? 'http://localhost:8790';
  const call = async <T>(p: string, init?: RequestInit): Promise<T> => { const r = await fetch(origin + p, init); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return (r.headers.get('content-type') ?? '').includes('json') ? r.json() as Promise<T> : (r.text() as unknown as T); };
  const project = await call<{ id: string }>('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `proof ${id}`, width: W, height: H, duration: DUR }) });
  await call(`/api/projects/${project.id}/files/${src}`, { method: 'PUT', body: fs.readFileSync(path.join(dir, src)) });
  const { launch } = await import('../packages/cli/src/browser.ts');
  const { browser, page } = await launch();
  try {
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tramme.preferences', JSON.stringify({ view: 'atelier' })); localStorage.setItem('tramme.tours', JSON.stringify({ auto: false })); } catch { /* a sandboxed frame */ } });
    await page.goto(`${origin}/p/${project.id}`);
    await page.waitForFunction(() => (window as any).__tramme?.S?.doc?.value, { timeout: 120_000 });
    const main = base.compositions[base.root];
    const fill = (v: unknown): unknown => (v === '$layer' ? 'v' : v === '$asset' ? 'src' : typeof v === 'string' && /^\$over\d+$/.test(v) ? v.slice(1) : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
    await page.evaluate((asset, layers, order) => {
      const t = (window as any).__tramme, c = t.S.compId.value;
      t.commit('proof', [{ op: 'add', path: '/assets/src', value: asset }, ...order.flatMap((id: string) => [{ op: 'add', path: `/compositions/${c}/layers/${id}`, value: layers[id] }, { op: 'add', path: `/compositions/${c}/order/-`, value: id }])]);
      t.select(['v']);
    }, base.assets.src, main.layers, main.order);
    for (const step of m.editor ?? []) {
      if ('transcribe' in step) {
        console.log(`transcribe ${step.transcribe}`);
        await page.evaluate((asset) => (window as any).__tramme.transcribe(asset), fill(step.transcribe) as string);
        continue;
      }
      if ('ops' in step) {
        await page.evaluate((ops) => {
          const t = (window as any).__tramme, c = t.S.compId.value;
          const at = (v: unknown): unknown => (typeof v === 'string' ? v.replace(/\$comp/g, c) : Array.isArray(v) ? v.map(at) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, at(x)])) : v);
          if (!t.commit('proof', at(ops))) throw new Error('the operations of the proof could not be applied');
        }, fill(step.ops) as Record<string, unknown>[]);
        continue;
      }
      console.log(`tool ${step.tool}`);
      const out = await page.evaluate(async (name, input) => {
        const t = (window as any).__tramme, events: any[] = [];
        for await (const ev of t.runTool(name, input)) {
          events.push(ev.type === 'item' ? { type: 'item', text: ev.item?.text } : ev);
          // the tool's proposal accepted, as the user does with its button
          if (ev.type === 'proposal' && !t.commit(ev.label, ev.ops, 'ai')) events.push({ type: 'error', message: `its proposal "${ev.label}" could not be applied` });
        }
        return events;
      }, step.tool, fill(step.input) as Record<string, unknown>);
      if (process.env.PROOF_DEBUG) console.log(JSON.stringify(out.filter((e: any) => e.type !== "tool-progress")).slice(0, 4000));
      const failed = out.find((e: any) => e.type === 'error');
      if (failed) throw new Error(`${step.tool}: ${failed.message}`);
    }
    // saved: the document on the server is the one in the page
    const want = await page.evaluate(() => JSON.stringify((window as any).__tramme.S.doc.value.compositions));
    for (let i = 0; ; i++) {
      const saved = await call<Doc>(`/api/projects/${project.id}/files/document.tramme.json`);
      if (JSON.stringify(saved.compositions) === want) break;
      if (i > 60) throw new Error('the editor did not save the document');
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    await browser.close();
  }
  const info = await call<{ files: { path: string }[] }>(`/api/projects/${project.id}`);
  for (const f of info.files) {
    if (!f.path.startsWith('assets/') || f.path === src) continue;
    const r = await fetch(`${origin}/api/projects/${project.id}/files/${f.path}`);
    fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
    fs.writeFileSync(path.join(dir, f.path), Buffer.from(await r.arrayBuffer()));
  }
  const after = await call<Doc>(`/api/projects/${project.id}/files/document.tramme.json`);
  await fetch(`${origin}/api/projects/${project.id}`, { method: 'DELETE' });
  // the before and the after drawn alike: the project made in the editor takes the base's rate and motion blur
  const root = after.compositions[after.root], made = base.compositions[base.root];
  Object.assign(root, { fps: made.fps, motionBlur: made.motionBlur });
  return after;
}

// ── what the site shows ──────────────────────────────────────
function stills(name: string, docFile: string) {
  const out = path.join(dir, 'stills');
  cli('still', docFile, '--t', String(m.still), '--out', out);
  const png = path.join(out, `${path.basename(docFile, '.tramme.json')}_${m.still.toFixed(3)}.png`);
  const jpg = path.join(SITE, 'src/assets/proofs', `${id}-${name}.jpg`);
  fs.mkdirSync(path.dirname(jpg), { recursive: true });
  ff('-i', png, '-vf', `scale='min(1920,iw)':-2`, '-q:v', '3', jpg);
}

function clip(docFile: string) {
  const master = path.join(dir, 'compare.mp4'), v = path.join(SITE, 'src/videos', `proof-${id}`);
  cli('render', docFile, '--format', 'mp4', '--out', master, ...(m.sound ? [] : ['--mute']));
  const audio = (codec: string, rate: string) => (m.sound ? ['-c:a', codec, '-b:a', rate] : ['-an']);
  ff('-i', master, ...audio('libopus', '96k'), '-c:v', 'libvpx-vp9', '-crf', '37', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', `${v}.webm`);
  ff('-i', master, ...audio('aac', '128k'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-maxrate', '3500k', '-bufsize', '7000k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${v}.mp4`);
  ff('-ss', String(Math.min(DUR * 0.8, m.still + 3)), '-i', master, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', `${v}.webp`);
}

function sounds(name: string, docFile: string) {
  const wav = path.join(dir, `${name}.wav`), out = path.join(SITE, 'src/audio');
  fs.mkdirSync(out, { recursive: true });
  cli('export', docFile, '--format', 'wav', '--out', wav);
  ff('-i', wav, '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '4', path.join(out, `proof-${id}-${name}.mp3`));
  // its waveform, as the proof's still
  ff('-i', wav, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1920x1080:colors=0xE8ECEF:scale=sqrt', '-frames:v', '1', path.join(dir, `${name}-wave.png`));
  ff('-i', path.join(dir, `${name}-wave.png`), '-q:v', '3', path.join(SITE, 'src/assets/proofs', `${id}-${name}.jpg`));
}

const src = await source();
const assets: Doc['assets'] = { src: { type: m.source.type, src } };

// the after: the layers under the source (a background for a key), then the source with its effects
const below = Object.fromEntries((m.after?.below ?? []).map((l, i) => [`under${i}`, { in: 0, out: DUR, ...l }]));
// and over it (a title a tool slides behind the subject); a tool's input names them $over0, $over1…
const above = Object.fromEntries((m.after?.above ?? []).map((l, i) => [`over${i}`, { in: 0, out: DUR, ...l }]));
const afterBase = doc(assets, { main: comp({ ...below, v: withAfter(sourceLayer()), ...above }, [...Object.keys(below), 'v', ...Object.keys(above)]) });
const before = m.beforeKeepsAbove
  ? doc(assets, { main: comp({ v: sourceLayer(), ...above }, ['v', ...Object.keys(above)]) })
  : doc(assets, { main: comp({ v: sourceLayer() }, ['v']) });
const after = m.editor?.length ? await viaEditor(src, afterBase) : afterBase;
const write = (name: string, d: Doc) => { const f = path.join(dir, `${name}.tramme.json`); fs.writeFileSync(f, JSON.stringify(d, null, 1)); return f; };
const files = { before: write('before', before), after: write('after', after), compare: write('compare', compareDoc(before, after)) };
if (m.kind === 'sound') { sounds('before', files.before); sounds('after', files.after); } else { stills('before', files.before); stills('after', files.after); }
if (m.kind !== 'sound') clip(files.compare);
console.log(`proof ${id}: written to apps/site (stills, ${m.kind === 'sound' ? 'sounds' : 'clip'}), its work in out/proofs/${id}`);
