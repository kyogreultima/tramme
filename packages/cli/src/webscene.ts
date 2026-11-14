// Export of web scenes: a `webscene` layer without captured frames is captured
// from its scene folder before the render, once per (folder, size, rate), and
// only again when the folder changes. The render then reads ordinary alpha PNG
// files, so the compositor treats the scene like any picture layer.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fontFaceCss, injectCss, isAssetFile, mimeOf, SceneSchema, tokenCss } from '@tramme/project';
import { CHROME } from './browser.ts';
import { annotateVideos, extractFrames, probeMedia, scanSceneMedia } from './webscene-media.ts';
import { Evaluator, sceneParams, type Registry, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';

/** the frames of one scene, in order, as files on disk */
export interface Capture { files: string[] }
/** renders the scene folder to `<count>` alpha PNG files in `out` */
export type SceneCapturer = (job: { dir: string; entry: string; size: [number, number]; fps: number; frames: number; out: string; css: string; projectDir: string; params: Record<string, number | string | boolean>[] | null }) => Promise<void>;

export const FRAME_PATTERN = /^frame_\d{5,}\.png$/;
const CACHE = 'renders/webscene';

const FILE_URL = /\/assets\/[A-Za-z0-9_%.\-/]+\.[A-Za-z0-9]{2,5}/g;
/** the project files a scene names as /assets/..., read from its text files, so the cache notices when one changes */
export function assetsUsedBy(dir: string, fonts: string[] = []): string[] {
  const found = new Set(fonts.filter(isAssetFile));
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '.hyperframes') walk(file); continue; }
      if (!/\.(html?|css|js|mjs|json|svg)$/i.test(entry.name) || fs.statSync(file).size > 1024 * 1024) continue;
      for (const match of fs.readFileSync(file, 'utf8').matchAll(FILE_URL)) {
        let decoded: string;
        try { decoded = decodeURIComponent(match[0].slice(1)); } catch { continue; }
        if (isAssetFile(decoded)) found.add(decoded);
      }
    }
  };
  walk(dir);
  return [...found].sort();
}

/** a hash of every file of the folder (names and bytes) and of what changes the pictures; the same key means the same frames */
export function sceneKey(dir: string, size: [number, number], fps: number, css = '', shared: { projectDir: string; files: string[] } = { projectDir: dir, files: [] }): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ size, fps, css }));
  // the project files the scene reads (fonts, pictures): a changed font is a changed scene
  for (const file of shared.files) {
    const full = path.join(shared.projectDir, file);
    hash.update(`\0shared\0${file}\0`);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) hash.update(fs.readFileSync(full));
  }
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`scene symlink not allowed: ${path.relative(dir, file)}`);
      if (entry.isDirectory()) { if (entry.name !== '.hyperframes') walk(file); continue; }
      hash.update(`\0${path.relative(dir, file).replaceAll('\\', '/')}\0`);
      hash.update(fs.readFileSync(file));
    }
  };
  walk(dir);
  return hash.digest('hex').slice(0, 24);
}

export interface Prepared {
  /** the document to render: the original when it holds no scene to capture */
  file: string;
  /** removes what was written beside the project for this render */
  cleanup: () => void;
  captured: number;
  reused: number;
}

/**
 * Makes sure every `webscene` layer that names a folder has its frames, and returns the
 * document to render. Layers that already list frames are left alone.
 */
