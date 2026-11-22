// Build the CLAP embeddings of the shipped sounds without rebuilding or deleting the library.
// node scripts/sound-clap.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, ClapAudioModelWithProjection, env } from '@huggingface/transformers';
import { launch } from '../packages/cli/src/browser.ts';
import { CLAP_MODEL, CLAP_REVISION, packVector } from '../apps/editor/src/clap.ts';
import type { SoundEntry } from '@tramme/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ONNX Runtime on Windows cannot open the package's default cache path here (>260 chars).
env.cacheDir = path.join(root, '.cache', 'clap');
const entries = (JSON.parse(await fs.readFile(path.join(root, 'sounds/catalog.json'), 'utf8')) as { sounds: SoundEntry[] }).sounds;
const options = { revision: CLAP_REVISION, dtype: 'q8' } as const;
const [processor, model] = await Promise.all([
  AutoProcessor.from_pretrained(CLAP_MODEL, options),
  ClapAudioModelWithProjection.from_pretrained(CLAP_MODEL, options),
]);
const { browser, page } = await launch({ quiet: true });
try {
  await page.goto('about:blank');
  const records: Buffer[] = [];
  for (const [index, entry] of entries.entries()) {
    const file = await fs.readFile(path.join(root, 'sounds', entry.file!));
    const encoded = await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes.buffer);
      const length = Math.max(1, Math.min(480000, Math.round(decoded.duration * 48000)));
      const ctx = new OfflineAudioContext(1, length, 48000), mono = ctx.createBuffer(1, decoded.length, decoded.sampleRate);
      const dst = mono.getChannelData(0);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const src = decoded.getChannelData(c);
        for (let i = 0; i < src.length; i++) dst[i] += src[i] / decoded.numberOfChannels;
      }
      const source = ctx.createBufferSource(); source.buffer = mono; source.connect(ctx.destination); source.start();
      const samples = (await ctx.startRendering()).getChannelData(0);
      const bytesOut = new Uint8Array(samples.buffer);
      let result = '';
      for (let i = 0; i < bytesOut.length; i += 0x8000) result += String.fromCharCode(...bytesOut.subarray(i, i + 0x8000));
      return btoa(result);
    }, file.toString('base64'));
    const raw = Buffer.from(encoded, 'base64');
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const inputs = await processor(samples);
    const { audio_embeds } = await model(inputs);
    const values = audio_embeds.data as Float32Array;
    const norm = Math.sqrt(Array.from(values).reduce((sum, x) => sum + x * x, 0));
    const packed = Buffer.from(packVector(Float32Array.from(values, (x) => x / (norm || 1))), 'base64');
    const id = Buffer.from(entry.id, 'utf8'), header = Buffer.alloc(2);
    header.writeUInt16LE(id.length);
    records.push(header, id, packed);
    if ((index + 1) % 25 === 0) console.log(`${index + 1}/${entries.length}`);
  }
  const header = Buffer.alloc(4); header.writeUInt32LE(entries.length);
  const output = Buffer.concat([header, ...records]);
  await fs.writeFile(path.join(root, 'sounds/clap.bin'), output);
  console.log(`sounds/clap.bin: ${entries.length} sounds, ${output.length} bytes`);
} finally {
  await browser.close();
  await Promise.all([model.dispose(), processor.dispose?.()]);
}
