// Exports put in line: each is run on the film as it was when it was asked
// for, one at a time, so the editor stays usable while they go; one can be
// taken out of the line or stopped without stopping the others.

export interface ExportJob {
  id: string;
  /** what the list shows */
  label: string;
  format: string;
  [extra: string]: unknown;
}

export type JobStatus = 'waiting' | 'running' | 'done' | 'error' | 'cancelled';

export interface QueuedJob<R = unknown> extends ExportJob {
  status: JobStatus;
  /** 0 to 1 while it runs */
  progress?: number;
  error?: string;
  result?: R;
}

type Exec<R> = (job: ExportJob, signal: AbortSignal, progress: (done: number, total: number) => void) => Promise<R>;

export class ExportQueue<R = unknown> {
  jobs: QueuedJob<R>[] = [];
  /** called whenever a job changes: the list is drawn again */
  onChange?: () => void;
  private running: { id: string; abort: AbortController } | null = null;
  private waiting: (() => void)[] = [];

  private exec: Exec<R>;

  constructor(exec: Exec<R>) { this.exec = exec; }

  add(job: ExportJob) {
    this.jobs = [...this.jobs, { ...job, status: 'waiting' }];
    this.changed();
    void this.pump();
  }

  /** a waiting export is taken out of the line, the running one is stopped */
  cancel(id: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === 'waiting') this.set(id, { status: 'cancelled' });
    else if (job.status === 'running') this.running?.abort.abort();
  }

  /** the finished, failed and cancelled ones leave the list */
  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.status === 'waiting' || j.status === 'running');
    this.changed();
  }

  /** resolves when nothing waits or runs */
  idle(): Promise<void> {
    return this.busy() ? new Promise((r) => this.waiting.push(r)) : Promise.resolve();
  }

  private busy() { return this.running !== null || this.jobs.some((j) => j.status === 'waiting'); }
  private changed() { this.onChange?.(); }
  private set(id: string, patch: Partial<QueuedJob<R>>) {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
    this.changed();
  }

  private async pump() {
    if (this.running) return;
    for (let next = this.jobs.find((j) => j.status === 'waiting'); next; next = this.jobs.find((j) => j.status === 'waiting')) {
      const abort = new AbortController();
      this.running = { id: next.id, abort };
      this.set(next.id, { status: 'running', progress: 0 });
      try {
        const result = await this.exec(next, abort.signal, (done, total) => this.set(next!.id, { progress: total ? done / total : 0 }));
        this.set(next.id, { status: 'done', progress: 1, result });
      } catch (e) {
        const stopped = (e as Error).name === 'AbortError';
        this.set(next.id, stopped ? { status: 'cancelled' } : { status: 'error', error: (e as Error).message });
      }
      this.running = null;
    }
    for (const r of this.waiting.splice(0)) r();
  }
}
