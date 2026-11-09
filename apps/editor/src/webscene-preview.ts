// The editor's live preview of a web scene: what the viewport needs to show a scene that has no
// captured pictures yet. The document is built by webscene-frame.ts from the project's own files,
// read with the user's rights here, on the host side; the frame itself reaches nothing.

import { signal } from '@preact/signals';
import { fontFaceCss, mimeOf, SceneSchema, tokenCss, isAssetFile } from '@tramme/project';
import type { TrammeDoc } from '@tramme/core';
import { api } from './api.ts';
import { readLimitedBody } from './plugins/host.ts';
import { buildSceneFrame, toDataUrl } from './webscene-frame.ts';

/** raised when a scene file is written, so a shown scene builds its document again */
export const sceneRevision = signal(0);
export const bumpScene = () => { sceneRevision.value += 1; };

/** scenes the viewport shows live: the canvas draws nothing for them (see setWebScenePlaceholder) */
export const liveScenes = new Set<string>();

let runtime: Promise<string> | null = null;
/** the seek runtime every scene imports, a file of the editor's own build */
export function sceneRuntime(): Promise<string> {
  runtime ??= fetch(new URL('/scene-runtime.js', location.href), { cache: 'force-cache' }).then(async (r) => {
    if (!r.ok) throw new Error(`the scene runtime could not be loaded (HTTP ${r.status})`);
    return r.text();
  }).catch((error) => { runtime = null; throw error; });
  return runtime;
}

const MAX_FILE = 8 * 1024 * 1024;

/** a project file's bytes, or null when there is none */
export async function readProjectBytes(projectId: string, path: string): Promise<Uint8Array | null> {
  const response = await fetch(api.fileUrl(projectId, path), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`could not read ${path} (HTTP ${response.status})`);
  return readLimitedBody(response, MAX_FILE, path);
}

/** the tokens and the document's fonts as one style: the fonts are read here and put in as data */
export async function sceneStyle(projectId: string, doc: TrammeDoc, read = (p: string) => readProjectBytes(projectId, p)): Promise<string> {
  const fonts = new Map<string, string>();
  for (const asset of Object.values(doc.assets)) {
    if (asset.type !== 'font' || !isAssetFile(asset.src) || fonts.has(asset.src)) continue;
    const bytes = await read(asset.src);
    if (bytes) fonts.set(asset.src, toDataUrl(mimeOf(asset.src), bytes));
  }
  return [tokenCss(doc.tokens), fontFaceCss(doc.assets, (src) => fonts.get(src) ?? null)].filter(Boolean).join('\n');
}

/** the document of a scene folder, ready for a sandboxed iframe */
export async function sceneDocument(projectId: string, doc: TrammeDoc, folder: string): Promise<{ srcdoc: string; duration: number }> {
  const read = (p: string) => readProjectBytes(projectId, p);
  const raw = await read(`${folder}/scene.json`);
  if (!raw) throw new Error(`${folder}/scene.json is missing`);
  const manifest = SceneSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
  const [runtimeSource, css] = await Promise.all([sceneRuntime(), sceneStyle(projectId, doc, read)]);
  return { srcdoc: await buildSceneFrame({ folder, entry: manifest.entry, css, runtime: runtimeSource, read }), duration: manifest.duration };
}
