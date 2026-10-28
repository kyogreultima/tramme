// The exports in line, under the export button: what waits, what runs with its
// progress, what is done and can be saved; each can be taken out or stopped.

import { exportQueue, queueVersion } from '../export-queue.ts';
import { saveBlob } from '../download.ts';
import { t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';

export function ExportQueueList() {
  void queueVersion.value;
  const jobs = exportQueue.jobs;
  if (!jobs.length) return null;
  const finished = jobs.some((j) => j.status !== 'waiting' && j.status !== 'running');
  return (
    <div class="export-queue">
      <div class="export-queue-head"><span>{t('topbar.queue')}</span>{finished && <button class="btn sm ghost" onClick={() => exportQueue.clearFinished()}>{t('topbar.clearQueue')}</button>}</div>
      {jobs.map((j) => (
        <div key={j.id} class={`export-job ${j.status}`}>
          <span class="name" title={j.label}>{j.label}</span>
          {j.status === 'running' && <div class="progress"><i style={{ width: `${Math.round((j.progress ?? 0) * 100)}%` }} /></div>}
          {j.status === 'waiting' && <span class="faint">{t('topbar.queueWaiting')}</span>}
          {j.status === 'cancelled' && <span class="faint">{t('topbar.queueCancelled')}</span>}
          {j.status === 'error' && <span class="err" title={j.error}>{t('topbar.queueFailed')}</span>}
          {j.status === 'done' && j.result && <button class="btn sm" onClick={() => void saveBlob(j.result!.blob, j.result!.name)}><Icon name="download" />{t('topbar.saveToComputer')}</button>}
          {(j.status === 'waiting' || j.status === 'running') && <button class="icon-btn xs" title={t('topbar.cancelExport')} onClick={() => exportQueue.cancel(j.id)}><Icon name="x" /></button>}
        </div>
      ))}
    </div>
  );
}
