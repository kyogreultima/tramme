// Production build of the editor into apps/editor/dist, served by the Worker
// as static assets: the bundles (hashed names), index.html, the key vault's
// page (vault.html, personal mode), the service worker (sw.js, personal mode),
// the pdf.js worker (pdf.worker.mjs), the examples as .tramme archives.
//
//   node apps/editor/build.ts                     build once (minified)
//   node apps/editor/build.ts --dev               rebuild on change, run `wrangler dev` (R2 simulated, no Access) and the assistant's companion
//   node apps/editor/build.ts --dev --personal    the same in personal mode: projects in the browser, the vault on 127.0.0.1

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { checkProject, MANIFEST, packProject } from '@tramme/project';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
// TRAMME_DIST: build elsewhere (benchmarks, without touching a running `npm run dev`)
const DIST = process.env.TRAMME_DIST ? path.resolve(process.env.TRAMME_DIST) : path.join(HERE, 'dist');
const dev = process.argv.includes('--dev');
const personal = process.argv.includes('--personal');

// the app's icon and its link preview (scripts/og-image.ts), shared with the site (apps/site);
// its PNGs for an installed app (scripts/app-icons.ts)
const ICON = fs.readFileSync(path.join(HERE, 'icon.svg'), 'utf8').trim();
const OG = path.join(HERE, 'og.jpg');
const ICONS = path.join(HERE, 'icons');

/** a page of the build: its bundle and stylesheet, its title, and what its head adds */
const page = (js: string, css: string | undefined, title: string, head: string) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">${head}
<title>${title}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ICON)}">
${css ? `<link rel="stylesheet" href="/${css}">` : ''}</head>
<body><div id="app"></div><script type="module" src="/${js}"></script></body></html>
`;

const EDITOR_TITLE = 'tramme, the open-source motion design editor';
const EDITOR_ABOUT = 'Make motion design in the browser: layers, keyframes, shaders and an AI assistant that edits the same JSON document as you. Your projects and keys stay on your device.';
/**
 * the editor: installable on a phone's home screen, and described for a link
 * to it (its address, the preview's and the canonical link are the Worker's to
 * add: apps/worker/src/personal.ts)
 */
const EDITOR_HEAD = `<meta name="theme-color" content="#0b0f12">
<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="tramme">
<meta name="description" content="${EDITOR_ABOUT}">
<meta property="og:type" content="website"><meta property="og:site_name" content="tramme"><meta property="og:title" content="${EDITOR_TITLE}"><meta property="og:description" content="${EDITOR_ABOUT}">
<meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="tramme: motion design, written as data. The editor, with a composition, its layers and its timeline.">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${EDITOR_TITLE}"><meta name="twitter:description" content="${EDITOR_ABOUT}">`;
/** the key vault: the editor's address, the only one it answers, set by the Worker; never in a search engine */
const VAULT_HEAD = '<meta name="tramme-app" content="%APP_ORIGIN%"><meta name="robots" content="noindex">';
/** the editor's pages: the start page only, never a project's (/p/<id>, kept on each device) */
const ROBOTS = `User-agent: *
Allow: /
Disallow: /p/
Disallow: /api/
`;

// built files have hashed names: they never change and stay cached. In dev the
// names are stable: always checked again (and versioned in the page, see below).
// The plugin sandbox may evaluate (the document's expressions, compiled there
// when it draws whole frames): its plugins run code there anyway, what it
// must not do is reach the network, which connect-src keeps closed.
const HEADERS = `/assets/*
  Cache-Control: ${dev ? 'no-cache' : 'public, max-age=31536000, immutable'}
/sw.js
  Cache-Control: no-cache
/plugin-worker.js
  Cache-Control: no-cache
  Content-Security-Policy: default-src 'none'; script-src 'self' blob: 'unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'unsafe-inline'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
`;

