// The back-office's part that is the Worker's, for the people who run the
// platform (the edge token says so, `ad`): the gallery's reports and taking a
// film down or putting it back (its files are in this Worker's bucket), and
// closing an account, whose files the Worker purges once the backend has let it go.
//
//   GET    /api/moderation/reports                    the reported films, the most reported first, with what was said
//   POST   /api/moderation/films/<id>/takedown        out of the gallery and of its link
//   POST   /api/moderation/films/<id>/restore         back as it was published
//   DELETE /api/moderation/films/<id>/reports         the reports read and set aside
//   DELETE /api/admin/users/<id>                      (the backend's, then the purge here)

import { HttpError, json, purgePrefix, type Bucket, type Edge } from '@tramme/api';
import { accountRoute } from './accounts.ts';
import { forgetWorkspace, readEntry, type Entry } from './gallery.ts';
import type { Env } from './http.ts';

const REPORTS = 'gallery/reports/';

async function reportsOf(files: Bucket): Promise<Map<string, { reason: string; at: string }[]>> {
  const out = new Map<string, { reason: string; at: string }[]>();
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix: REPORTS, cursor });
    for (const o of page.objects) {
      const id = o.key.slice(REPORTS.length).split('/')[0];
      const body = await files.get(o.key);
      if (!body) continue;
      const r = await body.json<{ reason: string; at: string }>();
      out.set(id, [...(out.get(id) ?? []), r]);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function setVisibility(files: Bucket, id: string, visibility: Entry['visibility']) {
  const entry = await readEntry(files, id);
  if (!entry) throw new HttpError(404, 'not found');
  // a film put back keeps what its author chose (kept aside when it was taken down)
  const restored = visibility === 'public' ? ((entry as Entry & { was?: Entry['visibility'] }).was ?? 'public') : visibility;
  const next = { ...entry, visibility: restored, ...(visibility === 'removed' ? { was: entry.visibility } : {}) };
  await files.put(`gallery/entries/${id}.json`, JSON.stringify(next), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { visibility: next.visibility, publishedAt: next.publishedAt },
  });
  return next;
}

/** the moderation's routes, for an admin only: undefined when the request is not one of them */
export async function moderationRoute(req: Request, env: Env, edge: Edge, files: Bucket): Promise<Response | undefined> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').slice(2);
  const m = req.method;
  if (parts[0] === 'admin' && parts[1] === 'users' && parts.length === 3 && m === 'DELETE') {
    if (!edge.admin) return undefined;
    return closeAccount(req, env, files);
  }
  if (parts[0] !== 'moderation') return undefined;
  // for anyone else, there is no such route
  if (!edge.admin) throw new HttpError(404, 'unknown route');
  if (parts[1] === 'reports' && parts.length === 2 && m === 'GET') {
    const reports = await reportsOf(files);
    const films = await Promise.all([...reports.entries()].map(async ([id, list]) => {
      const e = await readEntry(files, id);
      return e ? { id, title: e.title, author: e.author, visibility: e.visibility, owner: e.owner.userId, reports: list.sort((a, b) => b.at.localeCompare(a.at)) } : null;
    }));
    return json(films.filter(Boolean).sort((a, b) => b!.reports.length - a!.reports.length));
  }
  const id = parts[2] ?? '';
  if (parts[1] === 'films' && parts.length === 4 && m === 'POST' && (parts[3] === 'takedown' || parts[3] === 'restore')) {
    return json(await setVisibility(files, id, parts[3] === 'takedown' ? 'removed' : 'public'));
  }
  if (parts[1] === 'films' && parts.length === 4 && m === 'DELETE' && parts[3] === 'reports') {
    await purgePrefix(files, `${REPORTS}${id}/`);
    return new Response(null, { status: 204 });
  }
  throw new HttpError(404, 'unknown route');
}

/** an account closed by the back-office: the backend lets it go, then its films and its files go */
async function closeAccount(req: Request, env: Env, files: Bucket): Promise<Response> {
  const res = (await accountRoute(req, env))!;
  if (res.status !== 200) return res;
  const { workspaces = [] } = (await res.json()) as { workspaces?: string[] };
  for (const ws of workspaces) await forgetWorkspace(files, ws);
  return json({ closed: true, workspaces: workspaces.length });
}
