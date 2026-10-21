// 10-bit exports in the browser (docs/editing-roadmap.md, step 14): the
// frame read at 16 bits from the compositor's half-float target, turned into
// the planes a 10-bit encoder takes (I420P10: BT.709, limited range), and
// the 10-bit codecs this browser can encode, asked to WebCodecs before the
// export offers them.

/** straight RGBA at 16 bits (w×h×4) to I420P10 planes (Y w×h, then U and V w/2×h/2), BT.709 limited range */
export function i420p10(rgba: Uint16Array, w: number, h: number, out = new Uint16Array(w * h + 2 * (w / 2) * (h / 2))): Uint16Array {
  const K = [0.2126, 0.7152, 0.0722], cw = w / 2, uOff = w * h, vOff = uOff + cw * (h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const l = (K[0] * rgba[i] + K[1] * rgba[i + 1] + K[2] * rgba[i + 2]) / 65535;
    out[y * w + x] = Math.round(64 + 876 * Math.min(1, Math.max(0, l)));
  }
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < cw; x++) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = ((2 * y + dy) * w + 2 * x + dx) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; }
    r /= 4 * 65535; g /= 4 * 65535; b /= 4 * 65535;
    const l = K[0] * r + K[1] * g + K[2] * b;
    out[uOff + y * cw + x] = Math.round(512 + 896 * ((b - l) / 1.8556));
    out[vOff + y * cw + x] = Math.round(512 + 896 * ((r - l) / 1.5748));
  }
  return out;
}

/** a 10-bit codec: its name for the muxer and its full WebCodecs string */
export interface DeepCodec { codec: 'hevc' | 'vp9' | 'av1'; full: string; label: string }

const DEEP: Record<'mp4' | 'webm', DeepCodec[]> = {
  mp4: [
    { codec: 'hevc', full: 'hvc1.2.4.L153.B0', label: 'H.265 Main 10' },
    { codec: 'av1', full: 'av01.0.08M.10', label: 'AV1 10-bit' },
    { codec: 'vp9', full: 'vp09.02.40.10', label: 'VP9 profile 2' },
  ],
  webm: [
    { codec: 'vp9', full: 'vp09.02.40.10', label: 'VP9 profile 2' },
    { codec: 'av1', full: 'av01.0.08M.10', label: 'AV1 10-bit' },
  ],
};

/** the first 10-bit codec this browser encodes at that size for that container, or null */
export async function deepCodec(container: 'mp4' | 'webm', width: number, height: number): Promise<DeepCodec | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const c of DEEP[container]) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.full, width, height, bitrate: 20e6 });
      if (r.supported) return c;
    } catch { /* not this one */ }
  }
  return null;
}
