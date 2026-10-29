import { describe, expect, it } from 'vitest';
import type { Layer, TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { checkReport } from '../src/check.ts';

/** a 40 s talking video: the speaker full frame, two titles in the first seconds */
function talk(): TrammeDoc {
  const layers: Record<string, Partial<Layer>> = {
    speaker: { type: 'video', transform: { position: [960, 540] }, props: { video: 'talk', size: [1920, 1080] } },
    one: { type: 'text', in: 0, out: 3, transform: { position: [960, 200] }, props: { text: 'Opening', size: 96, align: 'center', baseline: 'middle' } },
    tiny: { type: 'text', in: 0, out: 6, transform: { position: [960, 900] }, props: { text: 'small print', size: 12, align: 'center', baseline: 'middle' } },
  };
  return {
    schema: 'tramme/1', meta: { title: 'Talk' }, tokens: {}, assets: { talk: { type: 'video', src: 'talk.mp4' } }, root: 'main',
    compositions: { main: { name: 'Main', width: 1920, height: 1080, fps: 30, duration: 40, layers: layers as Record<string, Layer>, order: Object.keys(layers) } },
  };
}

describe('tramme check', () => {
  it('opens with the count of warnings and notes, then a line per kind of issue', async () => {
    const text = await checkReport(talk(), builtinRegistry());
    const [head, ...lines] = text.split('\n');
    expect(head).toMatch(/^\d+ warning\(s\), \d+ note\(s\)\.$/);
    expect(lines.some((l) => l.includes('Only the speaker is on screen from 6 s to 40 s'))).toBe(true);
    expect(lines.some((l) => l.includes('"tiny" is about 12 px high'))).toBe(true);
  });

  it('says so when nothing is found, and what the command leaves out', async () => {
    const clean = talk();
    clean.compositions.main.duration = 5;
    delete clean.compositions.main.layers.tiny;
    const text = await checkReport(clean, builtinRegistry());
    expect(text.split('\n')[0]).toBe('No issue found by the checks.');
    expect(text).toContain('sound');
  });

  it('refuses a composition that does not exist', async () => {
    await expect(checkReport(talk(), builtinRegistry(), 'nope')).rejects.toThrow(/nope/);
  });
});
