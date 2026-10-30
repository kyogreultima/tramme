// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext, ToolOutput } from '@tramme/core';

await import('../src/ai/index.ts'); // first: the engine, the vocabulary and the tools import each other
const { api } = await import('../src/api.ts');
const { REFERENCE_TOOLS } = await import('../src/references/tools.ts');
const { newProject } = await import('@tramme/project');
const { load, S } = await import('../src/state.ts');

const catalogue = readFileSync('apps/editor/data/references.json', 'utf8');
const [references, keep] = [REFERENCE_TOOLS.find((t) => t.name === 'references')!, REFERENCE_TOOLS.find((t) => t.name === 'reference-keep')!];
const project = newProject({ name: 'Launch', width: 1920, height: 1080, fps: 30, duration: 10 });
project.doc.tokens = { plate: { type: 'color', value: '#0A0F1E' }, accent: { type: 'color', value: '#0B6CFF' } } as never;
project.doc.assets.f = { type: 'font', src: 'f.woff2', family: 'Inter' } as never;
load(project.doc, project.manifest, '', '');
const ctx = () => ({ doc: S.doc.peek(), compId: S.doc.peek().root, readText: async () => null, signal: new AbortController().signal }) as unknown as ToolContext;

const entry = (n: number, kept: string) => `export default ${JSON.stringify({ kind: 'tramme-reference', id: `p${n}`, project: `p${n}`, kept, title: `Film ${n} pricing launch`, why: 'a pricing launch that holds one number large '.repeat(3), tags: ['launch'], facts: { palette: ['#0A0F1E', '#0B6CFF', '#F2F5FA'], fonts: ['Inter'], kinds: ['interface', 'type'], format: '16:9' } })};\n`;
let files: Record<string, string>;
const stub = (list = files) => {
  vi.spyOn(api, 'library').mockResolvedValue(Object.keys(list).map((name) => ({ name, size: 1, modified: '' })) as never);
  vi.spyOn(api, 'libraryGet').mockImplementation(async (n: string) => list[n]);
  vi.spyOn(api, 'libraryPut').mockImplementation((async (n: string, code: string) => { files[n] = code; return { name: n, size: code.length }; }) as never);
};

beforeEach(() => {
  files = {};
  vi.stubGlobal('fetch', vi.fn(async () => new Response(catalogue, { status: 200 })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the references tool', () => {
  it('gives the entries of the craft with how to see them and how to fix a fault', async () => {
    stub();
    const out = await references.run({ query: 'talking video coverage' } as never, ctx()) as ToolOutput;
    expect(out.text).toContain('A talking video covered every ten to twenty seconds');
    expect(out.text).toMatch(/See:/);
    expect(out.text).toMatch(/Fix:/);
  });

  it('says no entry matched and gives the closest, never an empty answer', async () => {
    stub();
    const out = await references.run({ query: 'zzz' } as never, ctx()) as ToolOutput;
    expect(out.text).toMatch(/no entry matched/i);
    expect(out.text!.length).toBeGreaterThan(200);
  });

  it('adds the converging line when five kept films share one look, and ranks them lower', async () => {
    files = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`reference-p${n}.js`, entry(n, `2026-10-0${n}T10:00:00Z`)]));
    stub();
    const out = await references.run({ query: 'pricing launch' } as never, ctx()) as ToolOutput;
    expect(out.text).toContain('Your kept films are converging on one look');
    expect(out.text).toContain('the same fonts (Inter)');
    expect(out.text).toContain('take this film elsewhere');
  });

  it('answers from the shipped catalogue when the library cannot be read, and says so', async () => {
    vi.spyOn(api, 'library').mockRejectedValue(new Error('no server'));
    const out = await references.run({ query: 'ending' } as never, ctx()) as ToolOutput;
    expect(out.text).toContain('ending');
    expect(out.text).toMatch(/kept films could not be read/);
  });
});

describe('the reference-keep tool', () => {
  const why = 'The price is the biggest thing on screen, the camera pushes onto it once, and the sound drops out just before it lands.';

  it('asks for the reasons in words: a short why is an error, and nothing is written', async () => {
    stub();
    await expect(keep.run({ title: 'Launch', why: 'looks good', tags: ['launch'] } as never, ctx())).rejects.toThrow(/80 characters/);
    expect(Object.keys(files)).toEqual([]);
  });

  it('writes the entry with what is known of the film, and replaces it when kept again for the same project', async () => {
    stub();
    await keep.run({ title: 'Launch', why, tags: ['launch', 'sound'] } as never, ctx());
    await keep.run({ title: 'Launch, again', why, tags: ['launch'] } as never, ctx());
    const names = Object.keys(files);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^reference-[a-z0-9_-]+\.js$/);
    const written = JSON.parse(files[names[0]].replace(/^export default\s*/, '').replace(/;\s*$/, ''));
    expect(written).toMatchObject({ kind: 'tramme-reference', title: 'Launch, again', facts: { palette: ['#0A0F1E', '#0B6CFF'], fonts: ['Inter'], kinds: [], format: '16:9' } });
  });

  it('refuses a tag that is not in the closed list', async () => {
    stub();
    await expect(keep.run({ title: 'x', why, tags: ['gorgeous'] } as never, ctx())).rejects.toThrow(/gorgeous/);
  });

  it('reports the error and writes nothing when the library cannot be written', async () => {
    stub();
    vi.spyOn(api, 'libraryPut').mockRejectedValue(new Error('no library'));
    await expect(keep.run({ title: 'x', why, tags: ['launch'] } as never, ctx())).rejects.toThrow(/no library/);
    expect(Object.keys(files)).toEqual([]);
  });
});
