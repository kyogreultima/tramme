import { describe, expect, it } from 'vitest';
import { jobId } from '../src/longjob.ts';

describe('a long job', () => {
  it('is named by its work and its file, so it resumes only on the same file', () => {
    const a = jobId('interpolate-take-2', { src: 'assets/video/take.mp4', hash: 'abc' });
    expect(a).toMatch(/^interpolate-take-2-[a-z0-9]+$/);
    expect(jobId('interpolate-take-2', { src: 'elsewhere.mp4', hash: 'abc' })).toBe(a);
    expect(jobId('interpolate-take-2', { src: 'assets/video/take.mp4', hash: 'abd' })).not.toBe(a);
    expect(jobId('interpolate-take-2', { src: 'data:video/webm;base64,AAAA' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
