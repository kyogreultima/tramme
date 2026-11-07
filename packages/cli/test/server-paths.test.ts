import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig, Server } from '../src/server.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('CLI project file mounts', () => {
  it('keeps URL paths inside the selected mount, including sibling prefixes', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-server-path-'));
    roots.push(temp);
    const project = path.join(temp, 'project');
    fs.mkdirSync(project);
    const inside = path.join(project, 'scene.html');
    fs.writeFileSync(inside, 'ok');
    const server = new Server({ dir: project, mounts: [['/project/', project]] });
    expect(server.resolve('/project/scene.html')).toBe(inside);
    expect(server.resolve('/project/../project-secret/secret.txt')).toBeNull();
    expect(server.resolve('/project/../../other.txt')).toBeNull();
  });

  it('does not follow a project symlink outside its mount', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-server-link-'));
    roots.push(temp);
    const project = path.join(temp, 'project');
    const privateDir = path.join(temp, 'private');
    fs.mkdirSync(project); fs.mkdirSync(privateDir);
    fs.writeFileSync(path.join(privateDir, 'secret.txt'), 'secret');
    fs.symlinkSync(privateDir, path.join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const server = new Server({ dir: project, mounts: [['/project/', project]] });
    expect(server.resolve('/project/linked/secret.txt')).toBeNull();
  });

  it('does not allow project config to replace the protected project mount', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-server-mount-'));
    roots.push(temp);
    const document = path.join(temp, 'document.tramme.json');
    const config = path.join(temp, 'tramme.config.json');
    fs.writeFileSync(document, '{}');
    fs.writeFileSync(config, JSON.stringify({ mounts: { '/project/private': '../private' } }));
    expect(() => readConfig(document)).toThrow('reserved project mount');
  });
});
