import { describe, expect, it } from 'vitest';
import { chromeArgs } from '../src/browser.ts';

describe('Chromium launch options', () => {
  it('allows Chromium to start as root in the renderer container', () => {
    expect(chromeArgs(true)).toContain('--no-sandbox');
    expect(chromeArgs(false)).not.toContain('--no-sandbox');
  });
});
