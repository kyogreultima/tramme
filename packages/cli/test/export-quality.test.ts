import { describe, expect, it } from 'vitest';
import { encoderArgs, type EncoderJob } from '../src/media.ts';

const job = (over: Partial<EncoderJob> = {}): EncoderJob => ({ format: 'mp4', W: 1920, H: 1080, fps: 30, frames: 60, out: 'film.mp4', ...over });
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('the two qualities of an export', () => {
  it('encodes fast by default: the quick preset, for the web and social networks', () => {
    const args = encoderArgs(job());
    expect(after(args, '-preset')).toBe('veryfast');
    expect(after(args, '-crf')).toBe('18');
  });

  it('encodes a master with the slow preset, the best picture for its size', () => {
    const args = encoderArgs(job({ quality: 'master' }));
    expect(after(args, '-preset')).toBe('slow');
    expect(after(args, '-crf')).toBe('16');
  });

  it('keeps a CRF given by hand at either quality', () => {
    expect(after(encoderArgs(job({ crf: 22 })), '-crf')).toBe('22');
    expect(after(encoderArgs(job({ crf: 12, quality: 'master' })), '-crf')).toBe('12');
  });

  it('follows the quality for VP9 and 10-bit H.265 too', () => {
    expect(after(encoderArgs(job({ format: 'webm', out: 'film.webm' })), '-cpu-used')).toBe('4');
    expect(after(encoderArgs(job({ format: 'webm', out: 'film.webm', quality: 'master' })), '-cpu-used')).toBe('2');
    expect(after(encoderArgs(job({ depth: 10, quality: 'master' })), '-preset')).toBe('slow');
  });
});
