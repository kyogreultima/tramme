// Bringing missing media back: the files the user picks are matched to the
// media (relink.ts) and written where those media expect them, so every layer
// that uses them plays again, and the preview loads them.

import { S, toast } from './state.ts';
import { api } from './api.ts';
import { contentHash } from './hash.ts';
import { preview } from './preview.ts';
import { matchRelink, type Candidate } from './relink.ts';
import { t } from './i18n/index.ts';

/** the media whose file is missing, as the preview found them */
export const missingMedia = () => S.offline.peek().filter((id) => S.doc.peek().assets[id]).map((id) => [id, S.doc.peek().assets[id]] as const);

/** the files picked (one, or a whole folder) put in place of the media they belong to; says how many were found */
export async function relinkFiles(files: File[]): Promise<number> {
  const missing = missingMedia().map(([id, a]) => [id, a] as [string, typeof a]);
  if (!missing.length || !files.length) return 0;
  // a file is read for its content only when a missing medium knows its own
  const hashed = missing.some(([, a]) => a.hash);
  const candidates: Candidate[] = await Promise.all(files.map(async (f) => ({ name: f.name, ...(hashed ? { hash: await contentHash(f) } : {}) })));
  const found = matchRelink(missing, candidates), project = S.project.peek().id;
  const back: string[] = [];
  for (const [id, i] of found) {
    await api.writeAny(project, S.doc.peek().assets[id].src, files[i]);
    back.push(id);
  }
  if (!back.length) { toast(t('panel.relinkNone'), 'error'); return 0; }
  await preview.reload(back);
  toast(t('panel.relinked', { n: back.length }), 'info');
  return back.length;
}
