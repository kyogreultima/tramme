import { describe, expect, it } from 'vitest';
import { buildSceneFrame, SCENE_FRAME_CSP, SCENE_FRAME_SANDBOX } from '../src/webscene-frame.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const RUNTIME = 'export const sceneController = () => ({});';

function project(files: Record<string, string | Uint8Array>) {
  const reads: string[] = [];
  const read = async (path: string) => { reads.push(path); const f = files[path]; return f === undefined ? null : typeof f === 'string' ? enc(f) : f; };
  const frame = (entry = 'index.html', css = '') => buildSceneFrame({ folder: 'scenes/title', entry, css, runtime: RUNTIME, read });
  return { frame, reads };
}
const importMap = (html: string) => JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]).imports as Record<string, string>;
const decode = (url: string) => atob(url.split(',')[1]);

describe('the document of a web scene preview', () => {
  it('closes the frame: no network, a sandbox without the editor\'s origin, one door', async () => {
    const html = await project({ 'scenes/title/index.html': '<html><head></head><body>hi</body></html>' }).frame();
    expect(SCENE_FRAME_SANDBOX).toBe('allow-scripts');
    expect(html).toContain(`content="${SCENE_FRAME_CSP}"`);
    for (const rule of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'"]) expect(SCENE_FRAME_CSP).toContain(rule);
    expect(SCENE_FRAME_CSP).not.toMatch(/https?:|\*|'self'/);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script>'));
    expect(html).toContain('e.source !== up');
  });

  it('puts the scene\'s files in the document: scripts, modules, styles, pictures and fonts', async () => {
    const { frame, reads } = project({
      'scenes/title/index.html': `<!doctype html><html><head><link rel="stylesheet" href="style.css"><script src="classic.js"></script></head><body>
        <img src="logo.png"><div style="background:url(/assets/bg.png)"></div>
        <script type="module">import { sceneController } from '/vendor/scene-runtime.js'; import { helper } from './lib/helper.js'; helper(sceneController);</script></body></html>`,
      'scenes/title/style.css': '@font-face{font-family:T;src:url(fonts/t.woff2)} body{background:url("../../assets/paper.png")}',
      'scenes/title/classic.js': 'window.classic = "</script>";',
      'scenes/title/lib/helper.js': "import { more } from '../more.js'; export const helper = more;",
      'scenes/title/more.js': 'export const more = 1;',
      'scenes/title/logo.png': new Uint8Array([137, 80, 78, 71]),
      'scenes/title/fonts/t.woff2': new Uint8Array([1, 2, 3]),
      'assets/bg.png': new Uint8Array([9]),
      'assets/paper.png': new Uint8Array([8]),
    });
    const html = await frame('index.html', ':root { --ink: #111; }');
    expect(html).not.toMatch(/<script[^>]*\ssrc=|<link/);
    expect(html).toContain('window.classic = "<\\/script>";');
    expect(html).toContain('<style id="tramme-tokens">:root { --ink: #111; }</style>');
    expect(html).toContain('<img src="data:image/png;base64,iVBORw==">');
    expect(html).toContain("url(&quot;data:image/png;base64,CQ==&quot;)");
    expect(html).toContain('url("data:font/woff2;base64,AQID")');
    expect(html).toContain('url("data:image/png;base64,CA==")');
    expect(html).toContain("'scene:runtime'");
    expect(html).toContain("'scene:scenes/title/lib/helper.js'");
    const map = importMap(html);
    expect(Object.keys(map).sort()).toEqual(['scene:runtime', 'scene:scenes/title/lib/helper.js', 'scene:scenes/title/more.js']);
    expect(decode(map['scene:runtime'])).toBe(RUNTIME);
    expect(decode(map['scene:scenes/title/lib/helper.js'])).toBe("import { more } from 'scene:scenes/title/more.js'; export const helper = more;");
    expect(reads).toContain('scenes/title/fonts/t.woff2');
  });

  it('leaves references to the network and to other places alone, and reads nothing outside the scene and assets/', async () => {
    const { frame, reads } = project({
      'scenes/title/index.html': `<head></head><img src="https://example.com/x.png"><img src="//cdn.test/y.png"><img src="../other/z.png"><img src="../../plugins/p.js"><img src="/document.tramme.json">
        <script type="module" src="https://example.com/a.js"></script><script type="module">import 'https://example.com/b.js'; import('../../plugins/evil.js');</script>`,
      'scenes/other/z.png': 'z', 'plugins/p.js': 'p', 'plugins/evil.js': 'e', 'document.tramme.json': '{}',
    });
    const html = await frame();
    expect(html).toContain('src="https://example.com/x.png"');
    expect(html).toContain('src="//cdn.test/y.png"');
    expect(html).toContain('src="../other/z.png"');
    expect(html).toContain('src="/document.tramme.json"');
    expect(html).toContain("import 'https://example.com/b.js'");
    expect(importMap(html)).toEqual({ 'scene:runtime': expect.any(String) });
    expect(reads).toEqual(['scenes/title/index.html']);
  });

  it('refuses a missing entry, an entry outside the scene, and files over the budget', async () => {
    await expect(project({}).frame()).rejects.toThrow('entry index.html is missing');
    await expect(project({ 'scenes/title/x.html': 'x' }).frame('../other/index.html')).rejects.toThrow('missing');
    await expect(project({ 'scenes/title/index.html': '<head></head><img src="big.png">', 'scenes/title/big.png': new Uint8Array(9 * 1024 * 1024) }).frame()).rejects.toThrow('too large');
    const many = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`scenes/title/f${i}.png`, new Uint8Array(7 * 1024 * 1024)]));
    await expect(project({ 'scenes/title/index.html': `<head></head>${Object.keys(many).map((k) => `<img src="${k.split('/').pop()}">`).join('')}`, ...many }).frame()).rejects.toThrow('add up to more than');
  });

  it('survives modules that import each other, and names its limits', async () => {
    const { frame } = project({
      'scenes/title/index.html': '<head></head><script type="module">import "./a.js";</script>',
      'scenes/title/a.js': "import './b.js';", 'scenes/title/b.js': "import './a.js';",
    });
    expect(Object.keys(importMap(await frame())).sort()).toEqual(['scene:runtime', 'scene:scenes/title/a.js', 'scene:scenes/title/b.js']);
  });
});
