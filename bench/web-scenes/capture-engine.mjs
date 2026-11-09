// Capture a seekable scene through pinned @hyperframes/engine@0.9.13.
// Install it outside the app with npm install --prefix .cache/roadmaps/hyperframes-0.9.13 @hyperframes/engine@0.9.13.
// node bench/web-scenes/capture-engine.mjs bench/web-scenes/css-svg .cache/roadmaps/webscene-engine-export
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveScene } from './serve.mjs';

const [sceneArg, outputArg] = process.argv.slice(2);
if (!sceneArg || !outputArg) throw new Error('usage: capture-engine.mjs <scene-dir> <output-dir>');
const sceneDir = path.resolve(sceneArg), outputDir = path.resolve(outputArg);
const enginePath = path.resolve('.cache/roadmaps/hyperframes-0.9.13/node_modules/@hyperframes/engine/dist/index.js');
const { createCaptureSession, initializeSession, getCompositionDuration, captureFrame, closeCaptureSession } = await import(pathToFileURL(enginePath).href);
fs.mkdirSync(outputDir, { recursive: true });
const served = await serveScene(sceneDir);
let session;
try {
  session = await createCaptureSession(served.url, outputDir, {
    width: 320, height: 180, fps: { num: 6, den: 1 }, format: 'png', transparent: true,
  });
  await initializeSession(session);
  const duration = await getCompositionDuration(session);
  const results = [];
  for (let frame = 0; frame < Math.ceil(duration * 6); frame++) results.push(await captureFrame(session, frame, frame / 6));
  console.log(JSON.stringify({ duration, frames: results.map(({ frameIndex, time, path: file }) => ({ frameIndex, time, file })) }, null, 2));
} finally {
  if (session) await closeCaptureSession(session);
  await served.close();
}
