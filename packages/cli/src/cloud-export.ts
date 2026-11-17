// `tramme cloud-export`: a project exported in the cloud of an account, from
// the command line, with an API token of that account (made in the app's
// space): the project is sent to the account (a new project, as an import
// is), rendered by the app's renderer (apps/worker/src/renders.ts), and its film
// brought back.
//
//   tramme cloud-export <folder | project.tramme> [--app https://app.tramme.dev] [--token tr_…] [--out film.mp4] [--master]
//   (the token can also come from TRAMME_TOKEN, the address from TRAMME_APP_URL)

import fs from 'node:fs';
import path from 'node:path';
import { DOCUMENT, MANIFEST, checkProject, type Manifest } from '@tramme/project';

export interface CloudExportOptions { app: string; token: string; out: string; comp?: string; profile?: 'master'; wait?: (ms: number) => Promise<void>; log?: (line: string) => void }

interface Job { id: string; status: 'queued' | 'rendering' | 'done' | 'failed'; file?: string; error?: string }

/** the project sent, rendered, and its film written; returns where */
export async function cloudExport(files: Map<string, Uint8Array>, opts: CloudExportOptions): Promise<string> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const wait = opts.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const { issues, manifest, doc } = checkProject(files);
  if (!manifest || !doc || issues.length) throw new Error(`the project is not valid: ${issues.map((i) => `${i.path} ${i.message}`).slice(0, 3).join('; ')}`);
  const base = opts.app.replace(/\/+$/, '');
  const ask = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${p}`, { ...init, headers: { authorization: `Bearer ${opts.token}`, ...(init.headers as Record<string, string>) } });
    if (!res.ok) {
      let said = '';
      try { said = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* not JSON */ }
      throw new Error(`${init.method ?? 'GET'} ${p}: ${res.status}${said ? ` ${said}` : ''}`);
    }
    return res;
  };

  const root = doc.compositions[doc.root];
  const made = (await (await ask('/api/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: (manifest as Manifest).name, width: root?.width, height: root?.height, fps: root?.fps, duration: root?.duration, empty: true }),
  })).json()) as Manifest;
  log(`sending ${files.size} files to the account (project ${made.id})`);
  const at = (p: string) => `/api/projects/${encodeURIComponent(made.id)}/files/${p.split('/').map(encodeURIComponent).join('/')}`;
  // the document last: the project is whole when it has one (as the editor's import does)
  for (const [p, data] of files) {
    if (p === MANIFEST || p === DOCUMENT) continue;
    await ask(at(p), { method: 'PUT', body: data as BodyInit });
  }
  await ask(at(DOCUMENT), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: files.get(DOCUMENT) as BodyInit });

  let job = (await (await ask(`/api/projects/${encodeURIComponent(made.id)}/renders`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comp: opts.comp, profile: opts.profile }),
  })).json()) as Job;
  log(`export ${job.id}: ${job.status}`);
  for (let said = job.status; job.status === 'queued' || job.status === 'rendering';) {
    await wait(5000);
    job = (await (await ask(`/api/renders/${encodeURIComponent(job.id)}`)).json()) as Job;
    if (job.status !== said) { log(`export ${job.id}: ${job.status}`); said = job.status; }
  }
  if (job.status !== 'done' || !job.file) throw new Error(`the export did not finish: ${job.error ?? job.status}`);
  const film = new Uint8Array(await (await ask(at(job.file))).arrayBuffer());
  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, film);
  log(`wrote ${opts.out} (${(film.length / 1e6).toFixed(1)} MB)`);
  return opts.out;
}
