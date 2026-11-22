// The projects as this device last listed them: the home page draws them at
// once on its way back from a project (a new page, its memory gone), then the
// list asked again replaces them when it answers. Whose they are changes only
// with a sign-in or a sign-out, which forget them (accounts.ts).

import type { Manifest } from '@tramme/project';

const KEY = 'tramme.projects';

/** the last list, or null when there is none (a first visit, another account since) */
export function lastProjects(): Manifest[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(v) ? v as Manifest[] : null;
  } catch { return null; }
}

/** the list as the server just gave it */
export function keepProjects(list: Manifest[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode, or full: listed again next time */ }
}

/** another person's projects from now on: none drawn before theirs answer */
export function forgetProjects(): void {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
