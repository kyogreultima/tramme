// One .glb from a glTF and the buffers it names: what the model layer reads
// (a file with its geometry and base colours). Libraries ship a model as a
// .gltf beside its .bin files and textures; the textures are left out and the
// materials kept as their base colours, which is what `model.3d` draws.

const MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const TEXTURED = ['baseColorTexture', 'metallicRoughnessTexture'] as const;
const pad4 = (n: number) => (n + 3) & ~3;

interface Gltf {
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  materials?: { pbrMetallicRoughness?: Record<string, unknown>; [k: string]: unknown }[];
  [k: string]: unknown;
}

/** the glTF's buffers as one, its textures dropped; `buffers` holds each file by the name its `uri` gives */
export function packGlb(gltf: object, buffers: Record<string, ArrayBuffer>): ArrayBuffer {
  const doc = JSON.parse(JSON.stringify(gltf)) as Gltf;
  const parts: Uint8Array[] = [], starts: number[] = [];
  let total = 0;
  for (const [i, b] of (doc.buffers ?? []).entries()) {
    const file = b.uri === undefined ? undefined : buffers[decodeURIComponent(b.uri)] ?? buffers[b.uri];
    if (!file) throw new Error(`glTF: the buffer ${i}${b.uri ? ` (${b.uri})` : ''} is missing`);
    starts.push(total);
    const bytes = new Uint8Array(file, 0, b.byteLength);
    parts.push(bytes);
    total = pad4(total + bytes.length);
  }
  // every view reads the one buffer, at its place
  for (const v of doc.bufferViews ?? []) { v.byteOffset = (v.byteOffset ?? 0) + (starts[v.buffer] ?? 0); v.buffer = 0; }
  doc.buffers = total ? [{ byteLength: total }] : [];
  // textures are left out: the materials keep their base colours
  delete doc.images; delete doc.textures; delete doc.samplers;
  for (const m of doc.materials ?? []) {
    for (const k of TEXTURED) delete m.pbrMetallicRoughness?.[k];
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete m[k];
  }
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const jsonLen = pad4(json.length), binLen = total;
  const out = new Uint8Array(12 + 8 + jsonLen + (binLen ? 8 + binLen : 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLen, true); view.setUint32(16, JSON_CHUNK, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.length, 20 + jsonLen);
  if (binLen) {
    const at = 20 + jsonLen;
    view.setUint32(at, binLen, true); view.setUint32(at + 4, BIN_CHUNK, true);
    parts.forEach((p, i) => out.set(p, at + 8 + starts[i]));
  }
  return out.buffer;
}
