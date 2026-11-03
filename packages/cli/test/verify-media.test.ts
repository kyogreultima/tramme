import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FFMPEG } from '../src/media.ts';
import * as delivery from '../src/verify-media.ts';

let dir = '', file = '';
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-delivery-'));
  file = path.join(dir, 'tiny.mp4');
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=80x48:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
});
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe('encoded video delivery', () => {
  it('decodes the file and reports exact video properties', async () => {
    const result = await delivery.verifyMedia(file, { width: 80, height: 48, fps: 30, frames: 30, duration: 1 });
    expect(result.ok).toBe(true);
    expect(result.actual).toMatchObject({ width: 80, height: 48, fps: 30, frames: 30 });
    expect(result.actual?.duration).toBeCloseTo(1, 2);
  });

  it('fails mismatched dimensions, cadence and frame count', async () => {
    const result = await delivery.verifyMedia(file, { width: 160, fps: 24, frames: 29, duration: 2 });
    expect(result.ok).toBe(false);
    for (const word of ['width', 'fps', 'frames', 'duration']) expect(result.issues.some((i) => i.includes(word))).toBe(true);
  });

  it('fails unreadable or truncated files without throwing away the report', async () => {
    const broken = path.join(dir, 'broken.mp4');
    fs.writeFileSync(broken, fs.readFileSync(file).subarray(0, 100));
    expect((await delivery.verifyMedia(broken)).ok).toBe(false);
    expect((await delivery.verifyMedia(path.join(dir, 'missing.mp4'))).ok).toBe(false);
  });

  it('rejects unsupported formats and invalid expectations explicitly', async () => {
    const result = await delivery.verifyMedia(path.join(dir, 'frames.png'));
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/unsupported/i);
    await expect(delivery.verifyMedia(file, { fps: NaN })).rejects.toThrow(/fps/);
  });
});