export async function prepareWebScenes(file: string, doc: TrammeDoc, capture: SceneCapturer, registry: Registry = builtinRegistry()): Promise<Prepared> {
  const projectDir = path.dirname(path.resolve(file));
  const needsFrames = (layer: { type: string; props?: Record<string, unknown> }) =>
    layer.type === 'webscene' && typeof layer.props?.folder === 'string' && layer.props.folder !== '' && !(Array.isArray(layer.props.frames) && layer.props.frames.length);
  type SceneLayer = { type: string; props: Record<string, unknown> };
  const layersOf = (d: TrammeDoc) => Object.entries(d.compositions).flatMap(([compId, comp]) => Object.entries(comp.layers).map(([id, layer]) => ({ compId, id, layer: layer as unknown as SceneLayer })));
  if (!layersOf(doc).some(({ layer }) => needsFrames(layer))) return { file, cleanup: () => {}, captured: 0, reused: 0 };

  const next = structuredClone(doc);
  const css = [tokenCss(doc.tokens), fontFaceCss(doc.assets)].filter(Boolean).join('\n');
  const fontFiles = Object.values(doc.assets).filter((a) => a.type === 'font').map((a) => a.src);
  let captured = 0, reused = 0;
  const done = new Map<string, string[]>();
  const evaluator = new Evaluator(doc, registry);
  for (const { compId, id: layerId, layer } of layersOf(next)) {
    if (!needsFrames(layer)) continue;
    const folder = layer.props.folder as string;
    const dir = path.resolve(projectDir, folder);
    if (!dir.startsWith(projectDir + path.sep) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`web scene folder not found in the project: ${folder}`);
    const size = layer.props.size as [number, number], fps = layer.props.fps as number;
    const manifest = SceneSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8')));
    const frames = Math.max(1, Math.ceil(manifest.duration * fps - 1e-6));
    // the parameters at every frame: animated like any property, evaluated here and handed to the page before each capture
    const declared = sceneParams(layer as never);
    const params = Object.keys(declared).length
      ? Array.from({ length: frames }, (_, i) => evaluator.layerAt(layerId, i / fps, compId).props.$params as Record<string, number | string | boolean>)
      : null;
    const key = sceneKey(dir, size, fps, `${css}|params|${params ? JSON.stringify(params) : ''}`, { projectDir, files: assetsUsedBy(dir, fontFiles) });
    let names = done.get(key);
    if (!names) {
      const out = path.join(projectDir, CACHE, key);
      const have = () => fs.existsSync(out) ? fs.readdirSync(out).filter((n) => FRAME_PATTERN.test(n)).sort() : [];
      if (have().length === frames) reused++;
      else {
        // a half-written folder is never trusted: capture into a fresh one and move it in whole
        const temp = `${out}.partial`;
        fs.rmSync(temp, { recursive: true, force: true });
        fs.mkdirSync(temp, { recursive: true });
        await capture({ dir, entry: manifest.entry, size, fps, frames, out: temp, css, projectDir, params });
        const got = fs.readdirSync(temp).filter((n) => FRAME_PATTERN.test(n));
        if (got.length !== frames) throw new Error(`web scene ${folder}: captured ${got.length} of ${frames} frames`);
        fs.rmSync(out, { recursive: true, force: true });
        fs.renameSync(temp, out);
        captured++;
      }
      names = have();
      done.set(key, names);
    }
    const ids = names.map((name, index) => {
      const assetId = `webscene-${key}-${index}`;
      next.assets[assetId] = { type: 'image', src: `${CACHE}/${key}/${name}` } as never;
      return assetId;
    });
    layer.props.frames = ids;
    // the sound of the scene's media goes to the film as ordinary audio layers: the mixer treats it like any other sound
    const comp = next.compositions[compId];
    for (const item of scanSceneMedia(fs.readFileSync(path.join(dir, manifest.entry), 'utf8'), folder).filter((m) => !m.muted)) {
      const info = await probeMedia(path.join(projectDir, item.path));
      const end = Math.min(comp.duration, item.start + info.duration);
      if (!info.audio || end <= item.start) continue;
      const assetId = `webscene-media-${key}-${item.index}`;
      next.assets[assetId] = { type: item.tag === 'video' ? 'video' : 'audio', src: item.path } as never;
      comp.layers[`${assetId}-sound`] = { type: 'audio', name: `Sound of ${folder}`, in: item.start, out: end, props: { audio: assetId, start: 0 } } as never;
      comp.order.unshift(`${assetId}-sound`);
    }
  }
  const derived = path.join(projectDir, `.${path.basename(file).replace(/\.json$/, '')}.webscene.json`);
  fs.writeFileSync(derived, JSON.stringify(next));
  return { file: derived, cleanup: () => fs.rmSync(derived, { force: true }), captured, reused };
}

