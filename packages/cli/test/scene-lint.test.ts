import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { newProject } from '@tramme/project';
import { lintSceneFiles } from '../src/scene-lint.ts';

const files = (source: string, path = 'scenes/title/index.js') => new Map([[path, new TextEncoder().encode(source)]]);

describe('seekable web scene lint', () => {
  it('reports nondeterministic browser APIs with a file and line', () => {
    const issues = lintSceneFiles(files(`const a = Date.now();
const b = Math['random']();
fetch('/api');
window.requestAnimationFrame(draw);`));
    expect(issues.map((i) => `${i.path}:${i.line} ${i.message}`)).toEqual([
      expect.stringContaining('index.js:1 Date.now'),
      expect.stringContaining('index.js:2 Math.random'),
      expect.stringContaining('index.js:3 fetch'),
      expect.stringContaining('index.js:4 requestAnimationFrame'),
    ]);
  });

  it('checks inline scripts but ignores comments, text, JSON and local names', () => {
    const html = `<p>fetch() Date.now()</p>
<script type="application/json">{"call":"fetch()"}</script>
<script>// Math.random()
const fetch = (value) => value;
fetch('local');
globalThis['fetch']('/api');
</script>`;
    const issues = lintSceneFiles(files(html, 'scenes/title/index.html'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: 'scenes/title/index.html', line: 6 });
    expect(issues[0].message).toContain('fetch');
  });

  it('ignores non-scene files', () => {
    expect(lintSceneFiles(files('fetch("remote")', 'plugins/tool.js'))).toEqual([]);
  });

  it('refuses a scene script over one megabyte before parsing it', () => {
    const issues = lintSceneFiles(files('x'.repeat(1024 * 1024 + 1)));
    expect(issues).toEqual([{ path: 'scenes/title/index.js', line: 1, message: 'scene script exceeds 1 MB' }]);
  });

  it('refuses aliases and computed access to nondeterministic globals', () => {
    const issues = lintSceneFiles(files(`const { random } = Math;
const { fetch: network } = globalThis;
const key = 'fetch'; globalThis[key]('/api');`));
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringContaining('Math.random'),
      expect.stringContaining('fetch'),
      expect.stringContaining('dynamic global access'),
    ]);
  });

  it('tramme check names and refuses a nondeterministic scene file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-scene-check-'));
    try {
      const { manifest, doc } = newProject({ name: 'Seek test', width: 64, height: 64, fps: 1, duration: 1 });
      fs.mkdirSync(path.join(dir, 'scenes', 'title'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'tramme.json'), JSON.stringify(manifest));
      fs.writeFileSync(path.join(dir, 'document.tramme.json'), JSON.stringify(doc));
      fs.writeFileSync(path.join(dir, 'scenes', 'title', 'scene.json'), JSON.stringify({ duration: 1, size: [64, 64], entry: 'index.html', parameters: {} }));
      fs.writeFileSync(path.join(dir, 'scenes', 'title', 'index.html'), '<script>fetch("/api")</script>');
      const run = spawnSync(process.execPath, ['packages/cli/src/main.ts', 'check', dir], { encoding: 'utf8', cwd: process.cwd() });
      expect(run.status).not.toBe(0);
      expect(run.stdout + run.stderr).toContain('scenes/title/index.html:1');
      expect(run.stdout + run.stderr).toContain('fetch is not seekable');
      const packed = spawnSync(process.execPath, ['packages/cli/src/main.ts', 'pack', dir, '--out', path.join(dir, 'scene.tramme')], { encoding: 'utf8', cwd: process.cwd() });
      expect(packed.status).not.toBe(0);
      expect(packed.stdout + packed.stderr).toContain('fetch is not seekable');
    } finally {
      if (path.relative(os.tmpdir(), dir).startsWith('tramme-scene-check-')) fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
