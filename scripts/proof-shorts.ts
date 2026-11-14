// The shorts proof's files, from the project the assistant left (bench brief
// nasa-shorts, downloaded into out/proofs/shorts/project): a 16:9 composition
// holding the three vertical shorts side by side, each playing its first
// seconds with its sound in turn while the others hold a dimmed frame; the
// long video's frame as the before, the three shorts as the after.
//
//   node scripts/proof-shorts.ts

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..'), OUT = path.join(ROOT, 'out/proofs/shorts');
const ffmpeg: string = createRequire(path.join(ROOT, 'packages/cli/package.json'))('ffmpeg-static');
const PROJECT = path.join(OUT, 'project'), docFile = path.join(PROJECT, 'document.tramme.json');
const doc = JSON.parse(fs.readFileSync(docFile, 'utf8'));
const shorts = Object.keys(doc.compositions).filter((c) => c.startsWith('short-'));
// the order the assistant gave them (its first is the strongest)
const ORDER = ['short-only-a-thin-layer-between-you-', 'short-the-first-thing-i-ll-do-back-o', 'short-what-i-needed-in-space-but-did'].filter((c) => shorts.includes(c));
if (ORDER.length !== 3) throw new Error(`three shorts expected, found ${shorts.join(', ')}`);

const W = 1920, H = 1080, TURN = 12, DUR = TURN * ORDER.length, S = H / 1920, GAP = 40;
const panel = 1080 * S, x0 = (W - 3 * panel - 2 * GAP) / 2 + panel / 2;
const layers: Record<string, unknown> = {}, order: string[] = [];
ORDER.forEach((comp, i) => {
  const x = x0 + i * (panel + GAP), from = i * TURN, to = from + TURN;
  // the short playing from its start, its sound heard, on its turn
  layers[`play${i}`] = { type: 'comp', in: from, out: to, transform: { position: [x, H / 2], scale: [S, S] }, props: { comp, start: 0 } };
  // its opening frame held and dimmed the rest of the time (a frame held is silent)
  const still = { type: 'comp', transform: { position: [x, H / 2], scale: [S, S], opacity: 0.4 }, props: { comp, remap: 2 } };
  if (from > 0) { layers[`before${i}`] = { ...still, in: 0, out: from }; order.push(`before${i}`); }
  if (to < DUR) { layers[`after${i}`] = { ...still, in: to, out: DUR, props: { comp, remap: TURN } }; order.push(`after${i}`); }
  order.push(`play${i}`);
});
doc.compositions.proof = { name: 'Proof', width: W, height: H, fps: 30, duration: DUR, background: '#000000', motionBlur: { samples: 1, shutter: 0 }, order, layers };
const proofDoc = path.join(PROJECT, 'proof.tramme.json');
fs.writeFileSync(proofDoc, JSON.stringify(doc));

const cli = (...args: string[]) => execFileSync(process.execPath, [path.join(ROOT, 'packages/cli/src/main.ts'), ...args], { stdio: 'inherit', cwd: ROOT });
const ff = (...args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const master = path.join(OUT, 'proof-master.mp4');
if (!fs.existsSync(master) || process.argv.includes('--again')) cli('render', proofDoc, '--comp', 'proof', '--format', 'mp4', '--out', master);

const site = path.join(ROOT, 'apps/site/src'), video = path.join(site, 'videos'), stills = path.join(site, 'assets/proofs');
// the after: the three shorts at the moment the second one plays, all at full light (each at its 6th second)
const STILL = 6;
doc.compositions.still = { ...doc.compositions.proof, name: 'Still', duration: 1, order: ORDER.map((_, i) => `s${i}`),
  layers: Object.fromEntries(ORDER.map((comp, i) => [`s${i}`, { type: 'comp', transform: { position: [x0 + i * (panel + GAP), H / 2], scale: [S, S] }, props: { comp, remap: STILL } }])) };
fs.writeFileSync(proofDoc, JSON.stringify(doc));
cli('still', proofDoc, '--comp', 'still', '--t', '0', '--out', path.join(OUT, 'still'));
const png = fs.readdirSync(path.join(OUT, 'still')).find((f) => f.endsWith('.png'))!;
ff('-i', path.join(OUT, 'still', png), '-vf', 'scale=1600:-2', '-q:v', '4', path.join(stills, 'shorts-after.jpg'));
// the before: the long video at the first short's moment, as filmed
const first = doc.compositions[ORDER[0]], src = Object.values(first.layers as Record<string, { type: string; props?: { start?: number } }>).find((l) => l.type === 'video');
const at = (src?.props?.start ?? 66) + STILL;
ff('-ss', String(at), '-i', path.join(PROJECT, 'assets/nasa-long.mp4'), '-frames:v', '1', '-vf', 'scale=1600:-2', '-q:v', '4', path.join(stills, 'shorts-before.jpg'));

// the clip, light: VP9 and H.264 at 1280 wide, its sound kept, a WebP poster
ff('-i', master, '-vf', 'scale=1280:-2', '-c:v', 'libvpx-vp9', '-b:v', '600k', '-c:a', 'libopus', '-b:a', '64k', path.join(video, 'proof-shorts.webm'));
ff('-i', master, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'slow', '-b:v', '650k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', path.join(video, 'proof-shorts.mp4'));
ff('-ss', '3', '-i', master, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '70', path.join(video, 'proof-shorts.webp'));
for (const f of ['videos/proof-shorts.webm', 'videos/proof-shorts.mp4', 'videos/proof-shorts.webp', 'assets/proofs/shorts-before.jpg', 'assets/proofs/shorts-after.jpg'])
  console.log(`${f}: ${(fs.statSync(path.join(site, f)).size / 1e6).toFixed(2)} MB`);
