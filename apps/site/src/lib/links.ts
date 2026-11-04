// Where the site and the app are, for the environment this runs in (local, beta,
// preprod, production): brand/environments.ts. A dev server means local, a build
// production, TRAMME_ENV says otherwise.
import { originsFromEnv } from '../../../../brand/environments';

const running = typeof process !== 'undefined';
export const ORIGINS = originsFromEnv(running ? process.env : {}, running && process.argv.includes('dev'));

export const REPO_NAME = 'kyogreultima/tramme';
export const REPO = `https://github.com/${REPO_NAME}`;
/** a file or folder of the repository, on its main branch */
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;
/** the editor, online (apps/worker): the app of this environment */
export const APP = ORIGINS.app;
// A link from the site to the app opens in a tab of its own (the site stays where it is):
// target="_blank" rel="noopener" written on the anchor. Never spread a shared object for it:
// Astro adds the component's style classes to a spread object, so they pile up from
// one component to the next and the link takes the look of the others.

// The platform's addresses in the app, written once: where the site sends a
// visitor to sign up, log in, open the personal space or reuse a project.
const withLang = (url: string, lang?: string) => (lang ? `${url}${url.includes('?') ? '&' : '?'}lang=${lang}` : url);

/** sign-up; `prompt` is carried through it into a new project's studio */
export function signUp({ prompt, lang }: { prompt?: string; lang?: string } = {}): string {
  const query = [prompt?.trim() && `prompt=${encodeURIComponent(prompt.trim())}`, lang && `lang=${lang}`].filter(Boolean).join('&');
  return `${APP}/signup${query ? `?${query}` : ''}`;
}
export const logIn = (lang?: string) => withLang(`${APP}/login`, lang);
export const space = (lang?: string) => withLang(`${APP}/space`, lang);
/** a public project, opened in the app for reuse */
export const appProject = (id: string, lang?: string) => withLang(`${APP}/p/${encodeURIComponent(id)}`, lang);
