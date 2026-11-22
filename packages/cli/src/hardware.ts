// The machine's hardware H.264 encoder, for the fast exports (media.ts): the
// video chip of the graphics card (NVENC, Quick Sync, AMF) or of the Mac
// (VideoToolbox) handles compression. ffmpeg lists an
// encoder it was built with even where the chip or its driver is missing, so
// each candidate is tried on a short clip, in order, and the first that works
// is kept, remembered for the machine (a file in its temporary folder) until
// ffmpeg changes. None works: the software encoder, as before.
//
//   TRAMME_HW_ENCODER=off            the software encoder always
//   TRAMME_HW_ENCODER=h264_qsv       that encoder, untried

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG } from './media.ts';

/** a hardware encoder: its ffmpeg name, its settings at a quality close to the fast software one, the pixels it takes */
export interface HardwareEncoder { name: string; args: string[]; pixFmt: string; inputArgs?: string[] }

const ENCODERS: Record<string, HardwareEncoder> = {
  h264_nvenc: { name: 'h264_nvenc', args: ['-preset', 'p4', '-rc', 'vbr', '-cq', '21', '-b:v', '0'], pixFmt: 'yuv420p' },
  h264_qsv: { name: 'h264_qsv', args: ['-preset', 'faster', '-global_quality', '21', '-look_ahead', '0'], pixFmt: 'nv12' },
  h264_amf: { name: 'h264_amf', args: ['-quality', 'speed', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22', '-qp_b', '24'], pixFmt: 'nv12' },
  h264_mf: { name: 'h264_mf', args: ['-hw_encoding', '1', '-rate_control', 'quality', '-quality', '75'], pixFmt: 'nv12' },
  h264_vaapi: { name: 'h264_vaapi', inputArgs: ['-vaapi_device', '/dev/dri/renderD128'], args: ['-vf', 'format=nv12,hwupload', '-qp', '21'], pixFmt: 'vaapi' },
  h264_videotoolbox: { name: 'h264_videotoolbox', args: ['-q:v', '65', '-allow_sw', '0'], pixFmt: 'nv12' },
};

/** the encoders tried on this system, the most common chip first */
export function candidates(platform = process.platform): string[] {
  if (platform === 'darwin') return ['h264_videotoolbox'];
  if (platform === 'win32') return ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf'];
  if (platform === 'linux') return ['h264_nvenc', 'h264_qsv', 'h264_vaapi'];
  return [];
}

/** whether an encoder encodes a short clip here */
function works(enc: HardwareEncoder): Promise<boolean> {
  return new Promise((resolve) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...(enc.inputArgs ?? []), '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=0.3',
      '-c:v', enc.name, ...enc.args, '-pix_fmt', enc.pixFmt, '-f', 'null', '-'], { stdio: 'ignore' });
    const timer = setTimeout(() => { ff.kill(); resolve(false); }, 15_000);
    ff.on('error', () => { clearTimeout(timer); resolve(false); });
    ff.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

const CACHE = path.join(os.tmpdir(), 'tramme-hardware-encoder-v2.json');
/** what the remembered choice was made with: this ffmpeg, as it is */
const stamp = () => { try { const s = fs.statSync(FFMPEG); return `${FFMPEG}|${s.size}|${s.mtimeMs}`; } catch { return FFMPEG; } };

const failed = new Set<string>();
let chosen: Promise<HardwareEncoder | null> | null = null;

/** the machine's hardware H.264 encoder, or null: tried once, then remembered */
export function hardwareH264(): Promise<HardwareEncoder | null> {
  const asked = process.env.TRAMME_HW_ENCODER;
  if (asked === 'off') return Promise.resolve(null);
  if (asked) return Promise.resolve(failed.has(asked) ? null : ENCODERS[asked] ?? null);
  chosen ??= (async () => {
    try {
      const kept = JSON.parse(fs.readFileSync(CACHE, 'utf8')) as { stamp: string; name: string | null };
      if (kept.stamp === stamp()) return kept.name ? ENCODERS[kept.name] ?? null : null;
    } catch { /* not tried on this machine yet */ }
    let found: HardwareEncoder | null = null;
    for (const name of candidates()) if (await works(ENCODERS[name])) { found = ENCODERS[name]; break; }
    remember(found);
    return found;
  })();
  return chosen;
}

/** the choice kept for this machine (written whole, then moved into place: two exports at once never read half a file) */
function remember(found: HardwareEncoder | null): void {
  const tmp = `${CACHE}.${randomUUID()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ stamp: stamp(), name: found?.name ?? null }));
    fs.renameSync(tmp, CACHE);
  } catch { /* this process still remembers the result */ }
  finally { try { fs.rmSync(tmp, { force: true }); } catch { /* cache is best effort */ } }
}

/**
 * An encoder that failed during an export: the trial of a short clip passed, the
 * film did not (several sessions at once over the chip's limit, a driver that
 * gives up on long streams). It is left aside on this machine, as a failed
 * trial is, so each later export does not render its film twice; a new ffmpeg
 * tries again.
 */
export function forgetHardware(enc: HardwareEncoder): void {
  failed.add(enc.name);
  chosen = Promise.resolve(null);
  if (!process.env.TRAMME_HW_ENCODER) remember(null);
}
