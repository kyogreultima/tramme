// The assistant's tools for web scenes: a scene is a folder (scenes/<id>/) of
// a manifest and its text files. A correction rewrites the files it names and
// nothing else; the document changes only through propose_changes.

import { pathIssue, SceneSchema } from '@tramme/project';
import { pointer, staticValue, type Op, type ToolContext, type ToolType, type TrammeDoc } from '@tramme/core';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** the scene files a tool writes as text; pictures, fonts and media come from the user's assets */
export const SCENE_TEXT_FILE = /\.(html|css|js|mjs|json|svg|txt)$/i;
const MAX_FILE = 1024 * 1024;
const MAX_FILES = 32;

/** `scenes/<id>/<file>` for a scene file the tools may touch, or the reason it is refused */
export function scenePath(id: unknown, file: unknown): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error(`scene id "${String(id)}": lowercase letters, digits and dashes, up to 64`);
  if (typeof file !== 'string' || !file || file.startsWith('/') || file.includes('\\') || file.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error(`scene file "${String(file)}": a relative path inside the scene`);
  const path = `scenes/${id}/${file}`;
  const bad = pathIssue(path) ?? (/[%#]/.test(path) ? 'invalid project path' : null);
  if (bad) throw new Error(`${path}: ${bad}`);
  if (!SCENE_TEXT_FILE.test(file)) throw new Error(`${path}: a tool writes scene text files only (html, css, js, mjs, json, svg, txt); pictures, fonts and media are the user's assets`);
  return path;
}

/** the manifest of a scene as it reads, or why it is not one */
function manifestOf(raw: string | null, path: string) {
  if (raw === null) throw new Error(`${path} not found: a scene needs a scene.json`);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error(`${path} is not valid JSON`); }
  const parsed = SceneSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '/'} ${i.message}`).join('; ')}`);
  return parsed.data;
}

/**
 * What brings the layers showing a scene up to date with its scene.json: their declared
 * parameters (props.parameters) become the manifest's, and a value set for a parameter the
 * manifest no longer declares is dropped. No operation when they already agree.
 */
export function sceneSyncOps(doc: TrammeDoc, folder: string, manifest: { parameters: Record<string, unknown> }): Op[] {
  const ops: Op[] = [];
  for (const [compId, comp] of Object.entries(doc.compositions)) {
    for (const [id, layer] of Object.entries(comp.layers)) {
      if (layer.type !== 'webscene' || staticValue(layer.props?.folder) !== folder) continue;
      const base = pointer('compositions', compId, 'layers', id);
      const declared = staticValue(layer.props?.parameters);
      if (JSON.stringify(declared ?? {}) !== JSON.stringify(manifest.parameters)) {
        ops.push({ op: layer.props && 'parameters' in layer.props ? 'replace' : 'add', path: `${base}/props/parameters`, value: manifest.parameters });
      }
      for (const name of Object.keys(layer.params ?? {})) if (!(name in manifest.parameters)) ops.push({ op: 'remove', path: pointer('compositions', compId, 'layers', id, 'params', name) });
    }
  }
  return ops;
}

const sceneProblems = async (id: string, ctx: ToolContext, pending: Map<string, string> = new Map()): Promise<string[]> => {
  const read = async (file: string) => pending.get(file) ?? await ctx.readText(scenePath(id, file)).catch(() => null);
  try {
    const manifest = manifestOf(await read('scene.json'), `scenes/${id}/scene.json`);
    const entry = manifest.entry;
    if (!SCENE_TEXT_FILE.test(entry) || !/\.html$/i.test(entry)) return [`the entry "${entry}" is not an HTML file`];
    return await read(entry) === null ? [`the entry "${entry}" is missing from scenes/${id}/`] : [];
  } catch (error) { return [(error as Error).message]; }
};