/** index.html and vault.html pointing at the bundles esbuild just wrote */
function writePage(meta: esbuild.Metafile) {
  const outs = Object.keys(meta.outputs).map((p) => path.relative(DIST, path.resolve(ROOT, p)).split(path.sep).join('/'));
  // in dev, a new address at each rebuild, so no browser keeps an older bundle
  const v = dev ? `?v=${Date.now().toString(36)}` : '';
  for (const [entry, file, title, head] of [['main', 'index.html', EDITOR_TITLE, EDITOR_HEAD], ['vault', 'vault.html', 'tramme', VAULT_HEAD]]) {
    const js = outs.find((p) => new RegExp(`^assets/${entry}(-[^/]+)?\\.js$`).test(p))!;
    const css = outs.find((p) => new RegExp(`^assets/${entry}(-[^/]+)?\\.css$`).test(p));
    fs.writeFileSync(path.join(DIST, file), page(`${js}${v}`, css && `${css}${v}`, title, head));
  }
  // drop the bundles of previous builds
  const keep = new Set(outs.flatMap((p) => [p, `${p}.LEGAL.txt`]));
  for (const f of fs.readdirSync(path.join(DIST, 'assets'))) if (!keep.has(`assets/${f}`)) fs.rmSync(path.join(DIST, 'assets', f));
}

/** every file of a project folder (renders/ and local state left out) */
function readFolder(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (p !== 'renders' && p !== '.tramme') walk(p); }
      else files.set(p, new Uint8Array(fs.readFileSync(path.join(dir, p))));
    }
  };
  walk('');
  return files;
}

/** the example projects (folders with a manifest) as archives, and their list */
function writeExamples() {
  const out = path.join(DIST, 'examples');
  fs.mkdirSync(out, { recursive: true });
  const list = [];
  for (const name of fs.readdirSync(path.join(ROOT, 'examples')).sort()) {
    const dir = path.join(ROOT, 'examples', name);
    if (!fs.existsSync(path.join(dir, MANIFEST))) continue;
    const files = readFolder(dir);
    const { issues, manifest, doc } = checkProject(files);
    if (issues.length || !manifest || !doc) throw new Error(`exemple ${name} : ${issues.map((i) => `${i.path} ${i.message}`).join(' ; ')}`);
    const root = doc.compositions[doc.root];
    fs.writeFileSync(path.join(out, `${manifest.id}.tramme`), packProject(files));
    // the example's thumbnail, published beside its archive for the home screen
    let thumbnail: string | undefined;
    if (manifest.thumbnail && files.has(manifest.thumbnail)) {
      thumbnail = `${manifest.id}${path.extname(manifest.thumbnail)}`;
      fs.writeFileSync(path.join(out, thumbnail), files.get(manifest.thumbnail)!);
    }
    list.push({ file: `${manifest.id}.tramme`, name: manifest.name, description: doc.meta.description ?? '', width: root.width, height: root.height, duration: root.duration, thumbnail });
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(list, null, 2));
  return list.length;
}

const options: esbuild.BuildOptions = {
  entryPoints: { main: path.join(HERE, 'src/main.tsx'), vault: path.join(HERE, 'src/vault/main.tsx') },
  outdir: path.join(DIST, 'assets'),
  // in dev, stable names: files are rewritten in place under the running `wrangler dev`
  entryNames: dev ? '[name]' : '[name]-[hash]', assetNames: '[name]-[hash]',
  bundle: true, splitting: !dev, chunkNames: 'chunk-[hash]', format: 'esm', platform: 'browser', target: 'chrome120',
  minify: !dev && !process.env.TRAMME_NOMINIFY, sourcemap: 'linked', metafile: true, logLevel: 'warning',
  jsx: 'automatic', jsxImportSource: 'preact',
  loader: { '.ttf': 'file', '.woff2': 'file', '.md': 'text' },
  legalComments: 'linked',
};

/**
 * the service worker of the personal mode: one classic script at the root, so
 * it serves every page; it keeps the editor's own files for the app to open
 * offline (`__SHELL__`, in a cache named after `__BUILD__`; none in dev)
 */
