import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { CHROME } from '../src/browser.ts';

describe('CLI vector expression boundary', () => {
  it('refuses export and comparison before native expression evaluation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-vector-expression-'));
    try {
      const doc = newProject({ name: 'Expression', width: 64, height: 64, fps: 1, duration: 1 }).doc;
      doc.compositions.main.layers.rect = { type: 'shape.rect', transform: {}, props: { size: [64, 64], fill: { $expr: '"#ff0000"' } } } as never;
      doc.compositions.main.order = ['rect'];
      const file = path.join(dir, 'document.tramme.json');
      fs.writeFileSync(file, JSON.stringify(doc));
      const compare = spawnSync(process.execPath, ['packages/cli/src/main.ts', 'check-export', file, '--format', 'svg', '--out', path.join(dir, 'check-export.svg')], {
        encoding: 'utf8', cwd: process.cwd(), timeout: 20_000,
      });
      expect(compare.status).toBe(1);
      expect(compare.stderr).toMatch(/requires an isolated renderer/);
      const check = spawnSync(process.execPath, ['packages/cli/src/main.ts', 'check', file], {
        encoding: 'utf8', cwd: process.cwd(), timeout: 20_000,
      });
      expect(check.status).toBe(1);
      expect(check.stderr).toMatch(/isolated evaluator/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  it.skipIf(!CHROME)('converts an expression-bearing project in the render page sandbox', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-vector-sandbox-'));
    try {
      const doc = newProject({ name: 'Expression', width: 64, height: 64, fps: 1, duration: 1 }).doc;
      doc.compositions.main.layers.rect = { type: 'shape.rect', transform: {}, props: { size: [64, 64], fill: { $expr: '"#ff" + "0000"' } } } as never;
      doc.compositions.main.order = ['rect'];
      const file = path.join(dir, 'document.tramme.json');
      fs.writeFileSync(file, JSON.stringify(doc));
      for (const format of ['svg', 'lottie']) {
        const out = path.join(dir, `out.${format}`);
        const run = spawnSync(process.execPath, ['packages/cli/src/main.ts', 'export', file, '--format', format, '--out', out], { encoding: 'utf8', cwd: process.cwd(), timeout: 60_000 });
        expect(run.status, run.stderr).toBe(0);
        const text = fs.readFileSync(out, 'utf8');
        if (format === 'svg') expect(text.toLowerCase()).toMatch(/#ff0000|rgb\(255, ?0, ?0\)/);
        else expect(JSON.parse(text)).toMatchObject({ layers: expect.any(Array) });
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
