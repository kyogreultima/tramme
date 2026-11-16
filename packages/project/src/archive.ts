// The .tramme archive: a zip of the project's files (renders left out).
// Reading checks every entry before anything else uses it.

import { unzipSync, zipSync, type Zippable } from 'fflate';
import { LEGACIES, LIMITS, MANIFEST, maxSize, migrateProject, pathIssue } from './format.ts';

/** media are already compressed: a zip stores them as they are */
const STORED = /\.(png|jpe?g|webp|gif|avif|mp3|ogg|m4a|wav|mp4|webm|mov|woff2?)$/i;

/** a plain zip of files (an export's folder), the media stored as they are */
export function zipFiles(files: Map<string, Uint8Array>): Uint8Array {
  const entries: Zippable = {};
  for (const [p, data] of files) entries[p] = [data, { level: STORED.test(p) ? 0 : 6 }];
  return zipSync(entries);
}

/** zip the project's files; renders/ and unknown places stay out */
export function packProject(files: Map<string, Uint8Array>): Uint8Array {
  const entries: Zippable = {};
  let count = 0, total = 0;
  for (const [p, data] of files) {
    if (p.startsWith('renders/') || pathIssue(p)) continue;
    if (++count > LIMITS.files) throw new Error(`too many project files (${LIMITS.files} at most)`);
    total += data.byteLength;
    if (data.byteLength > maxSize(p) || total > LIMITS.archive * 2) throw new Error(`project file too large: ${p}`);
    entries[p] = [data, { level: STORED.test(p) ? 0 : 6 }];
  }
  return zipSync(entries);
}

/** the files of an archive; throws when it is not a usable zip */
export function unpackProject(zip: Uint8Array): Map<string, Uint8Array> {
  if (zip.byteLength > LIMITS.archive) throw new Error('archive too large');
  if (zip[0] !== 0x50 || zip[1] !== 0x4b) throw new Error('this file is not a .tramme archive (zip)');
  let total = 0, entries = 0;
  const raw = unzipSync(zip, {
    // refuse oversized entries before inflating them (zip bombs)
    filter: (f) => {
      if (++entries > LIMITS.files) throw new Error(`too many archive entries (${LIMITS.files} at most)`);
      total += f.originalSize;
      if (f.originalSize > maxSize(f.name) || total > LIMITS.archive * 2) throw new Error(`entry too large: ${f.name}`);
      return !f.name.endsWith('/');
    },
  });
  const files = new Map<string, Uint8Array>(Object.entries(raw));
  // an archive made by hand may wrap everything in one folder: unwrap it
  const roots = new Set([...files.keys()].map((k) => k.split('/')[0]));
  if (!files.has(MANIFEST) && !LEGACIES.some((l) => files.has(l.manifest)) && roots.size === 1) {
    const root = [...roots][0] + '/';
    const unwrapped = new Map<string, Uint8Array>();
    for (const [k, v] of files) unwrapped.set(k.slice(root.length), v);
    return migrateProject(unwrapped);
  }
  // an archive of a former name (.trame, .emotion) is read as today's
  return migrateProject(files);
}
