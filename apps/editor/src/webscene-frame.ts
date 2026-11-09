// The preview of a web scene: one self-contained document for a sandboxed iframe with an opaque
// origin. The host reads the scene's files (the user's project, with the user's rights) and puts
// them in the document itself: scripts, styles, pictures and fonts become inline text or data:
// URLs, modules are mapped by an import map. The frame then needs nothing from any server, and
// its Content-Security-Policy leaves it no way to ask: assets reach it through the host only.
//
// What the frame hears is one message from its parent, { kind: 'seek', t, params }; it answers
// 'ready' once the scene has loaded and 'sought' after each seek.

import { isAssetFile, mimeOf, pathIssue } from '@tramme/project';

/** the largest file inlined, and the most all the files of a scene add up to */
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024;
const MAX_MODULES = 64;

export const SCENE_FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
/** the iframe attribute that makes its origin opaque: scripts may run, nothing else is granted */
export const SCENE_FRAME_SANDBOX = 'allow-scripts';

export interface SceneFrameInput {
  /** `scenes/<id>` */
  folder: string;
  /** the entry file inside the folder */
  entry: string;
  /** the tokens and fonts style (see tokenCss, fontFaceCss), placed first in the head */
  css: string;
  /** the source of the seek runtime that scenes import from /vendor/scene-runtime.js */
  runtime: string;
  /** a project file's bytes, or null when there is none */
  read(path: string): Promise<Uint8Array | null>;
}

