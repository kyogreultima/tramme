// node bench/web-scenes/preview-server.mjs bench/web-scenes/css-svg
import { serveScene } from './serve.mjs';

const sceneDir = process.argv[2];
if (!sceneDir) throw new Error('usage: preview-server.mjs <scene-dir>');
const served = await serveScene(sceneDir);
console.log(`${served.url}preview`);
process.once('SIGINT', async () => { await served.close(); process.exit(0); });
