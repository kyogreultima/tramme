import { describe, expect, it } from 'vitest';
import { osOf } from '../src/lib/os';
import { read } from './sources';

const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

describe("the visitor's system", () => {
  it('is Android on an Android phone, though its user agent also says Linux', () => {
    expect(osOf(PIXEL, 'Linux armv8l', 5)).toBe('android');
    expect(osOf(PIXEL, '', 5)).toBe('android');
  });

  it('is told for the computers', () => {
    expect(osOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0)).toBe('windows');
    expect(osOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe('mac');
    expect(osOf('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 0)).toBe('linux');
  });

  it('is none for an iPhone, an iPad that says it is a Mac, or a Chromebook', () => {
    expect(osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5)).toBe('');
    expect(osOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe('');
    expect(osOf('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', 'Linux x86_64', 0)).toBe('');
  });

  it('is what the page runs before its first paint', () => {
    expect(read('components/Platform.astro')).toContain("osOf.toString()");
  });
});