const workerOptions = (shell: string[], build: string): esbuild.BuildOptions => ({
  entryPoints: [path.join(HERE, 'src/sw.ts')], outfile: path.join(DIST, 'sw.js'),
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  minify: !dev && !process.env.TRAMME_NOMINIFY, sourcemap: 'linked', logLevel: 'warning', legalComments: 'none',
  define: { __SHELL__: JSON.stringify(shell), __BUILD__: JSON.stringify(build) },
});

/** what the installed app needs to open offline: the page, its bundles and fonts, the sandbox, the icons; and a name for this set */
function shellOf(meta: esbuild.Metafile): { shell: string[]; build: string } {
  const bundles = Object.keys(meta.outputs).map((p) => `/${path.relative(DIST, path.resolve(ROOT, p)).split(path.sep).join('/')}`).filter((p) => !/\.(map|txt)$/.test(p) && !p.startsWith('/assets/vault-'));
  const icons = fs.readdirSync(ICONS).map((f) => `/icons/${f}`);
  const shell = ['/', '/manifest.webmanifest', '/icon.svg', '/plugin-worker.js', ...icons, ...bundles.sort()];
  // the bundles' names carry their hash; the sandbox's file does not: its bytes are counted in
  const hash = createHash('sha256').update(shell.join('\n')).update(fs.readFileSync(path.join(DIST, 'plugin-worker.js'))).digest('hex').slice(0, 12);
  return { shell, build: hash };
}

