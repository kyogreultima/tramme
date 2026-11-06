// Browser integration probe: a built-in model layer alongside a project plugin
// forces CLI frames through the opaque worker, with model bytes supplied by its host.
// node bench/safe-projects/model-sandbox.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { newProject } from '@tramme/project';
import { packGlb } from '../../apps/editor/src/glb.ts';
import { PNG } from 'pngjs';

const out = path.resolve('.cache/roadmaps/model-sandbox');
const project = path.join(out, 'project');
fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
fs.mkdirSync(path.join(project, 'plugins'), { recursive: true });
const positions = new Float32Array([-0.7, -0.7, 0, 0.7, -0.7, 0, 0, 0.7, 0]);
const indices = new Uint16Array([0, 1, 2]);
const bin = new Uint8Array(positions.byteLength + indices.byteLength);
bin.set(new Uint8Array(positions.buffer), 0);
bin.set(new Uint8Array(indices.buffer), positions.byteLength);
const gltf = {
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.9, 0.3, 0.2, 1] } }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.7, -0.7, 0], max: [0.7, 0.7, 0] },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
    { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
  ],
  buffers: [{ uri: 'triangle.bin', byteLength: bin.byteLength }],
};
fs.writeFileSync(path.join(project, 'assets', 'triangle.glb'), Buffer.from(packGlb(gltf, { 'triangle.bin': bin.buffer })));
fs.writeFileSync(path.join(project, 'plugins', 'marker.js'), "if (typeof document !== 'undefined') throw new Error('plugin imported in the trusted page'); export const meta = { name: 'Sandbox marker', version: '0.1.0', api: 1 }; export const nodes = [{ type: 'marker', title: 'Marker', category: 'Test', props: {}, render: { canvas2d() {} } }];\n");
const { doc } = newProject({ name: 'Model sandbox probe', width: 64, height: 64, fps: 1, duration: 1 });
doc.assets.mesh = { type: 'model', src: 'assets/triangle.glb' };
doc.assets.marker = { type: 'module', src: 'plugins/marker.js' };
doc.plugins = ['marker'];
doc.compositions.main.layers.triangle = { type: 'model.3d', name: 'Triangle', props: { source: 'mesh', height: 60 }, transform: { position: [32, 32] } };
doc.compositions.main.order = ['triangle'];
fs.writeFileSync(path.join(project, 'document.tramme.json'), JSON.stringify(doc));
const cli = path.resolve('packages/cli/src/main.ts');
const frames = path.join(out, 'frames');
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, 'render', project, '--format', 'png', '--out', frames, '--to', '1', '--pages', '1'], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`CLI render exited ${code}`)));
});
const png = PNG.sync.read(fs.readFileSync(path.join(frames, '00000.png')));
let colored = 0;
for (let i = 0; i < png.data.length; i += 4) if (png.data[i] > png.data[i + 2] + 20 && png.data[i + 3] > 0) colored++;
if (colored < 30) throw new Error(`isolated model frame has only ${colored} colored pixels`);
console.log(`isolated model rendered: ${colored} colored pixels`);
