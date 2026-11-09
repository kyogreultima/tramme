import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { fileAssetReader } from '../src/node.ts';

describe('native export asset reads', () => {
  it('reads project files and refuses traversal and links outside the project', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-export-path-'));
    try {
      const project = path.join(temp, 'project'), privateDir = path.join(temp, 'private');
      fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
      fs.mkdirSync(privateDir);
      fs.writeFileSync(path.join(project, 'assets', 'own.woff2'), 'own');
      fs.writeFileSync(path.join(privateDir, 'secret.woff2'), 'secret');
      fs.symlinkSync(privateDir, path.join(project, 'assets', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      const doc = newProject({ name: 'Paths', width: 64, height: 64, fps: 1, duration: 1 }).doc;
      doc.assets.own = { type: 'font', src: 'assets/own.woff2' };
      doc.assets.traversal = { type: 'font', src: '../private/secret.woff2' };
      doc.assets.link = { type: 'font', src: 'assets/linked/secret.woff2' };
      const read = fileAssetReader(doc, project);
      expect(new TextDecoder().decode(read('own')!.data)).toBe('own');
      expect(read('traversal')).toBeNull();
      expect(read('link')).toBeNull();
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });

  it('refuses an oversized file before reading its bytes', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-export-size-'));
    try {
      const file = path.join(project, 'large.woff2');
      fs.closeSync(fs.openSync(file, 'w'));
      fs.truncateSync(file, 16 * 1048576 + 1);
      const doc = newProject({ name: 'Size', width: 64, height: 64, fps: 1, duration: 1 }).doc;
      doc.assets.large = { type: 'font', src: 'large.woff2' };
      expect(() => fileAssetReader(doc, project)('large')).toThrow('asset "large" exceeds 16 MB');
    } finally { fs.rmSync(project, { recursive: true, force: true }); }
  });
});
