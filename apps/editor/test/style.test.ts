import { describe, expect, it } from 'vitest';
import { memoryRecords, recordBucket, storageRoute } from '@tramme/api';
import { newProject } from '@tramme/project';
import { styleFile, styleOf, styleWords, isStyle } from '../src/style.ts';

describe('a style kept for the next projects', () => {
  it('takes the palette, the typefaces, the tone and the rules of a project', () => {
    const { doc } = newProject({ name: 'Vélo', width: 1080, height: 1920, fps: 30, duration: 10 });
    doc.tokens = { ink: { type: 'color', value: '#101418' }, accent: { type: 'color', value: '#2ec4b6' }, gap: { type: 'number', value: 8 } } as never;
    doc.assets.title = { type: 'font', src: 'assets/fonts/a.woff2', family: 'Geist' } as never;
    const s = styleOf('Mes vidéos vélo', doc, { tone: 'warm, direct', rules: ['no gradients'] });
    expect(isStyle(s)).toBe(true);
    expect(s.colors).toEqual([['ink', '#101418'], ['accent', '#2ec4b6']]);
    expect(s.fonts).toEqual(['Geist']);
    expect(styleFile(s.name)).toBe('mes-videos-velo.json');
    expect(styleWords(s)).toBe('Follow my style "Mes vidéos vélo" from the start. palette: ink #101418, accent #2ec4b6 (set them as the project\'s colour tokens). typefaces: Geist. tone: warm, direct. rules: no gradients.');
  });

  it('is kept on the styles shelf of the storage, and only as a .json', async () => {
    const bucket = recordBucket(memoryRecords());
    const at = (p: string) => new URL(`http://x/api/${p}`);
    const put = await storageRoute(new Request(at('styles/mine.json'), { method: 'PUT', body: '{"kind":"style"}' }), bucket, at('styles/mine.json'));
    expect(put!.status).toBe(200);
    expect(((await (await storageRoute(new Request(at('styles')), bucket, at('styles')))!.json()) as { name: string }[]).map((x) => x.name)).toEqual(['mine.json']);
    // refused before anything is kept (the caller answers it as a 400)
    await expect(storageRoute(new Request(at('styles/x.js'), { method: 'PUT', body: '1' }), bucket, at('styles/x.js'))).rejects.toMatchObject({ status: 400 });
  });
});
