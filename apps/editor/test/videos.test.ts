// The clips' tool, its pure parts: the proportions a composition calls for,
// and the vocabulary the / menu and the assistant reach.

import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {} });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('addEventListener', () => {});

const videos = await import('../src/videos.ts');
const vocabulary = await import('../src/vocabulary.ts');

describe('clips', () => {
  it('asks the proportions the composition calls for: wide or tall', () => {
    expect(videos.clipRatio(1920, 1080)).toBe('16:9');
    expect(videos.clipRatio(1080, 1920)).toBe('9:16');
    expect(videos.clipRatio(1000, 1000)).toBe('16:9');
  });

  it('is a tool of the / menu and of the assistant, with the lengths Veo takes', () => {
    const tool = vocabulary.editorRegistry().tool('generate-video').tool;
    const props = (tool.input?.properties ?? {}) as Record<string, { enum?: unknown[]; format?: string }>;
    expect(props.duration?.enum).toEqual([4, 6, 8]);
    expect(props.provider?.enum).toEqual(['hydracept']);
    expect(props.again?.format).toBe('asset');
  });
});
