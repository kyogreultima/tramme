// Export in the cloud (the Worker's renders.ts): the project rendered on a
// server while this page does something else, or is closed. Its film lands in
// the project's renders/, where the export's panel shows it to download. A
// server of one (`pnpm dev`) offers the same when its renderer runs on the
// machine (`pnpm renderer`), as "Export on the server".
//
// The jobs asked from this browser are kept (localStorage) and followed from
// any page of the app, after a reload too: each one over is told by a
// notification of the system (the browser's, the desktop's or the phone's,
// notify.ts) when the app is in the background, a message in it otherwise.
// With the app closed, the account's backend tells it by mail.

import { signal } from '@preact/signals';
import { api, ApiError } from '../api.ts';
import { t } from '../i18n/index.ts';
import { cloud } from '../mode.ts';
import { allowNotifications, notify } from '../notify.ts';
import { S, toast } from '../state.ts';
import { Icon } from './icons.tsx';

interface Job { id: string; project: string; status: 'queued' | 'rendering' | 'done' | 'failed'; file?: string; error?: string }
/** a job followed from this browser, with the name of its project for the notification */
interface Followed { job: Job; name: string }

const KEY = 'tramme.renders';
/** how often the jobs under way are asked about */
const EVERY = 4000;

const read = (): Followed[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Followed[]; } catch { return []; } };
const write = (list: Followed[]) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-20))); } catch { /* private window: followed in this page only */ } };

/** the jobs asked from this browser, the newest last */
export const followed = signal<Followed[]>(typeof localStorage === 'undefined' ? [] : read());
/** whether this server renders: an account's page always does; a server of one says it in its config */
export const serverRender = signal(false);

const under = (j: Job) => j.status === 'queued' || j.status === 'rendering';
let timer: ReturnType<typeof setTimeout> | null = null;

async function answered(r: Response): Promise<Job> {
  if (r.ok) return (await r.json()) as Job;
  let body: { error?: string } = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  throw new ApiError(r.status, body.error ?? `HTTP ${r.status}`);
}

function keep(list: Followed[]) { followed.value = list; write(list); }

/** every job under way asked about now and then; one that ends is told */
function follow() {
  if (timer) clearTimeout(timer);
  if (!followed.peek().some((f) => under(f.job))) return;
  timer = setTimeout(async () => {
    const list = [...followed.peek()];
    for (const [i, f] of list.entries()) {
      if (!under(f.job)) continue;
      let now: Job;
      try { now = await answered(await fetch(`/api/renders/${encodeURIComponent(f.job.id)}`)); } catch (e) {
        // a job this server does not know (another account, a reset server): not followed any more
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) list[i] = { ...f, job: { ...f.job, status: 'failed', error: '' } };
        continue;
      }
      list[i] = { ...f, job: now };
      if (now.status === 'done') notify(t('cloudRender.doneTitle'), t('cloudRender.doneBody', { name: f.name }));
      if (now.status === 'failed') notify(t('cloudRender.doneTitle'), t('cloudRender.failed', { error: now.error ?? '' }), 'error');
    }
    keep(list);
    follow();
  }, EVERY);
}

async function start() {
  // asked from the click: the browser shows its question only then
  void allowNotifications();
  const project = S.project.peek();
  try {
    const job = await answered(await fetch(`/api/projects/${encodeURIComponent(project.id)}/renders`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comp: S.compId.peek() }),
    }));
    keep([...followed.peek().filter((f) => f.job.project !== project.id || under(f.job)), { job, name: project.name }]);
    follow();
  } catch (e) {
    toast(e instanceof ApiError && e.message === 'plan_limit' ? t('cloudRender.limit') : t('cloudRender.failed', { error: (e as Error).message }), 'error');
  }
}

/** the app opens: what this server offers is read, and the jobs left under way are followed again */
export function resumeRenders() {
  if (cloud) serverRender.value = true;
  else void api.config().then((c) => { serverRender.value = !!(c as { serverRender?: boolean }).serverRender; }).catch(() => {});
  follow();
}

/** the export's panel: the button, then where the job is, then the film */
export function CloudRender({ disabled }: { disabled?: boolean }) {
  const project = S.project.value, mine = [...followed.value].reverse().find((f) => f.job.project === project.id)?.job;
  const button = <button class="btn outline" disabled={disabled} title={cloud ? t('cloudRender.hint') : t('cloudRender.hintServer')} onClick={start}><Icon name="upload" />{cloud ? t('cloudRender.start') : t('cloudRender.startServer')}</button>;
  if (!mine) return button;
  if (mine.status === 'done' && mine.file) {
    return (
      <div class="export-saves">
        <a class="btn sm" href={api.fileUrl(project.id, mine.file)} download><Icon name="download" />{t('cloudRender.download')}</a>
        <span class="faint" style={{ fontSize: 11 }}>{t('topbar.keptInPath', { path: mine.file })}</span>
        {button}
      </div>
    );
  }
  if (mine.status === 'failed') return <>{mine.error ? <div class="prop-note err">{t('cloudRender.failed', { error: mine.error })}</div> : null}{button}</>;
  return <div class="faint" style={{ fontSize: 11 }}>{mine.status === 'queued' ? t('cloudRender.queued') : t('cloudRender.rendering')}</div>;
}
