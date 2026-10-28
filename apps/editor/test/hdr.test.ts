import { describe, expect, it } from 'vitest';
import { hdrCapability } from '../src/hdr.ts';

describe('whether this browser can draw in HDR', () => {
  it('is false when the canvas refuses an HDR colour space (a context limited to 8 bits), or throws on it', () => {
    expect(hdrCapability(() => ({ getContext: () => { throw new TypeError("'rec2100-pq' is not a valid enum value"); } }))).toBe(false);
    expect(hdrCapability(() => ({ getContext: () => null }))).toBe(false);
  });

  it('is false for a context that was given, but with 8 bits and no HDR space', () => {
    expect(hdrCapability(() => ({ getContext: () => ({ getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }) }) }))).toBe(false);
  });

  it('is true for a context that holds half floats in a PQ or HLG space', () => {
    expect(hdrCapability(() => ({ getContext: () => ({ getContextAttributes: () => ({ colorType: 'float16', colorSpace: 'rec2100-pq' }) }) }))).toBe(true);
  });
});
