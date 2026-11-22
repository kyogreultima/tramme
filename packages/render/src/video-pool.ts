// The readers of one video file: one
// per play position in use, so two layers showing the same file at different
// moments (a crossfade between two shots of one take, a split screen) each
// read forward instead of making one decoder seek back and forth every frame.
// Bounded: past MAX_READERS, the least recently used reader starts over where
// it is asked. A frame decoded by one reader serves every layer asking for
// that moment. A frame no reader keeps any more is handed to `drop` (a
// decoder's frame is closed there, or the decoder runs out of them).
//
// Each reader works through its own requests in order, the readers side by
// side: the next shot can start decoding before its cut while the current
// one goes on playing (a seek to a keyframe a second back would otherwise
// hold every frame of the shot playing behind it). Requests from the side
// (the timeline's thumbnails, all along the file) have a reader of their
// own: they never carry off the one the preview is showing.

/** a decoded frame: its time span in the file and its picture */
export interface PoolFrame<P = unknown> { timestamp: number; duration: number; picture: P }

/** a reader's decoder, opened at t and yielding frames in order from there */
export type OpenAt<F extends PoolFrame> = (t: number) => AsyncGenerator<F, void, unknown>;

/** frames kept per reader (motion blur sub-frames, small steps back) */
export const KEEP = 6;
/** readers per file at most */
export const MAX_READERS = 3;
/** a request this far ahead of a reader continues it rather than seeking */
export const AHEAD = 2;
/** a request made ahead of time (a playback's next frames, the next shot before its cut) continues a reader only this close: farther, it would carry off the reader a playback is reading and drop the frames it still shows */
export const CUE_GAP = 0.2;

/** how a frame is asked for: to be shown now, ahead of being shown (CUE_GAP), or from the side (a reader of its own) */
export type ReadKind = 'shown' | 'ahead' | 'side';

interface Reader<F extends PoolFrame> {
  openAt: OpenAt<F>;
  it: AsyncGenerator<F, void, unknown> | null;
  /** where the decoder stands: the end of the last frame it gave */
  at: number;
  /** the frames it gave last, in the order it gave them */
  frames: F[];
  used: number;
  /** its requests, one after another */
  lock: Promise<void>;
  /** requests given to it and not done yet */
  pending: number;
  /** while some are pending: where it will stand at the earliest (a start over there), and the latest time asked of it */
  lo: number;
  hi: number;
}

export class ReaderPool<F extends PoolFrame> {
  private readers: Reader<F>[] = [];
  /** the reader of the requests from the side, apart from the others */
  private side: Reader<F> | null = null;
  private clock = 0;
  /** decoders opened (a read that starts somewhere: a seek), for the tests and the measures */
  opened = 0;

  private newReader: () => OpenAt<F>;
  private max: number;
  private drop: (f: F) => void;

  /** newReader makes a reader's decoder: its own, so its kept frames are never overwritten by another's */
  constructor(newReader: () => OpenAt<F>, max = MAX_READERS, drop: (f: F) => void = () => {}) {
    this.newReader = newReader;
    this.max = max;
    this.drop = drop;
  }

  /** the frame shown at t, if a reader has it */
  find(t: number): F | undefined {
    for (const r of this.all()) {
      const f = r.frames.find((x) => t + 1e-6 >= x.timestamp && t < x.timestamp + x.duration - 1e-6);
      if (f) { r.used = ++this.clock; return f; }
    }
    return undefined;
  }

  /** the decoded frame nearest t, while the right one comes */
  nearest(t: number): F | undefined {
    let near: F | undefined;
    for (const r of this.all()) for (const f of r.frames) if (!near || Math.abs(f.timestamp - t) < Math.abs(near.timestamp - t)) near = f;
    return near;
  }

  private keep(r: Reader<F>, f: F) {
    for (const x of r.frames) if (x.timestamp === f.timestamp) this.drop(x);
    r.frames = [...r.frames.filter((x) => x.timestamp !== f.timestamp), f];
    if (r.frames.length > KEEP) this.drop(r.frames.shift()!);
    r.at = f.timestamp + f.duration;
  }

  private forget(r: Reader<F>) {
    for (const f of r.frames) this.drop(f);
    r.frames = [];
  }

  private all(): Reader<F>[] { return this.side ? [...this.readers, this.side] : this.readers; }

  private fresh(): Reader<F> { return { openAt: this.newReader(), it: null, at: 0, frames: [], used: 0, lock: Promise.resolve(), pending: 0, lo: 0, hi: 0 }; }

  /** decodes up to the frame shown at t: forward on the reader just behind it, else a new read there (ReadKind) */
  async read(t: number, kind: ReadKind = 'shown'): Promise<void> {
    if (this.find(t)) return;
    const r = kind === 'side' ? (this.side ??= this.fresh()) : this.choose(t, kind === 'ahead' ? CUE_GAP : AHEAD);
    r.pending++;
    const run = r.lock.then(() => this.advance(r, t)).finally(() => { if (--r.pending === 0) r.lo = r.hi = r.at; });
    r.lock = run.catch(() => {});
    await run;
  }

  /** the reader for t, chosen at once: the one that continues best (just behind t, counting what it was already asked), else a new one, else the least recently used of the idle ones (any, when all are busy) */
  private choose(t: number, gap: number): Reader<F> {
    let best: Reader<F> | undefined, bestHi = -Infinity;
    for (const r of this.readers) {
      const lo = r.pending ? r.lo : r.at, hi = r.pending ? Math.max(r.lo, r.hi) : r.at;
      // with find's tolerance: a time that lands on the end of the last frame (1/30 added in floating point) continues that reader rather than opening another there
      if ((r.it || r.pending) && t + 1e-6 >= lo && t - hi < gap && hi > bestHi) { best = r; bestHi = hi; }
    }
    if (best) {
      best.used = ++this.clock;
      best.hi = Math.max(best.pending ? best.hi : best.at, t);
      if (!best.pending) best.lo = best.at;
      return best;
    }
    let r: Reader<F>;
    if (this.readers.length < this.max) {
      r = this.fresh();
      this.readers.push(r);
    } else {
      const idle = this.readers.filter((x) => !x.pending);
      r = (idle.length ? idle : this.readers).reduce((a, b) => (b.used < a.used ? b : a));
    }
    r.used = ++this.clock;
    r.lo = r.hi = t;
    return r;
  }

  /** the reader's work for t, once its earlier requests are done */
  private async advance(r: Reader<F>, t: number): Promise<void> {
    if (this.find(t)) return;
    if (r.it && t + 1e-6 >= r.at && t - r.at < AHEAD) {
      for (;;) {
        const next = await r.it.next();
        if (next.done) { r.it = null; break; }
        this.keep(r, next.value);
        if (this.find(t)) return;
        if (next.value.timestamp > t) return;
      }
    }
    // elsewhere: it starts over at t
    await r.it?.return(undefined);
    this.forget(r);
    r.it = r.openAt(t);
    this.opened++;
    const first = await r.it.next();
    if (first.done) { r.it = null; return; }
    this.keep(r, first.value);
  }

  /** readers open now */
  get size() { return this.readers.length; }

  dispose() {
    for (const r of this.all()) { r.it?.return(undefined); this.forget(r); }
    this.readers = [];
    this.side = null;
  }
}
