// A PNG of straight (not premultiplied) RGBA, written as it is. A canvas keeps
// its pixels premultiplied, so a cut-out saved through one loses the colour of
// its faintest pixels (a pixel at 10 % alpha has a handful of colour levels
// left); written here, every colour comes back as it went in.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** the rows with the Sub filter (each byte minus the pixel on its left), a byte of filter type in front of each: smaller once deflated */
export function filtered(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const stride = w * 4, out = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1), s = y * stride;
    out[o] = 1;
    for (let x = 0; x < stride; x++) out[o + 1 + x] = (rgba[s + x] - (x >= 4 ? rgba[s + x - 4] : 0)) & 255;
  }
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** the PNG file of an image of straight RGBA */
export async function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const head = new Uint8Array(13), v = new DataView(head.buffer);
  v.setUint32(0, w); v.setUint32(4, h);
  head[8] = 8; head[9] = 6; // 8 bits, RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', await deflate(filtered(rgba, w, h))), chunk('IEND', new Uint8Array())];
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}
