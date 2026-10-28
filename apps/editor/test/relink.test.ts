import { describe, expect, it } from 'vitest';
import type { Asset } from '@tramme/core';
import { matchRelink } from '../src/relink.ts';

const missing: [string, Asset][] = [
  ['talk', { type: 'video', src: 'assets/video/Talk.mp4', hash: 'sha256:aa' }],
  ['logo', { type: 'image', src: 'assets/images/logo.png' }],
  ['theme', { type: 'audio', src: 'assets/sounds/theme.mp3', hash: 'sha256:cc' }],
];

describe('finding the files of media gone missing', () => {
  it('takes the file with the same content first, whatever its name', () => {
    const m = matchRelink(missing, [{ name: 'IMG_0042.mov', hash: 'sha256:aa' }, { name: 'talk.mp4', hash: 'sha256:zz' }]);
    expect(m.get('talk')).toBe(0);
  });

  it('then the file with the same name, case aside, when the media has no hash or the file is not hashed', () => {
    const m = matchRelink(missing, [{ name: 'LOGO.PNG' }, { name: 'theme.mp3' }]);
    expect(m.get('logo')).toBe(0);
    expect(m.get('theme')).toBe(1);
  });

  it('does not take a file for two media, nor a file that is another content under the name', () => {
    const m = matchRelink([['a', { type: 'image', src: 'x/pic.png' }], ['b', { type: 'image', src: 'y/pic.png' }]], [{ name: 'pic.png' }]);
    expect([...m.keys()]).toEqual(['a']);
    expect(matchRelink(missing, [{ name: 'theme.mp3', hash: 'sha256:other' }]).has('theme')).toBe(false);
  });

  it('leaves out the media nothing matches', () => {
    expect(matchRelink(missing, [{ name: 'unrelated.txt' }]).size).toBe(0);
  });
});
