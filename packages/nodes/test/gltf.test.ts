import { describe, expect, it, vi } from 'vitest';
import { decompose, parseGltf, sampleChannel } from '../src/gltf.ts';
import { model as modelNode } from '../src/model.ts';

/** builds a GLB: a JSON chunk and a binary chunk, 4-byte aligned */
function glb(json: object, bin: ArrayBuffer): ArrayBuffer {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const pad = (n: number) => (4 - (n % 4)) % 4;
  const total = 12 + 8 + enc.length + pad(enc.length) + 8 + bin.byteLength + pad(bin.byteLength);
  const out = new ArrayBuffer(total), v = new DataView(out);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
  let at = 12;
  v.setUint32(at, enc.length + pad(enc.length), true); v.setUint32(at + 4, 0x4e4f534a, true);
  new Uint8Array(out, at + 8, enc.length).set(enc);
  at += 8 + enc.length + pad(enc.length);
  v.setUint32(at, bin.byteLength + pad(bin.byteLength), true); v.setUint32(at + 4, 0x004e4942, true);
  new Uint8Array(out, at + 8, bin.byteLength).set(new Uint8Array(bin));
  return out;
}

/** one flat two-triangle quad at z 0, 1 m wide, in a buffer view of its own */
function quadBin(withNormals: boolean): ArrayBuffer {
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const chunks: ArrayBuffer[] = [positions.buffer as ArrayBuffer, indices.buffer as ArrayBuffer];
  if (withNormals) chunks.push(normals.buffer as ArrayBuffer);
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new ArrayBuffer(total), u = new Uint8Array(out);
  let at = 0;
  const views: { offset: number; length: number }[] = [];
  for (const c of chunks) { u.set(new Uint8Array(c), at); views.push({ offset: at, length: c.byteLength }); at += c.byteLength; }
  (out as any).views = views;
  return out;
}

describe('a .glb file read as a model', () => {
  const bin = quadBin(true) as any;
  const [pv, iv, nv] = bin.views;
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'quad', mesh: 0, translation: [1, 2, 0], children: [1] }, { name: 'leaf', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 2 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.9, 0.4, 0.2, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: pv.offset, byteLength: pv.length },
      { buffer: 0, byteOffset: iv.offset, byteLength: iv.length },
      { buffer: 0, byteOffset: nv.offset, byteLength: nv.length },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };

  it('gives the tree of nodes, the triangles and the material colour', () => {
    const m = parseGltf(glb(json, bin as ArrayBuffer));
    expect(m.roots).toHaveLength(1);
    const root = m.roots[0];
    expect(root.name).toBe('quad');
    expect(root.translation).toEqual([1, 2, 0]);
    expect(root.prims[0].positions).toBeInstanceOf(Float32Array);
    expect(root.prims[0].positions[3]).toBeCloseTo(0.5);
    expect(Array.from(root.prims[0].indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(root.prims[0].color).toEqual([0.9, 0.4, 0.2, 1]);
    expect(root.prims[0].normals![0]).toBe(0);
    expect(root.children[0].name).toBe('leaf');
    // the whole model's sphere holds both copies of the quad
    expect(m.radius).toBeGreaterThan(0.7);
  });

  it('keeps drawing when the normals are missing (they become a plain up)', () => {
    const j = JSON.parse(JSON.stringify(json));
    j.meshes[0].primitives[0].attributes = { POSITION: 0 };
    j.accessors.splice(2); j.bufferViews.splice(2);
    const bin2 = quadBin(false) as any;
    j.bufferViews[0] = { buffer: 0, byteOffset: bin2.views[0].offset, byteLength: bin2.views[0].length };
    j.bufferViews[1] = { buffer: 0, byteOffset: bin2.views[1].offset, byteLength: bin2.views[1].length };
    j.buffers = [{ byteLength: bin2.byteLength }];
    const m = parseGltf(glb(j, bin2 as ArrayBuffer));
    expect(m.roots[0].prims[0].normals).toBe(null);
  });

  it('samples a translation track, held at the ends and eased between', () => {
    // times 0, 2; the translation goes from [1,2,0] to [8,8,8]
    const animBin = new Float32Array([0, 2, 1, 2, 0, 8, 8, 8]);
    const j = JSON.parse(JSON.stringify(json));
    j.animations = [{
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }],
    }];
    j.accessors.push({ bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' });
    j.accessors.push({ bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' });
    const timesAt = bin.byteLength, valuesAt = timesAt + 8;
    j.bufferViews.push({ buffer: 0, byteOffset: timesAt, byteLength: 8 });
    j.bufferViews.push({ buffer: 0, byteOffset: valuesAt, byteLength: 24 });
    const whole = new Uint8Array(bin.byteLength + animBin.byteLength);
    whole.set(new Uint8Array(bin), 0);
    whole.set(new Uint8Array(animBin.buffer as ArrayBuffer), bin.byteLength);
    const m = parseGltf(glb(j, whole.buffer as ArrayBuffer));
    expect(m.duration).toBe(2);
    const out = new Float32Array(3), c = m.roots[0].channels[0];
    sampleChannel(c, -1, out); expect(Array.from(out)).toEqual([1, 2, 0]);
    sampleChannel(c, 0.5, out); expect(out[0]).toBeCloseTo(2.75); expect(out[1]).toBeCloseTo(3.5); expect(out[2]).toBeCloseTo(2);
    sampleChannel(c, 9, out); expect(Array.from(out)).toEqual([8, 8, 8]);
  });

  it('reads a node placed by a matrix as its translation, rotation and scale', () => {
    // a quarter turn about y, scaled by 0.01 (a file in centimetres), moved to (3, 4, 5): column-major
    const m = [0, 0, -0.01, 0, 0, 0.01, 0, 0, 0.01, 0, 0, 0, 3, 4, 5, 1];
    const d = decompose(m);
    expect(d.translation).toEqual([3, 4, 5]);
    d.scale.forEach((s) => expect(s).toBeCloseTo(0.01));
    const h = Math.SQRT1_2;
    [0, h, 0, h].forEach((v, i) => expect(d.rotation[i]).toBeCloseTo(v));
    // a mirror keeps its flip
    expect(decompose([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).scale[0]).toBeCloseTo(-1);
    // and a whole file whose node carries one is drawn, its bounds through it
    const j = JSON.parse(JSON.stringify(json));
    j.nodes = [{ name: 'quad', mesh: 0, matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 0, 0, 1] }];
    const model = parseGltf(glb(j, bin as ArrayBuffer));
    expect(model.roots[0].translation).toEqual([10, 0, 0]);
    expect(model.center[0]).toBeCloseTo(10);
    expect(model.radius).toBeGreaterThan(1.3);
  });

  it('says what is wrong with a file it cannot draw', () => {
    expect(() => parseGltf(new TextEncoder().encode('{"asset":{}}').buffer as ArrayBuffer)).toThrow(/glTF|not supported/);
  });

  it('loads the bytes supplied by the host without fetching from the sandbox', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    try {
      const bytes = glb(json, bin as ArrayBuffer);
      await modelNode.load!({ source: 'mesh' } as never, { asset: () => bytes } as never);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
