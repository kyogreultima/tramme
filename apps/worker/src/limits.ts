// What a plan allows in the cloud (packages/plans), held by the Worker for a
// signed-in person. Written and tested now, switched off until the payment
// exists: everyone is Basic until then, and nobody is stopped. The switch is
// the Worker's PLAN_LIMITS variable ("on").
//
// - Projects in the cloud: a new one (created, duplicated, imported) past the
//   plan's number is refused.
// - Version history: the versions of a project older than the plan's days are
//   left out of its list and cannot be read.
// - Private projects (the gallery's visibility) are checked where a project is
//   made private (gallery.ts).

import { json, storageRoute, type Bucket } from '@tramme/api';
import { termsOf, type PlanId, type PlanTerms } from '@tramme/plans';
import type { Env } from './http.ts';

export const limitsOn = (env: Env): boolean => env.PLAN_LIMITS === 'on';

/** what refuses a request past a plan's limit: the editor says it in the person's language (api.ts) */
export const planLimit = (limit: 'cloudProjects' | 'privateProjects', max: number | boolean) =>
  json({ error: 'plan_limit', limit, max }, 403);

const VERSION_FILE = /^\/api\/projects\/[^/]+\/files\/versions\/(.+)\.json$/;

/** the moment a version was made, from its file's name (TopBar.tsx writes `versions/<ISO date with - for : and .>.json`) */
export function versionTime(name: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

/** whether a version made at `at` is still in the plan's history */
const kept = (terms: PlanTerms, at: number | null, now: number) => terms.historyDays === null || at === null || now - at <= terms.historyDays * 86_400_000;

/**
 * A request held against the plan: an answer when it is refused or changed, undefined to let it through.
 * `files` is the person's workspace (prefixed.ts).
 */
export async function withinPlan(req: Request, url: URL, files: Bucket, plan: PlanId, now = Date.now()): Promise<Response | undefined> {
  const terms = termsOf(plan);
  const path = url.pathname, m = req.method;

  // a new project in the cloud: created, duplicated, or the empty project an import starts with
  const creates = m === 'POST' && (path === '/api/projects' || /^\/api\/projects\/[^/]+\/duplicate$/.test(path));
  if (creates && terms.cloudProjects !== null) {
    const listed = await storageRoute(new Request(new URL('/api/projects', url)), files, new URL('/api/projects', url));
    const count = listed?.ok ? ((await listed.json()) as unknown[]).length : 0;
    if (count >= terms.cloudProjects) return planLimit('cloudProjects', terms.cloudProjects);
  }

  if (m === 'GET' && terms.historyDays !== null) {
    // a version past the history
    const v = VERSION_FILE.exec(path);
    if (v && v[1] !== 'index' && !kept(terms, versionTime(v[1]), now)) return json({ error: 'not found' }, 404);
    // the list of versions, without those past the history
    if (/^\/api\/projects\/[^/]+\/files\/versions\/index\.json$/.test(path)) {
      const res = await storageRoute(req, files, url);
      if (!res?.ok) return res ?? undefined;
      const index = (await res.json()) as { versions?: { at?: string }[] };
      const versions = (index.versions ?? []).filter((x) => kept(terms, typeof x.at === 'string' ? Date.parse(x.at) : null, now));
      return json({ ...index, versions });
    }
  }
  return undefined;
}
