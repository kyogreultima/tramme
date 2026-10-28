// The exports waiting in line, run in this page: each on a copy of the film as
// it was when it was added (the editor can go on), one at a time, with the
// same exporter as the export button.

import { signal } from '@preact/signals';
import type { Registry, TrammeDoc } from '@tramme/core';
import { ExportQueue, type ExportJob } from './exports.ts';
import { safeName } from './files.ts';
import type { WebFormat } from './formats.ts';

/** what a queued export needs, taken when it was asked for */
export interface QueuedExport extends ExportJob {
  format: WebFormat;
  doc: TrammeDoc;
  base: string;
  compId: string;
  registry: Registry;
  /** the project's name, for the file */
  project: string;
  samples?: number;
  depth: 8 | 10;
  range?: [number, number];
  t: number;
}

export interface Exported { blob: Blob; name: string; seconds: number; warnings: string[] }

/** changes whenever a job of the queue does: what draws the list follows it */
export const queueVersion = signal(0);

export const exportQueue = new ExportQueue<Exported>(async (job, signal, progress) => {
  const j = job as QueuedExport, t0 = performance.now();
  const { exportInBrowser } = await import('./webexport.ts');
  const r = await exportInBrowser(j.doc, j.base, j.format, { compId: j.compId, registry: j.registry, samples: j.samples, depth: j.depth, range: j.range, t: j.t, signal, onProgress: progress });
  const stem = safeName(j.project);
  return { blob: r.blob, name: j.format === 'svg' ? `${stem}_${j.t.toFixed(2)}.svg` : `${stem}.${r.ext}`, seconds: (performance.now() - t0) / 1000, warnings: r.warnings };
});
exportQueue.onChange = () => { queueVersion.value++; };
