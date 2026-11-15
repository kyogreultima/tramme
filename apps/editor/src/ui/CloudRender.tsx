// Export in the cloud (the Worker's renders.ts): the project rendered on a
// server while this page does something else, or is closed. Its film lands in
// the project's renders/, where the export's panel shows it to download.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { api, ApiError } from '../api.ts';
import { t } from '../i18n/index.ts';
import { S, toast } from '../state.ts';
import { Icon } from './icons.tsx';

interface Job { id: string; project: string; status: 'queued' | 'rendering' | 'done' | 'failed'; file?: string; error?: string }

/** the job of this page's project, followed until it is done */
const job = signal<Job | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

async function answered(r: Response): Promise<Job> {
  if (r.ok) return (await r.json()) as Job;
  let body: { error?: string } = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  throw new ApiError(r.status, body.error ?? `HTTP ${r.status}`);
}

function follow() {
  if (timer) clearTimeout(timer);
  const j = job.peek();
  if (!j || j.status === 'done' || j.status === 'failed') return;
  timer = setTimeout(async () => {
    try { job.value = await answered(await fetch(`/api/renders/${encodeURIComponent(j.id)}`)); } catch { /* asked again below */ }
    const now = job.peek();
    if (now?.status === 'done') toast(t('cloudRender.done'));
    if (now?.status === 'failed') toast(t('cloudRender.failed', { error: now.error ?? '' }), 'error');
    follow();
  }, 4000);
}

async function start() {
  try {
    job.value = await answered(await fetch(`/api/projects/${encodeURIComponent(S.project.peek().id)}/renders`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comp: S.compId.peek() }),
    }));
    follow();
  } catch (e) {
    toast(e instanceof ApiError && e.message === 'plan_limit' ? t('cloudRender.limit') : t('cloudRender.failed', { error: (e as Error).message }), 'error');
  }
}

/** the export's panel: the button, then where the job is, then the film */
export function CloudRender({ disabled }: { disabled?: boolean }) {
  const j = job.value, project = S.project.value;
  useEffect(() => { if (j && j.project !== project.id) job.value = null; }, [project.id]);
  if (!j || j.project !== project.id) {
    return <button class="btn outline" disabled={disabled} title={t('cloudRender.hint')} onClick={start}><Icon name="upload" />{t('cloudRender.start')}</button>;
  }
  if (j.status === 'done' && j.file) {
    return (
      <div class="export-saves">
        <a class="btn sm" href={api.fileUrl(project.id, j.file)} download><Icon name="download" />{t('cloudRender.download')}</a>
        <span class="faint" style={{ fontSize: 11 }}>{t('topbar.keptInPath', { path: j.file })}</span>
      </div>
    );
  }
  if (j.status === 'failed') return <div class="prop-note err">{t('cloudRender.failed', { error: j.error ?? '' })}</div>;
  return <div class="faint" style={{ fontSize: 11 }}>{j.status === 'queued' ? t('cloudRender.queued') : t('cloudRender.rendering')}</div>;
}
