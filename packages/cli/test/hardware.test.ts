import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// the module keeps its choice in the temporary folder: this test's own
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-hw-'));
vi.spyOn(os, 'tmpdir').mockReturnValue(dir);
const { candidates, forgetHardware, hardwareH264 } = await import('../src/hardware.ts');
const { FFMPEG } = await import('../src/media.ts');
const cache = path.join(dir, 'tramme-hardware-encoder-v2.json');
const stamp = () => { const s = fs.statSync(FFMPEG); return `${FFMPEG}|${s.size}|${s.mtimeMs}`; };
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the hardware encoder', () => {
  it('tries the chips of each system, the most common first', () => {
    expect(candidates('win32')[0]).toBe('h264_nvenc');
    expect(candidates('darwin')).toEqual(['h264_videotoolbox']);
    expect(candidates('linux')).toContain('h264_vaapi');
    expect(candidates('aix')).toEqual([]);
  });

  it('uses the encoder remembered for this ffmpeg, and leaves aside for good one that failed during an export', async () => {
    delete process.env.TRAMME_HW_ENCODER;
    fs.writeFileSync(cache, JSON.stringify({ stamp: stamp(), name: 'h264_qsv' }));
    const kept = await hardwareH264();
    expect(kept?.name).toBe('h264_qsv');
    // the trial passed, the film did not: the next exports on this machine encode in software at once, not twice
    forgetHardware(kept!);
    expect(await hardwareH264()).toBeNull();
    expect(JSON.parse(fs.readFileSync(cache, 'utf8'))).toEqual({ stamp: stamp(), name: null });
  });

  it('obeys TRAMME_HW_ENCODER', async () => {
    process.env.TRAMME_HW_ENCODER = 'off';
    expect(await hardwareH264()).toBeNull();
    process.env.TRAMME_HW_ENCODER = 'h264_nvenc';
    expect((await hardwareH264())?.name).toBe('h264_nvenc');
    delete process.env.TRAMME_HW_ENCODER;
  });
});
