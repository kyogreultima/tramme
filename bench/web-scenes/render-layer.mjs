// Step 0 CLI prototype: capture a scene folder, then composite its PNGs as a built-in webscene node.
// node bench/web-scenes/render-layer.mjs bench/web-scenes/css-svg .cache/roadmaps/webscene-layer
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { newProject } from '@tramme/project';

const [sceneArg, outputArg] = process.argv.slice(2);
if (!sceneArg || !outputArg) throw new Error('usage: render-layer.mjs <scene-dir> <output-dir>');
const sceneDir = path.resolve(sceneArg), outputDir = path.resolve(outputArg);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.join(outputDir, 'project'), captured = path.join(outputDir, 'captured');
const run = (script, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited ${code}`)));
});
fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(captured, { recursive: true });
const sceneName = path.basename(sceneDir);
fs.cpSync(sceneDir, path.join(projectDir, 'scenes', sceneName), { recursive: true, force: true, filter: (file) => !file.includes(`${path.sep}.hyperframes${path.sep}`) });
await run(path.join(here, 'capture-engine.mjs'), [path.join(projectDir, 'scenes', sceneName), captured]);
const frameFiles = fs.readdirSync(captured).filter((file) => /^frame_\d+\.png$/.test(file)).sort();
if (frameFiles.length !== 6) throw new Error(`expected six captured frames, got ${frameFiles.length}`);
const frameDir = path.join(projectDir, 'assets', 'webscene');
fs.mkdirSync(frameDir, { recursive: true });
const { doc } = newProject({ name: 'Web scene layer prototype', width: 320, height: 180, fps: 6, duration: 1 });
const frameIds = frameFiles.map((file, index) => {
  const id = `scene-frame-${index}`;
  fs.copyFileSync(path.join(captured, file), path.join(frameDir, file));
  doc.assets[id] = { type: 'image', src: `assets/webscene/${file}` };
  return id;
});
const comp = doc.compositions.main;
comp.motionBlur.samples = 1;
comp.layers.under = { type: 'shape.rect', name: 'Underlying Tramme layer', transform: { position: [160, 90] }, props: { size: [320, 180], fill: '#17374C', radius: 0 } };
comp.layers.scene = { type: 'webscene', name: 'Seekable web scene', transform: { position: [160, 90] }, props: { folder: `scenes/${sceneName}`, frames: frameIds, fps: 6, size: [320, 180] } };
comp.order = ['under', 'scene'];
const documentFile = path.join(projectDir, 'document.tramme.json');
fs.writeFileSync(documentFile, JSON.stringify(doc, null, 2));
const framesOut = path.join(outputDir, 'composited');
await run(path.resolve('packages/cli/src/main.ts'), ['render', documentFile, '--format', 'png', '--out', framesOut, '--to', '1', '--pages', '1']);
const renderedFiles = fs.readdirSync(framesOut).filter((file) => /^\d+\.png$/.test(file)).sort();
const hashes = renderedFiles.map((file) => createHash('sha256').update(fs.readFileSync(path.join(framesOut, file))).digest('hex'));
if (renderedFiles.length !== 6 || new Set(hashes).size !== 6) throw new Error('web scene composite did not produce six distinct frames');
const capturedMiddle = PNG.sync.read(fs.readFileSync(path.join(captured, frameFiles[3])));
const compositedMiddle = PNG.sync.read(fs.readFileSync(path.join(framesOut, '00003.png')));
const pixel = (png, x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
const outsideCapture = pixel(capturedMiddle, 0, 0), outsideComposited = pixel(compositedMiddle, 0, 0);
const centerComposited = pixel(compositedMiddle, 160, 90);
if (outsideCapture[3] !== 0 || outsideComposited[3] !== 255 || outsideComposited.slice(0, 3).every((channel, i) => channel === centerComposited[i])) {
  throw new Error(`alpha composition failed: ${outsideCapture} -> ${outsideComposited}, center ${centerComposited}`);
}
console.log(JSON.stringify({ document: documentFile, captured, composited: framesOut, outsideCapture, outsideComposited, centerComposited }, null, 2));
