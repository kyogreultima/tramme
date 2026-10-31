// Going from the projects to a project and back is a new page: the cover (#boot,
// in the page from its first paint, build.ts) hides what is not there yet, so
// the screen never goes empty. `go` closes it before leaving, `lift` opens it
// once the next page stands.

const cover = () => document.getElementById('boot');

/** the page stands: the cover fades away (after two frames, so it fades from a painted page) */
export function lift() {
  requestAnimationFrame(() => requestAnimationFrame(() => cover()?.classList.add('done')));
}

/** to another page of the editor, behind the cover */
export function go(url: string) {
  const c = cover();
  if (!c) { location.assign(url); return; }
  c.classList.remove('done');
  setTimeout(() => location.assign(url), 200);
}

// a page brought back by the browser's back button comes with the cover as it left it
window.addEventListener('pageshow', (e) => { if (e.persisted) cover()?.classList.add('done'); });