/** a scene video as extracted pictures: its place among the page's media, the folder, how many, at what rate */
export interface ServedVideo { index: number; dir: string; count: number; fps: number }

/** serves one scene folder, plus the seek runtime every scene imports from /vendor/scene-runtime.js */
export async function serveScene(root: string, css: string, projectDir: string, media: ServedVideo[] = []) {
  const { build } = await import('esbuild');
  const runtimeEntry = fileURLToPath(new URL('../../project/src/scene-runtime.ts', import.meta.url));
  const runtime = (await build({ entryPoints: [runtimeEntry], bundle: true, format: 'esm', platform: 'browser', write: false })).outputFiles[0].text;
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(`http://localhost${request.url}`).pathname);
    if (pathname === '/vendor/scene-runtime.js') { response.writeHead(200, { 'content-type': 'text/javascript' }).end(runtime); return; }
    // the pictures extracted from the scene's videos
    const frame = /^\/__media\/(\d+)\/(\d{6}\.jpg)$/.exec(pathname);
    if (frame) {
      const video = media.find((m) => m.index === Number(frame[1])), file = video ? path.join(video.dir, frame[2]) : '';
      if (!video || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': 'image/jpeg' });
      fs.createReadStream(file).pipe(response);
      return;
    }
    // the project's own fonts and pictures, by the same /assets/ path the document uses
    const shared = pathname.startsWith('/assets/') && isAssetFile(pathname.slice(1)) ? path.resolve(projectDir, pathname.slice(1)) : null;
    const file = shared ?? path.resolve(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    if (!file.startsWith((shared ? path.resolve(projectDir, 'assets') : root) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': mimeOf(file) });
    if (/\.html?$/i.test(file)) response.end(injectCss(annotateVideos(fs.readFileSync(file, 'utf8'), media), css));
    else fs.createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** the pinned @hyperframes/engine, driven by seek capture (its higher-level render freezes custom-seek scenes) */
export const engineCapture: SceneCapturer = async ({ dir, entry, size, fps, frames, out, css, projectDir, params }) => {
  const engine = await import('@hyperframes/engine').catch(() => { throw new Error('web scenes need @hyperframes/engine, which is not installed (pnpm install)'); });
  // the videos of the page, extracted to pictures at the scene's rate; removed when the capture is done
  const entryFile = path.join(dir, entry), extractDir = `${out}.media`;
  const videos = fs.existsSync(entryFile) ? scanSceneMedia(fs.readFileSync(entryFile, 'utf8'), path.relative(projectDir, dir).split(path.sep).join('/')).filter((m) => m.tag === 'video') : [];
  const extracted: ServedVideo[] = [];
  try {
    for (const video of videos) {
      const target = path.join(extractDir, String(video.index));
      extracted.push({ index: video.index, dir: target, count: await extractFrames(path.join(projectDir, video.path), fps, target), fps });
    }
    const served = await serveScene(dir, css, projectDir, extracted);
    let session;
    try {
      session = await engine.createCaptureSession(served.url + (entry === 'index.html' ? '' : entry), out, { width: size[0], height: size[1], fps: { num: fps, den: 1 }, format: 'png', transparent: true }, null, CHROME ? { chromePath: CHROME } : {});
      await engine.initializeSession(session);
      for (let frame = 0; frame < frames; frame++) {
        // the parameters of this instant first, and the pictures of its videos (which arrive after the
        // seek asks for them): the engine's own seek then draws with them
        if (params || extracted.length) {
          await session.page.evaluate(async (values, time) => {
            const hf = (window as unknown as { __hf: { setParams(v: unknown): void; seek(t: number): void; ready(): Promise<void> } }).__hf;
            if (values) hf.setParams(values);
            hf.seek(time);
            await hf.ready();
          }, params ? params[frame] : null, frame / fps);
        }
        await engine.captureFrame(session, frame, frame / fps);
      }
    } finally {
      if (session) await engine.closeCaptureSession(session);
      await served.close();
    }
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
};