const writeScene: ToolType<{ id: string; files: { path: string; content: string }[] }> = {
  name: 'write_scene', title: 'Write a web scene',
  description: 'writes the text files of a web scene (scenes/<id>/): its scene.json (duration, size, entry, parameters) and its HTML, CSS and scripts; files not named are left as they are',
  input: {
    type: 'object', required: ['id', 'files'],
    properties: {
      id: { type: 'string', title: 'Scene', description: 'the scene folder: lowercase letters, digits and dashes' },
      files: { type: 'array', minItems: 1, maxItems: MAX_FILES, title: 'Files', description: 'each file of the scene to write, whole', items: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string', description: 'inside the scene, e.g. scene.json or index.html' }, content: { type: 'string' } } } },
    },
  },
  ai: {
    when: 'to make or rewrite a whole web scene (a title, an animated diagram) that the built-in layers cannot draw; to change a few lines, use edit_scene',
    avoid: 'free Date.now, Math.random, fetch and requestAnimationFrame: a scene is a function of time and is seeked, never played; remote imports; a scene.json that does not match its files',
    example: { id: 'title', files: [{ path: 'scene.json', content: '{"duration":3,"size":[1920,1080],"entry":"index.html","parameters":{}}' }, { path: 'index.html', content: '<!doctype html>…' }] },
  },
  async run(input, ctx) {
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > MAX_FILES) throw new Error(`write 1 to ${MAX_FILES} files at once`);
    const pending = new Map<string, string>();
    for (const file of input.files) {
      if (typeof file?.content !== 'string' || file.content.length > MAX_FILE) throw new Error(`${String(file?.path)}: content is text of at most 1 MiB`);
      scenePath(input.id, file.path);
      pending.set(file.path, file.content);
    }
    const problems = await sceneProblems(input.id, ctx, pending);
    if (problems.length) throw new Error(`nothing written: ${problems.join('; ')}`);
    const written: string[] = [];
    for (const [file, content] of pending) written.push(await ctx.writeFile(scenePath(input.id, file), content));
    const manifest = pending.has('scene.json') ? manifestOf(pending.get('scene.json')!, `scenes/${input.id}/scene.json`) : null;
    const ops = manifest ? sceneSyncOps(ctx.doc, `scenes/${input.id}`, manifest) : [];
    return { ops, label: `Scene ${input.id}`, text: `Wrote ${written.join(', ')}. Add a web scene layer with props.folder "scenes/${input.id}" through propose_changes; export captures it.${ops.length ? ` The layers showing it get its parameters (${ops.length} change${ops.length > 1 ? 's' : ''}).` : ''}` };
  },
};

const editScene: ToolType<{ id: string; file: string; find: string; replace: string }> = {
  name: 'edit_scene', title: 'Edit a web scene file',
  description: 'changes one file of a web scene: the text to find, which must occur exactly once, is replaced; no other file of the scene or the project changes',
  input: {
    type: 'object', required: ['id', 'file', 'find', 'replace'],
    properties: {
      id: { type: 'string', title: 'Scene' },
      file: { type: 'string', title: 'File', description: 'inside the scene, e.g. index.html' },
      find: { type: 'string', title: 'Find', description: 'text copied exactly from the file; it must occur once' },
      replace: { type: 'string', title: 'Replace' },
    },
  },
  ai: { when: 'to correct one thing in a scene ("fix the title of scene 3"): read the file, then replace the few lines that are wrong', avoid: 'rewriting the whole scene for a small change; a find that is not unique' },
  async run(input, ctx) {
    const path = scenePath(input.id, input.file);
    if (typeof input.find !== 'string' || !input.find || typeof input.replace !== 'string') throw new Error('find is the text to replace, and replace the new text');
    const body = await ctx.readText(path);
    if (body === null) throw new Error(`${path} not found`);
    const count = body.split(input.find).length - 1;
    if (count !== 1) throw new Error(`${path}: the text to find occurs ${count} times; it must occur exactly once`);
    const next = body.replace(input.find, () => input.replace);
    if (next.length > MAX_FILE) throw new Error(`${path}: the result exceeds 1 MiB`);
    if (input.file === 'scene.json') {
      const problems = await sceneProblems(input.id, ctx, new Map([['scene.json', next]]));
      if (problems.length) throw new Error(`not changed: ${problems.join('; ')}`);
    }
    await ctx.writeFile(path, next);
    const ops = input.file === 'scene.json' ? sceneSyncOps(ctx.doc, `scenes/${input.id}`, manifestOf(next, path)) : [];
    return { ops, label: `Scene ${input.id}`, text: `${path} changed (${body.length} → ${next.length} characters). Nothing else was touched.` };
  },
};

const checkScene: ToolType<{ id: string }> = {
  name: 'check_scene', title: 'Check a web scene',
  description: 'checks that a web scene is well formed: scene.json matches the format and its entry is an HTML file of the scene. The seekability lint and the stills run with `tramme check` and the export',
  input: { type: 'object', required: ['id'], properties: { id: { type: 'string', title: 'Scene' } } },
  ai: { when: 'after writing or editing a scene, before adding or changing its layer' },
  async run(input, ctx) {
    scenePath(input.id, 'scene.json');
    const problems = await sceneProblems(input.id, ctx);
    if (problems.length) return { text: `scenes/${input.id} has problems:\n${problems.map((p) => `- ${p}`).join('\n')}` };
    const path = scenePath(input.id, 'scene.json');
    const ops = sceneSyncOps(ctx.doc, `scenes/${input.id}`, manifestOf(await ctx.readText(path), path));
    return { ops, label: `Scene ${input.id}`, text: `scenes/${input.id} is well formed.${ops.length ? ' The parameters of the layers showing it are brought up to date.' : ''} The seek lint and the stills run with \`tramme check\` and the export.` };
  },
};

export const SCENE_TOOLS: ToolType[] = [writeScene, editScene, checkScene];

/** a text file of a scene folder, which the tool context may read and write besides assets/ and plugins/ */
export const isSceneTextPath = (path: string) => !path.includes('..') && /^scenes\/[a-z0-9][a-z0-9-]{0,63}\/.+/.test(path) && SCENE_TEXT_FILE.test(path);
