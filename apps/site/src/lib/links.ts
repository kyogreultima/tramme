export const REPO_NAME = 'kyogreultima/tramme';
export const REPO = `https://github.com/${REPO_NAME}`;
/** a file or folder of the repository, on its main branch */
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;
/** the editor, online (apps/worker in personal mode: projects and keys stay in the browser) */
export const APP = 'https://app.tramme.dev';

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
