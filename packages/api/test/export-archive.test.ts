import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { memoryRecords, recordBucket } from '../src/index.ts';
import { createProject, exportProject } from '../src/projects.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('the project as a .tramme archive', () => {
  it('opens again whole, a font that fflate\'s streaming deflate breaks included', async () => {
    const bucket = recordBucket(memoryRecords());
    const { id } = await (await createProject(bucket, new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'Fonts' }) }))).json() as { id: string };
    // this font, deflated in a stream at level 6, came out unreadable ("invalid distance"): the export in the cloud of launch-film failed
    const font = new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples/launch-film/assets/fonts/JetBrainsMono.ttf')));
    const text = new TextEncoder().encode('{"a":1}'.repeat(5000));
    await bucket.put(`projects/${id}/assets/fonts/JetBrainsMono.ttf`, font);
    await bucket.put(`projects/${id}/assets/data.json`, text);
    const files = unzipSync(new Uint8Array(await (await exportProject(bucket, id)).arrayBuffer()));
    expect(files['assets/fonts/JetBrainsMono.ttf']).toEqual(font);
    expect(files['assets/data.json']).toEqual(text);
  });

  it('streams a video in pieces rather than reading it whole (a 148 MB video outgrew the Worker\'s memory)', async () => {
    const records = memoryRecords(), bucket = recordBucket(records);
    const { id } = await (await createProject(bucket, new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'Video' }) }))).json() as { id: string };
    const video = new Uint8Array(512 * 1024);
    for (let i = 0; i < 251; i++) video[i] = i;
    for (let n = 251; n < video.length; n *= 2) video.copyWithin(n, 0, Math.min(n, video.length - n));
    await bucket.put(`projects/${id}/assets/clip.mp4`, video);
    // the store answers the video only as a stream: reading it whole fails, as it would past the Worker's memory
    const streamed = new Proxy(bucket, { get: (b, k) => k !== 'get' ? Reflect.get(b, k) : async (key: string, o?: never) => {
      const obj = await b.get(key, o);
      if (!obj || !key.endsWith('.mp4')) return obj;
      return Object.assign(Object.create(obj), { body: obj.body, arrayBuffer: () => { throw new Error('read whole'); } });
    } });
    const files = unzipSync(new Uint8Array(await (await exportProject(streamed, id)).arrayBuffer()));
    expect(files['assets/clip.mp4']).toEqual(video);
    expect(files['document.tramme.json']).toBeDefined();
  });
});
