import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { checkProject, DOCUMENT, isMedia, mimeOf, LEGACIES, MANIFEST, newProject, packProject, parseDocument, pathIssue, sceneJsonSchema, SceneSchema, srcPath, unpackProject } from '../src/index.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const json = (v: unknown) => enc(JSON.stringify(v));

function sample() {
  const { manifest, doc } = newProject({ name: 'Essai', width: 1080, height: 1920, fps: 30, duration: 5 });
  doc.assets.photo = { type: 'image', src: 'assets/photo.png' };
  return new Map<string, Uint8Array>([[MANIFEST, json(manifest)], [DOCUMENT, json(doc)], ['assets/photo.png', new Uint8Array([0x89, 0x50, 1, 2])]]);
}

describe('project format', () => {
  it('allowed and refused paths', () => {
    expect(pathIssue('assets/photo.png')).toBeNull();
    expect(pathIssue('plugins/etoile.js')).toBeNull();
    expect(pathIssue('scenes/title/scene.json')).toBeNull();
    expect(pathIssue('scenes/title/index.html')).toBeNull();
    expect(pathIssue('scenes/title/styles/main.css')).toBeNull();
    expect(pathIssue('scenes/title/OFL-LICENSE.txt')).toBeNull();
    expect(mimeOf('scenes/title/OFL-LICENSE.txt')).toContain('text/plain');
    expect(pathIssue('scenes/title/../other/index.html')).not.toBeNull();
    expect(pathIssue('scenes/title/remote.ts')).not.toBeNull();
    expect(pathIssue('thumbnail.webp')).toBeNull();
    expect(pathIssue('.tramme/chats/mfz1k2-ab12.json')).toBeNull();
    // a 3D model brought in with the sources (a folder holding .glb or .gltf files): allowed, a large .glb sent in parts
    expect(pathIssue('assets/sources/robot.glb')).toBeNull();
    expect(pathIssue('assets/sources/scene.gltf')).toBeNull();
    expect(isMedia('assets/sources/robot.glb')).toBe(true);
    expect(mimeOf('assets/models/logo-3d.glb')).toBe('model/gltf-binary');
    expect(pathIssue('.tramme/chats/index.json')).toBeNull();
    expect(pathIssue('.tramme/chats/Autre.txt')).not.toBeNull();
    expect(pathIssue('.tramme/notes.json')).not.toBeNull();
    expect(pathIssue('../secret')).toMatch(/invalid/);
    expect(pathIssue('/etc/passwd')).toMatch(/absolute/);
    expect(pathIssue('assets/virus.exe')).toMatch(/extension/);
    expect(pathIssue('elsewhere/x.png')).toMatch(/not allowed/);
    expect(pathIssue('assets/sources/README.md')).toBeNull();
    expect(pathIssue('assets/sources/notes.markdown')).toBeNull();
    expect(srcPath('assets/./a/../b.png')).toBe('assets/b.png');
    expect(srcPath('../hors.png')).toBeNull();
    expect(srcPath('/pubs/x.png')).toBeNull();
  });

  it('a new project is valid; a missing asset or a missing manifest is not', () => {
    expect(checkProject(sample()).issues).toEqual([]);
    const missing = sample(); missing.delete('assets/photo.png');
    expect(checkProject(missing).issues[0].message).toMatch(/missing file/);
    const noManifest = sample(); noManifest.delete(MANIFEST);
    expect(checkProject(noManifest).issues[0].message).toMatch(/manifest missing/);
    const badDoc = sample(); badDoc.set(DOCUMENT, enc('{"schema":"autre"}'));
    expect(checkProject(badDoc).issues.length).toBeGreaterThan(0);
  });

  it('archive: round trip without renders, wrapping folder removed, non-zip refused', () => {
    const files = sample();
    files.set('renders/film.mp4', new Uint8Array(10));
    const back = unpackProject(packProject(files));
    expect([...back.keys()].sort()).toEqual([DOCUMENT, 'assets/photo.png', MANIFEST].sort());
    expect(checkProject(back).issues).toEqual([]);
    const wrapped = zipSync(Object.fromEntries([...sample()].map(([k, v]) => [`My project/${k}`, v])));
    expect(checkProject(unpackProject(wrapped)).issues).toEqual([]);
    expect(() => unpackProject(enc('not a zip'))).toThrow(/archive/);
  });

  it('refuses excessive archive entries before inflating their contents', () => {
    const entries = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`assets/${i}.json`, enc('{}')]));
    expect(() => unpackProject(zipSync(entries))).toThrow(/too many archive entries/);
  });

  it('validates a scene manifest and keeps its files through archive export and import', () => {
    const files = sample();
    const scene = { duration: 2, size: [640, 360], entry: 'index.html', parameters: { speed: { type: 'number', default: 1 }, tint: { type: 'color', default: '#aabbcc' } } };
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect(sceneJsonSchema()).toMatchObject({ type: 'object', required: ['duration', 'size', 'entry', 'parameters'] });
    files.set('scenes/title/scene.json', json(scene));
    files.set('scenes/title/index.html', enc('<html><link rel="stylesheet" href="style.css"></html>'));
    files.set('scenes/title/style.css', enc('body { color: red }'));
    expect(checkProject(files).issues).toEqual([]);
    const restored = unpackProject(packProject(files));
    expect(restored.get('scenes/title/index.html')).toEqual(files.get('scenes/title/index.html'));
    expect(restored.get('scenes/title/scene.json')).toEqual(files.get('scenes/title/scene.json'));
    expect(checkProject(restored).issues).toEqual([]);
    files.set('scenes/title/scene.json', json({ ...scene, entry: '../other/index.html' }));
    expect(checkProject(files).issues).toContainEqual(expect.objectContaining({ path: 'scenes/title/scene.json/entry', message: expect.stringContaining('local HTML') }));
    files.delete('scenes/title/scene.json');
    expect(checkProject(files).issues).toContainEqual({ path: 'scenes/title/scene.json', message: 'scene manifest missing' });
  });

  for (const [name, l] of [['trame', LEGACIES[0]], ['emotion', LEGACIES[1]]] as const) {
    it(`an archive under a former name (${name}) is read as today`, () => {
      const { manifest, doc } = newProject({ name: 'Old', width: 640, height: 360, fps: 24, duration: 2 });
      const old = zipSync({
        [l.manifest]: json({ ...manifest, format: l.format }),
        [l.document]: json({ ...doc, schema: `${name}/1` }),
        [`${l.dir}chats/index.json`]: json([]),
      });
      const files = unpackProject(old);
      expect([...files.keys()].sort()).toEqual(['.tramme/chats/index.json', DOCUMENT, MANIFEST]);
      const r = checkProject(files);
      expect(r.issues).toEqual([]);
      expect(r.manifest!.format).toBe('tramme-project/1');
      expect(r.doc!.schema).toBe('tramme/1');
      expect(parseDocument(JSON.stringify({ ...doc, schema: `${name}/1` })).schema).toBe('tramme/1');
    });
  }
});
