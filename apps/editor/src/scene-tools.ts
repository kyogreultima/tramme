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
export function sceneSyncOps(doc: TrammeDoc, folder: string, manifest: { parameters: Record<string, unknown> }, to = folder): Op[] {
  const ops: Op[] = [];
  for (const [compId, comp] of Object.entries(doc.compositions)) {
    for (const [id, layer] of Object.entries(comp.layers)) {
      if (layer.type !== 'webscene' || staticValue(layer.props?.folder) !== folder) continue;
      const base = pointer('compositions', compId, 'layers', id);
      // a take: the layers are pointed at the new folder, and back at this one by undoing
      if (to !== folder) ops.push({ op: 'replace', path: `${base}/props/folder`, value: to });
      const declared = staticValue(layer.props?.parameters);
      if (JSON.stringify(declared ?? {}) !== JSON.stringify(manifest.parameters)) {
        ops.push({ op: layer.props && 'parameters' in layer.props ? 'replace' : 'add', path: `${base}/props/parameters`, value: manifest.parameters });
      }
      for (const name of Object.keys(layer.params ?? {})) if (!(name in manifest.parameters)) ops.push({ op: 'remove', path: pointer('compositions', compId, 'layers', id, 'params', name) });
    }
  }
  return ops;
}

const TAKE_SUFFIX = /-v\d+$/;
const showing = (doc: TrammeDoc, folder: string) =>
  Object.values(doc.compositions).some((comp) => Object.values(comp.layers).some((layer) => layer.type === 'webscene' && staticValue(layer.props?.folder) === folder));

/**
 * A scene that layers show is changed as a take: its text files are copied to a new folder
 * (title, then title-v2, title-v3...) which receives the change, and the proposal points the layers
 * at it. Accepting it is the change, rejecting it leaves the scene as it was, and undoing it points
 * the layers back at the folder that still holds the previous version. Null when the change is made
 * in place: nobody shows the scene yet, the caller asked for it, or its folder holds files that are not text
 * (pictures, fonts), which a tool cannot copy.
 */
async function takeOf(id: string, ctx: ToolContext, wanted: boolean | undefined): Promise<string | null> {
  const folder = `scenes/${id}`;
  if (wanted === false || !ctx.folderFiles || !showing(ctx.doc, folder)) return null;
  const files = await ctx.folderFiles(folder);
  if (!files.length || files.length > 2 * MAX_FILES || files.some((f) => !SCENE_TEXT_FILE.test(f.path))) return null;
  const base = id.replace(TAKE_SUFFIX, '');
  for (let n = 2; n < 100; n++) {
    const next = `${base}-v${n}`;
    if (!ID.test(next) || showing(ctx.doc, `scenes/${next}`) || (await ctx.folderFiles(`scenes/${next}`)).length) continue;
    for (const file of files) {
      const body = await ctx.readText(file.path);
      if (body !== null) await ctx.writeFile(scenePath(next, file.path.slice(folder.length + 1)), body);
    }
    return next;
  }
  return null;
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

const MAX_LINTED = 32;
const join = (dir: string, ref: string): string | null => {
  const parts = dir ? dir.split('/') : [];
  for (const part of ref.split('/')) { if (part === '' || part === '.') continue; if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part); }
  return parts.join('/');
};

/**
 * What breaks a scene's determinism (a free Date.now, Math.random, fetch, requestAnimationFrame), read
 * without running anything from the scene's page and the local scripts it names. The parser is loaded
 * on demand: it is a chunk of its own, not part of the editor that opens.
 */
