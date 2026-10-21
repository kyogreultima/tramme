import { describe, expect, it } from 'vitest';
import { cachedOf, groupCache, repoOf } from '../src/model-cache.ts';
import { defaultModel } from '../src/models.ts';

describe('the models in the cache', () => {
  const u2netp = defaultModel('cutout-any').source;

  it('know the repository of a model hub file', () => {
    expect(repoOf('https://huggingface.co/Xenova/yolos-tiny/resolve/main/onnx/model_quantized.onnx')).toBe('Xenova/yolos-tiny');
    expect(repoOf('https://example.com/model.onnx')).toBeNull();
  });

  it('add up the files of each model', () => {
    const groups = groupCache([
      { url: 'https://huggingface.co/Xenova/yolos-tiny/resolve/main/config.json', bytes: 1000 },
      { url: 'https://huggingface.co/Xenova/yolos-tiny/resolve/main/onnx/model.onnx', bytes: 26_000_000 },
      { url: u2netp, bytes: 4_600_000 },
      { url: 'https://huggingface.co/someone/detr-tiny/resolve/main/onnx/model.onnx', bytes: 9_000_000 },
      { url: 'https://example.com/other.bin', bytes: 5 },
    ]);
    expect(groups.map((g) => [g.id, g.bytes])).toEqual([
      ['yolos-tiny', 26_001_000], ['u2netp-person', 4_600_000], ['hub:someone/detr-tiny', 9_000_000], ['other', 5],
    ]);
    expect(groups[0].urls).toHaveLength(2);
  });

  it('do not take a model for another whose name starts the same', () => {
    const [g] = groupCache([{ url: 'https://huggingface.co/Xenova/yolos-tiny-v2/resolve/main/x.onnx', bytes: 1 }]);
    expect(g.id).toBe('hub:Xenova/yolos-tiny-v2');
  });

  it('measure a model shared by two rows for each of them', () => {
    const files = [{ url: u2netp, bytes: 4_600_000 }];
    expect(cachedOf(defaultModel('cutout-any'), files).bytes).toBe(4_600_000);
    expect(cachedOf(defaultModel('detection'), files)).toEqual({ bytes: 0, urls: [] });
  });
});
