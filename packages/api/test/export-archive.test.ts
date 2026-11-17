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
});