async function seekLint(id: string, ctx: ToolContext, pending: Map<string, string> = new Map()): Promise<string[]> {
  const read = async (file: string) => pending.get(file) ?? await ctx.readText(scenePath(id, file)).catch(() => null);
  const files = new Map<string, Uint8Array>();
  try {
    const manifest = manifestOf(await read('scene.json'), `scenes/${id}/scene.json`);
    const queue = [manifest.entry];
    while (queue.length && files.size < MAX_LINTED) {
      const file = queue.shift()!;
      if (files.has(`scenes/${id}/${file}`) || !/\.(html|m?js)$/i.test(file)) continue;
      const body = await read(file);
      if (body === null) continue;
      files.set(`scenes/${id}/${file}`, new TextEncoder().encode(body));
      const dir = file.split('/').slice(0, -1).join('/');
      const refs = /\.html$/i.test(file)
        ? [...body.matchAll(/<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
        : [...body.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{0,2}\/[^"'\n]+)["']/g)].map((m) => m[1]);
      for (const ref of refs) {
        if (/^([a-z]+:|\/\/|\/)/i.test(ref)) continue;
        const next = join(dir, ref.split(/[?#]/)[0]);
        if (next && !pathIssue(`scenes/${id}/${next}`)) queue.push(next);
      }
    }
    const { lintSceneFiles } = await import('@tramme/project/src/scene-lint.ts');
    return lintSceneFiles(files).map((issue) => `${issue.path}:${issue.line}: ${issue.message}`);
  } catch (error) { return [`the seek lint could not run: ${(error as Error).message}`]; }
}

const writeScene: ToolType<{ id: string; files: { path: string; content: string }[]; take?: boolean }> = {
  name: 'write_scene', title: 'Write a web scene',
  description: 'writes the text files of a web scene (scenes/<id>/): its scene.json (duration, size, entry, parameters) and its HTML, CSS and scripts; files not named are left as they are',
  input: {
    type: 'object', required: ['id', 'files'],
    properties: {
      id: { type: 'string', title: 'Scene', description: 'the scene folder: lowercase letters, digits and dashes' },
      take: { type: 'boolean', title: 'Take', description: 'a scene that layers show is changed as a take (the default): the change goes to a new folder (title-v2) the layers are pointed at, so undoing returns to the previous version; false changes the files in place' },
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
    const dest = (await takeOf(input.id, ctx, input.take)) ?? input.id;
    const written: string[] = [];
    for (const [file, content] of pending) written.push(await ctx.writeFile(scenePath(dest, file), content));
    const raw = pending.get('scene.json') ?? await ctx.readText(scenePath(dest, 'scene.json'));
    const manifest = raw === null ? null : manifestOf(raw, `scenes/${dest}/scene.json`);
    const ops = manifest ? sceneSyncOps(ctx.doc, `scenes/${input.id}`, manifest, `scenes/${dest}`) : [];
    const lint = await seekLint(dest, ctx, pending);
    const take = dest === input.id ? '' : ` Made as a take: the layers showing scenes/${input.id} now show scenes/${dest}, and undoing returns them to the previous version.`;
    return { ops, label: `Scene ${dest}`, text: `Wrote ${written.join(', ')}.${take}${lint.length ? ` The seek lint found problems to fix (a scene is a function of time):
${lint.map((l) => `- ${l}`).join('\n')}
` : ''} Add a web scene layer with props.folder "scenes/${input.id}" through propose_changes; export captures it.${ops.length ? ` The layers showing it get its parameters (${ops.length} change${ops.length > 1 ? 's' : ''}).` : ''}` };
  },
};

const editScene: ToolType<{ id: string; file: string; find: string; replace: string; take?: boolean }> = {
  name: 'edit_scene', title: 'Edit a web scene file',
  description: 'changes one file of a web scene: the text to find, which must occur exactly once, is replaced; no other file of the scene or the project changes',
  input: {
    type: 'object', required: ['id', 'file', 'find', 'replace'],
    properties: {
      id: { type: 'string', title: 'Scene' },
      file: { type: 'string', title: 'File', description: 'inside the scene, e.g. index.html' },
      find: { type: 'string', title: 'Find', description: 'text copied exactly from the file; it must occur once' },
      replace: { type: 'string', title: 'Replace' },
      take: { type: 'boolean', title: 'Take', description: 'a scene that layers show is changed as a take (the default): the change goes to a new folder (title-v2) the layers are pointed at, so undoing returns to the previous version; false changes the files in place' },
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
    const dest = (await takeOf(input.id, ctx, input.take)) ?? input.id;
    const written = scenePath(dest, input.file);
    await ctx.writeFile(written, next);
    const lint = /\.(html|m?js)$/i.test(input.file) ? await seekLint(dest, ctx, new Map([[input.file, next]])) : [];
    const raw = input.file === 'scene.json' ? next : await ctx.readText(scenePath(dest, 'scene.json'));
    const ops = raw === null ? [] : sceneSyncOps(ctx.doc, `scenes/${input.id}`, manifestOf(raw, `scenes/${dest}/scene.json`), `scenes/${dest}`);
    const take = dest === input.id ? '' : ` Made as a take: the layers showing scenes/${input.id} now show scenes/${dest}, and undoing returns them to the previous version.`;
    return { ops, label: `Scene ${dest}`, text: `${written} changed (${body.length} → ${next.length} characters). Nothing else was touched.${take}${lint.length ? ` The seek lint found problems:
${lint.map((l) => `- ${l}`).join('\n')}` : ''}` };
  },
};

const checkScene: ToolType<{ id: string }> = {
  name: 'check_scene', title: 'Check a web scene',
  description: 'checks a web scene: scene.json matches the format, its entry is an HTML file of the scene, and its scripts hold nothing that breaks determinism (free Date.now, Math.random, fetch, requestAnimationFrame). Stills of a scene come from the export (tramme render)',
  input: { type: 'object', required: ['id'], properties: { id: { type: 'string', title: 'Scene' } } },
  ai: { when: 'after writing or editing a scene, before adding or changing its layer' },
  async run(input, ctx) {
    scenePath(input.id, 'scene.json');
    const problems = await sceneProblems(input.id, ctx);
    const lint = problems.length ? [] : await seekLint(input.id, ctx);
    problems.push(...lint);
    if (problems.length) return { text: `scenes/${input.id} has problems:\n${problems.map((p) => `- ${p}`).join('\n')}` };
    const path = scenePath(input.id, 'scene.json');
    const ops = sceneSyncOps(ctx.doc, `scenes/${input.id}`, manifestOf(await ctx.readText(path), path));
    return { ops, label: `Scene ${input.id}`, text: `scenes/${input.id} is well formed.${ops.length ? ' The parameters of the layers showing it are brought up to date.' : ''} The seek lint found nothing; stills of a scene come from the export (tramme render).` };
  },
};

export const SCENE_TOOLS: ToolType[] = [writeScene, editScene, checkScene];

/** a text file of a scene folder, which the tool context may read and write besides assets/ and plugins/ */
export const isSceneTextPath = (path: string) => !path.includes('..') && /^scenes\/[a-z0-9][a-z0-9-]{0,63}\/.+/.test(path) && SCENE_TEXT_FILE.test(path);
