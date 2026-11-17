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
//
// The apps (desktop, phone) offer it once signed in, for the projects of the
// account: they send the routes to the app of their environment (api.rs, the
// account's projects and /api/renders), which renders them as the web does. A
// project kept on the device only is not on the server: it is brought into the
// account first (bring.ts).

import { computed, signal } from '@preact/signals';
import { account } from '../accounts.ts';
import { api, ApiError } from '../api.ts';
import { inAccount } from '../bring.ts';
import { t } from '../i18n/index.ts';
import { cloud } from '../mode.ts';
import { allowNotifications, notify } from '../notify.ts';
import { nextWait } from '../render-pace.ts';
import { S, toast } from '../state.ts';
import { tauri } from '../tauri.ts';
import { Icon } from './icons.tsx';

interface Job { id: string; project: string; status: 'queued' | 'rendering' | 'done' | 'failed'; file?: string; error?: string; format?: 'mp4' | 'premiere' }
/** a job followed from this browser, with the name of its project for the notification and its id as this page knows it (an app shows the account's under its own) */
interface Followed { job: Job; name: string; project?: string }
const projectOf = (f: Followed) => f.project ?? f.job.project;

const KEY = 'tramme.renders';
/** the questions asked since a job was last asked for (their pace: render-pace.ts) */
let asked = 0;
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

const read = (): Followed[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Followed[]; } catch { return []; } };
const write = (list: Followed[]) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-20))); } catch { /* private window: followed in this page only */ } };

/** the jobs asked from this browser, the newest last */
export const followed = signal<Followed[]>(typeof localStorage === 'undefined' ? [] : read());
/** a server of one that says in its config that it renders (`pnpm renderer`) */
const serverOfOne = signal(false);
/** whether exports can be rendered on a server: an account's page, an app signed in, a server of one that renders */
export const serverRender = computed(() => cloud || (!!tauri && account.value.status === 'in') || serverOfOne.value);

const under = (j: Job) => j.status === 'queued' || j.status === 'rendering';
let timer: ReturnType<typeof setTimeout> | null = null;

async function answered(r: Response): Promise<Job> {
  if (r.ok) return (await r.json()) as Job;
  let body: { error?: string } = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  throw new ApiError(r.status, body.error ?? `HTTP ${r.status}`);
}

function keep(list: Followed[]) { followed.value = list; write(list); }

/** every job under way asked about now and then (nextWait); one that ends is told */
function follow(wait = nextWait(asked, hidden())) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!followed.peek().some((f) => under(f.job))) return;
  timer = setTimeout(async () => {
    asked++;
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
  }, wait);
}

// the page back in front: the jobs under way asked about at once, then at the pace they had reached
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!hidden() && timer) follow(0); });

/** a job asked for: the film, or the Premiere Pro timeline with its clips (a zip: the XML, the media, the drawings as ProRes with alpha, the subtitles) */
async function start(format: 'mp4' | 'premiere' = 'mp4') {
  // asked from the click: the browser shows its question only then
  void allowNotifications();
  const project = S.project.peek();
  try {
    const job = await answered(await fetch(`/api/projects/${encodeURIComponent(project.id)}/renders`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comp: S.compId.peek(), ...(format === 'premiere' ? { format } : {}) }),
    }));
    keep([...followed.peek().filter((f) => projectOf(f) !== project.id || under(f.job)), { job, name: project.name, project: project.id }]);
    // a new job: asked about soon again
    asked = 0;
    follow();
  } catch (e) {
    toast(e instanceof ApiError && e.message === 'plan_limit' ? t('cloudRender.limit') : t('cloudRender.failed', { error: (e as Error).message }), 'error');
  }
}

/** the app opens: what this server offers is read, and the jobs left under way are followed again */
export function resumeRenders() {
  if (!cloud && !tauri) void api.config().then((c) => { serverOfOne.value = !!(c as { serverRender?: boolean }).serverRender; }).catch(() => {});
  follow();
}

/** the export's panel: the button, then where the job is, then the film */
export function CloudRender({ disabled }: { disabled?: boolean }) {
  const project = S.project.value, mine = [...followed.value].reverse().find((f) => projectOf(f) === project.id)?.job;
  // in an app, a project of this device only: the server does not have it
  const onDevice = !!tauri && !inAccount(project);
  const button = (
    <div class="export-saves">
      {onDevice && <div class="prop-note">{t('cloudRender.accountOnly')}</div>}
      <button class="btn outline" disabled={disabled || onDevice} title={serverOfOne.value ? t('cloudRender.hintServer') : t('cloudRender.hint')} onClick={() => start()}><Icon name="upload" />{serverOfOne.value ? t('cloudRender.startServer') : t('cloudRender.start')}</button>
      <button class="btn outline" disabled={disabled || onDevice} title={t('cloudRender.premiereHint')} onClick={() => start('premiere')}><Icon name="film" />{t('cloudRender.premiere')}</button>
    </div>
  );
  if (!mine) return button;
  if (mine.status === 'done' && mine.file) {
    return (
      <div class="export-saves">
        <a class="btn sm" href={api.fileUrl(project.id, mine.file)} download><Icon name="download" />{mine.format === 'premiere' ? t('cloudRender.downloadPremiere') : t('cloudRender.download')}</a>
        <span class="faint" style={{ fontSize: 11 }}>{t('topbar.keptInPath', { path: mine.file })}</span>
        {button}
      </div>
    );
  }
  if (mine.status === 'failed') return <>{mine.error ? <div class="prop-note err">{t('cloudRender.failed', { error: mine.error })}</div> : null}{button}</>;
  return <div class="faint" style={{ fontSize: 11 }}>{mine.status === 'queued' ? t('cloudRender.queued') : t('cloudRender.rendering')}</div>;
}
