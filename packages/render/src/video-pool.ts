// The readers of one video file (docs/performance-roadmap.md, step 5): one
// per play position in use, so two layers showing the same file at different
// moments (a crossfade between two shots of one take, a split screen) each
// read forward instead of making one decoder seek back and forth every frame.
// Bounded: past MAX_READERS, the least recently used reader starts over where
// it is asked. A frame decoded by one reader serves every layer asking for
// that moment.

/** a decoded frame: its time span in the file and its picture */
export interface PoolFrame<P = unknown> { timestamp: number; duration: number; canvas: P }

/** a reader's decoder, opened at t and yielding frames in order from there */
export type OpenAt<F extends PoolFrame> = (t: number) => AsyncGenerator<F, void, unknown>;

/** frames kept per reader (motion blur sub-frames, small steps back) */
export const KEEP = 6;
/** readers per file at most */
export const MAX_READERS = 3;
/** a request this far ahead of a reader continues it rather than seeking */
export const AHEAD = 2;

interface Reader<F extends PoolFrame> {
  openAt: OpenAt<F>;
  it: AsyncGenerator<F, void, unknown> | null;
  /** where the decoder stands: the end of the last frame it gave */
  at: number;
  /** the frames it gave last, in the order it gave them */
  frames: F[];
  used: number;
}

export class ReaderPool<F extends PoolFrame> {
  private readers: Reader<F>[] = [];
  private clock = 0;
  /** decoders opened (a read that starts somewhere: a seek), for the tests and the measures */
  opened = 0;

  private newReader: () => OpenAt<F>;
  private max: number;

  /** newReader makes a reader's decoder: its own, so its kept frames are never overwritten by another's */
  constructor(newReader: () => OpenAt<F>, max = MAX_READERS) {
    this.newReader = newReader;
    this.max = max;
  }

  /** the frame shown at t, if a reader has it */
  find(t: number): F | undefined {
    for (const r of this.readers) {
      const f = r.frames.find((x) => t + 1e-6 >= x.timestamp && t < x.timestamp + x.duration - 1e-6);
      if (f) { r.used = ++this.clock; return f; }
    }
    return undefined;
  }

  /** the decoded frame nearest t, while the right one comes */
  nearest(t: number): F | undefined {
    let near: F | undefined;
    for (const r of this.readers) for (const f of r.frames) if (!near || Math.abs(f.timestamp - t) < Math.abs(near.timestamp - t)) near = f;
    return near;
  }

  private keep(r: Reader<F>, f: F) {
    r.frames = [...r.frames.filter((x) => x.timestamp !== f.timestamp), f];
    if (r.frames.length > KEEP) r.frames.shift();
    r.at = f.timestamp + f.duration;
  }

  /** decodes up to the frame shown at t: forward on the reader just behind it, else a new read there */
  async read(t: number): Promise<void> {
    if (this.find(t)) return;
    // the reader that continues best: just behind t
    let best: Reader<F> | undefined;
    for (const r of this.readers) if (r.it && t >= r.at && t - r.at < AHEAD && (!best || r.at > best.at)) best = r;
    if (best) {
      best.used = ++this.clock;
      for (;;) {
        const next = await best.it!.next();
        if (next.done) { best.it = null; break; }
        this.keep(best, next.value);
        if (this.find(t)) return;
        if (next.value.timestamp > t) return;
      }
    }
    // elsewhere: a new reader while there is room, else the least recently used starts over at t
    let r: Reader<F>;
    if (this.readers.length < this.max) {
      r = { openAt: this.newReader(), it: null, at: 0, frames: [], used: 0 };
      this.readers.push(r);
    } else {
      r = this.readers.reduce((a, b) => (b.used < a.used ? b : a));
      await r.it?.return(undefined);
      r.frames = [];
    }
    r.used = ++this.clock;
    r.it = r.openAt(t);
    this.opened++;
    const first = await r.it.next();
    if (first.done) { r.it = null; return; }
    this.keep(r, first.value);
  }

  /** readers open now */
  get size() { return this.readers.length; }

  dispose() {
    for (const r of this.readers) r.it?.return(undefined);
    this.readers = [];
  }
}
