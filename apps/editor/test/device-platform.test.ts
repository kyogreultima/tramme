import { describe, expect, it } from 'vitest';
import { platformOf } from '../src/tauri.ts';

const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

describe('where the editor runs', () => {
  it('the web has no platform, even on an Android browser', () => {
    expect(platformOf(false, 'Android')).toBeUndefined();
    expect(platformOf(false, PIXEL)).toBeUndefined();
  });

  it("the phone's app is android, the computer's is desktop", () => {
    expect(platformOf(true, PIXEL)).toBe('android');
    expect(platformOf(true, 'Windows NT 10.0')).toBe('desktop');
    expect(platformOf(true, 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130')).toBe('desktop');
  });
});
