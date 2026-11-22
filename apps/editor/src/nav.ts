// Going from the projects to a project and back is a new page: the cover (#boot,
// in the page from its first paint, build.ts) hides what is not there yet, so
// the screen never goes empty. `go` closes it before leaving, `lift` opens it
// once the next page stands. The home page and the pages of the account are
// not "next pages": they change without a load (router.ts).

import { isSpaUrl, navigate, routerStarted } from './router.ts';

const cover = () => document.getElementById('boot');

/** the page stands: the cover fades away (after two frames, so it fades from a painted page) */
export function lift() {
  requestAnimationFrame(() => requestAnimationFrame(() => cover()?.classList.add('done')));
}

/** how long a page may take to go once asked before the cover is taken off it again (ms) */
export const LEAVE_WAIT = 6000;

/** to another page of the editor, behind the cover */
export function go(url: string) {
  if (routerStarted() && isSpaUrl(url)) { navigate(url); return; }
  const c = cover();
  if (!c) { location.assign(url); return; }
  c.classList.remove('done');
  // a page that does not go (its leaving refused, a load that failed) is shown again rather than left under the cover
  let left = false;
  addEventListener('pagehide', () => { left = true; }, { once: true });
  setTimeout(() => {
    location.assign(url);
    setTimeout(() => { if (!left) c.classList.add('done'); }, LEAVE_WAIT);
  }, 200);
}

// a page brought back by the browser's back button comes with the cover as it left it
window.addEventListener('pageshow', (e) => { if (e.persisted) cover()?.classList.add('done'); });