/** the plugin sandbox: a module worker at a fixed address (src/plugins/worker.ts), its own bundle */
const sandboxOptions: esbuild.BuildOptions = {
  entryPoints: [path.join(HERE, 'src/plugins/worker.ts')], outfile: path.join(DIST, 'plugin-worker.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome120',
  minify: !dev && !process.env.TRAMME_NOMINIFY, sourcemap: 'linked', logLevel: 'warning', legalComments: 'none',
};

// empty the folder rather than removing it (a running `wrangler dev` watches it)
fs.mkdirSync(DIST, { recursive: true });
for (const f of fs.readdirSync(DIST)) fs.rmSync(path.join(DIST, f), { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.writeFileSync(path.join(DIST, '_headers'), HEADERS);
// installable as an app (a phone's home screen, a computer's): opens full screen, in the editor's colours,
// with the icons each system asks for (scripts/app-icons.ts)
fs.writeFileSync(path.join(DIST, 'icon.svg'), ICON);
fs.cpSync(ICONS, path.join(DIST, 'icons'), { recursive: true });
fs.copyFileSync(OG, path.join(DIST, 'og.jpg'));
fs.writeFileSync(path.join(DIST, 'robots.txt'), ROBOTS);
fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), JSON.stringify({
  id: '/', name: 'tramme', short_name: 'tramme', description: EDITOR_ABOUT, categories: ['design', 'productivity', 'video'],
  start_url: '/', scope: '/', display: 'standalone', background_color: '#0b0f12', theme_color: '#0b0f12',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
}, null, 2));
const examples = writeExamples();
// the sound library shipped with the editor (CC0 recordings and their catalog, scripts/sound-library.ts)
fs.cpSync(path.join(ROOT, 'sounds'), path.join(DIST, 'sounds'), { recursive: true });
// the plugin packs shipped with the editor (the Code section of the left panel adds them to a project)
fs.cpSync(path.join(ROOT, 'plugins'), path.join(DIST, 'plugins'), { recursive: true });
// the fonts a film copies into its project
fs.cpSync(path.join(ROOT, 'fonts'), path.join(DIST, 'fonts'), { recursive: true });
// pdf.js parses documents (the sources of a project) in a worker of its own, at a fixed address (src/pdf.ts)
fs.copyFileSync(createRequire(import.meta.url).resolve('pdfjs-dist/build/pdf.worker.min.mjs'), path.join(DIST, 'pdf.worker.mjs'));

/**
 * personal mode under `wrangler dev`: the Worker's config without the routes of
 * the deployment, which would give every request their address
 * (app.tramme.dev), so the Worker could not tell the editor from the vault;
 * written beside the Worker, its paths made absolute
 */
function personalDevConfig(): string {
  const worker = path.join(ROOT, 'apps/worker');
  // JSON with comments: the strings kept, the comments dropped
  const text = fs.readFileSync(path.join(worker, 'wrangler.jsonc'), 'utf8').replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
  const config = JSON.parse(text);
  delete config.$schema;
  delete config.env.personal.routes;
  config.main = path.join(worker, config.main);
  for (const c of [config, config.env.personal]) c.assets.directory = DIST;
  const file = path.join(worker, '.wrangler', 'personal-dev.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

if (!dev) {
  const t0 = performance.now();
  const [r] = await Promise.all([esbuild.build(options), esbuild.build(sandboxOptions)]);
  writePage(r.metafile!);
  // the service worker last: it names the files just written
  const { shell, build } = shellOf(r.metafile!);
  await esbuild.build(workerOptions(shell, build));
  const size = Object.values(r.metafile!.outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(`editor built in ${path.relative(process.cwd(), DIST)} in ${((performance.now() - t0) / 1000).toFixed(1)} s (${(size / 1e6).toFixed(1)} MB with source maps, ${examples} example(s))`);
} else {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'page', setup: (b) => b.onEnd((r) => { if (r.metafile && !r.errors.length) { writePage(r.metafile); console.log(`[build] ${new Date().toLocaleTimeString('en-GB')} editor up to date`); } }) }],
  });
  // in dev the service worker keeps nothing: the files change at every save
  const sw = await esbuild.context(workerOptions([], 'dev'));
  const sandbox = await esbuild.context(sandboxOptions);
  await Promise.all([ctx.rebuild(), sw.rebuild(), sandbox.rebuild()]);
  await Promise.all([ctx.watch(), sw.watch(), sandbox.watch()]);
  const port = process.env.PORT ?? '8787';
  // TRAMME_STATE: projects stored elsewhere (trials beside a running `npm run dev`)
  const state = process.env.TRAMME_STATE ?? '.wrangler/state';
  // personal mode: the editor on localhost, the key vault on 127.0.0.1 (another origin, as cles.<domain> in production)
  const mode = personal
    ? ['-c', personalDevConfig(), '--env', 'personal', '--var', `APP_ORIGIN:http://localhost:${port}`, '--var', `VAULT_ORIGIN:http://127.0.0.1:${port}`]
    : ['-c', 'apps/worker/wrangler.jsonc', '--var', 'DEV_OPEN:1'];
  const wrangler = spawn('npx', ['wrangler', 'dev', '--port', port, ...mode, '--persist-to', state], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  // the assistant's local companion, paired by itself with this editor (TRAMME_NO_COMPANION=1: without it)
  let companion: ReturnType<typeof spawn> | null = null, elsewhere = false;
  if (!process.env.TRAMME_NO_COMPANION) {
    companion = spawn(process.execPath, ['packages/cli/src/main.ts', 'agent', '--origin', `http://localhost:${port},http://127.0.0.1:${port}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const tell = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        // already running (another `tramme agent`): that one serves the editor
        if (/EADDRINUSE/.test(line)) { elsewhere = true; console.log('[companion] already running elsewhere, that one serves the editor'); continue; }
        if (/^\s+at |^node:|^Node\.js|^\s*\^|^\{|^\}|code: '|errno|syscall|address|port:/.test(line)) continue;
        console.log(`[companion] ${line}`);
      }
    };
    companion.stdout!.on('data', tell);
    companion.stderr!.on('data', tell);
    companion.on('exit', (code) => { if (code && !elsewhere) console.log(`[companion] stopped (code ${code}); the assistant will go through the server if it has a key`); companion = null; });
  }
  wrangler.on('exit', async (code) => { companion?.kill(); await Promise.all([ctx.dispose(), sw.dispose()]); process.exit(code ?? 0); });
  console.log(personal
    ? `[build] editor on http://localhost:${port}/ in personal mode (projects in the browser, the key vault on http://127.0.0.1:${port})`
    : `[build] editor on http://localhost:${port}/ (projects in ${state})`);
}