const RUNTIME = 'scene:runtime';
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
const dataUrl = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${base64(bytes)}`;
const jsUrl = (source: string) => dataUrl('text/javascript', new TextEncoder().encode(source));

/** a path inside the project, normalised, or null when it leaves it */
function join(dir: string, ref: string): string | null {
  const parts = dir ? dir.split('/') : [];
  for (const part of ref.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join('/');
}

export async function buildSceneFrame(input: SceneFrameInput): Promise<string> {
  const { folder } = input;
  let total = 0;
  const cache = new Map<string, Uint8Array | null>();

  /** the project path a reference in `fromDir` names, when it names one the scene may read */
  const resolve = (ref: string, fromDir: string): string | null => {
    const clean = ref.trim().split(/[?#]/)[0];
    if (!clean || /^(data|blob|about|javascript):/i.test(clean) || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) return null;
    let decoded: string;
    try { decoded = decodeURIComponent(clean); } catch { return null; }
    const path = decoded.startsWith('/') ? join('', decoded) : join(fromDir, decoded);
    if (!path || pathIssue(path) || /[%#]/.test(path)) return null;
    return path.startsWith(`${folder}/`) || isAssetFile(path) ? path : null;
  };

  const load = async (path: string): Promise<Uint8Array | null> => {
    if (cache.has(path)) return cache.get(path)!;
    const bytes = await input.read(path);
    if (bytes) {
      if (bytes.byteLength > MAX_FILE) throw new Error(`${path} is over ${MAX_FILE / (1024 * 1024)} MB: too large for the preview`);
      total += bytes.byteLength;
      if (total > MAX_TOTAL) throw new Error(`the scene's files add up to more than ${MAX_TOTAL / (1024 * 1024)} MB: too large for the preview`);
    }
    cache.set(path, bytes);
    return bytes;
  };

  /** a file as a data: URL, or null when the reference names nothing readable */
  const inline = async (ref: string, fromDir: string): Promise<string | null> => {
    if (ref.trim() === '/vendor/scene-runtime.js') return jsUrl(input.runtime);
    const path = resolve(ref, fromDir);
    const bytes = path ? await load(path) : null;
    return path && bytes ? dataUrl(mimeOf(path), bytes) : null;
  };

  /** async String.replace */
  const replaceAll = async (source: string, pattern: RegExp, make: (m: RegExpExecArray) => Promise<string>): Promise<string> => {
    let out = '', last = 0;
    for (const m of source.matchAll(pattern)) {
      out += source.slice(last, m.index) + await make(m as RegExpExecArray);
      last = m.index! + m[0].length;
    }
    return out + source.slice(last);
  };

  /** url(...) references of a stylesheet or a style attribute */
  const cssUrls = (css: string, fromDir: string) =>
    replaceAll(css, /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, async (m) => {
      const data = await inline(m[2], fromDir);
      return data ? `url("${data}")` : m[0];
    });

  // modules: every specifier that names a file becomes `scene:<path>` and is mapped to the file's text
  const imports: Record<string, string> = { [RUNTIME]: jsUrl(input.runtime) };
  const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g;
  const mapModule = async (source: string, fromDir: string, depth: number): Promise<string> =>
    replaceAll(source, SPECIFIER, async (m) => {
      const spec = m[3];
      if (spec.trim() === '/vendor/scene-runtime.js') return `${m[1]}${m[2]}${RUNTIME}${m[2]}`;
      const path = resolve(spec, fromDir);
      if (!path || !/\.m?js$/i.test(path)) return m[0];
      const mapped = `scene:${path}`;
      if (!(mapped in imports)) {
        if (Object.keys(imports).length > MAX_MODULES) throw new Error('the scene imports too many modules');
        const bytes = await load(path);
        if (!bytes) return m[0];
        imports[mapped] = '';
        imports[mapped] = depth > 8 ? jsUrl(text(bytes)) : jsUrl(await mapModule(text(bytes), path.split('/').slice(0, -1).join('/'), depth + 1));
      }
      return `${m[1]}${m[2]}${mapped}${m[2]}`;
    });

  const entryPath = join(folder, input.entry);
  const entryBytes = entryPath && entryPath.startsWith(`${folder}/`) ? await load(entryPath) : null;
  if (!entryPath || !entryBytes) throw new Error(`the scene's entry ${input.entry} is missing from ${folder}/`);
  const entryDir = entryPath.split('/').slice(0, -1).join('/');
  let html = text(entryBytes);

  // scripts: a file becomes inline text (a closing tag in it is defused), an inline module is mapped like a file
  html = await replaceAll(html, /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, async (m) => {
    const attrs = m[1];
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const isModule = /\btype\s*=\s*["']?module["']?/i.test(attrs);
    const kept = attrs.replace(/\s*\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/i, '');
    let body = m[2], dir = entryDir;
    if (src) {
      const ref = src[1] ?? src[2];
      if (ref.trim() === '/vendor/scene-runtime.js') body = input.runtime;
      else {
        const path = resolve(ref, entryDir);
        const bytes = path ? await load(path) : null;
        if (!path || !bytes) return m[0];
        body = text(bytes);
        dir = path.split('/').slice(0, -1).join('/');
      }
    }
    if (/\btype\s*=\s*["']?importmap["']?/i.test(attrs)) return '';
    if (isModule) body = await mapModule(body, dir, 0);
    return `<script${kept}>${body.replace(/<\/script/gi, '<\\/script')}</script>`;
  });

  // stylesheets: a linked file becomes a style, its url() references data
  html = await replaceAll(html, /<link\b[^>]*>/gi, async (m) => {
    if (!/\brel\s*=\s*["']?stylesheet["']?/i.test(m[0])) return m[0];
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0]);
    const path = href ? resolve(href[1] ?? href[2], entryDir) : null;
    const bytes = path ? await load(path) : null;
    if (!path || !bytes) return m[0];
    const css = await cssUrls(text(bytes), path.split('/').slice(0, -1).join('/'));
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
  });
  html = await replaceAll(html, /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, async (m) => `${m[1]}${await cssUrls(m[2], entryDir)}${m[3]}`);
  html = await replaceAll(html, /(\bstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, async (m) => `${m[1]}"${(await cssUrls(m[2] ?? m[3], entryDir)).replaceAll('"', '&quot;')}"`);

  // pictures, sound and video named by an attribute
  html = await replaceAll(html, /(<(?:img|source|video|audio|track|image|use|input)\b[^>]*?\s(?:src|href|poster|xlink:href)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, async (m) => {
    const data = await inline(m[2] ?? m[3], entryDir);
    return data ? `${m[1]}"${data}"` : m[0];
  });

  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${SCENE_FRAME_CSP}">`,
    `<script type="importmap">${JSON.stringify({ imports }).replace(/</g, '\\u003c')}</script>`,
    input.css ? `<style id="tramme-tokens">${input.css.replace(/<\/style/gi, '<\\/style')}</style>` : '',
    `<script>${BOOTSTRAP}</script>`,
  ].join('');
  const open = /<head[^>]*>/i.exec(html);
  return open ? html.slice(0, open.index + open[0].length) + head + html.slice(open.index + open[0].length) : `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${html}</body></html>`;
}

/** inside the frame: the only door, a message from the parent window */
const BOOTSTRAP = `(function(){
  var up = window.parent;
  addEventListener('message', function (e) {
    if (e.source !== up) return;
    var d = e.data;
    if (!d || d.kind !== 'seek' || typeof d.t !== 'number') return;
    try {
      var h = window.__hf;
      if (!h) throw new Error('the scene installed no window.__hf (sceneController(...).install(window))');
      if (d.params) h.setParams(d.params);
      h.seek(d.t);
      up.postMessage({ kind: 'sought', id: d.id }, '*');
    } catch (err) { up.postMessage({ kind: 'error', message: String(err && err.message || err) }, '*'); }
  });
  addEventListener('load', function () { up.postMessage({ kind: 'ready', duration: window.__hf && window.__hf.duration }, '*'); });
})();`;
