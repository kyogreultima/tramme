// The playback clock, out of Preview so the tests can drive it: where the
// time is read from (a start and the moment it started, or the audio
// context's clock), how it wraps a loop or ends at the duration, and the
// runs — a start overtaken by another one, or cancelled by a pause,
// schedules nothing (the 0.13.0 fix, now tested).

/** a playback's start: the clock's time `t0` at the moment `at` */
export interface Clock { at: number; t0: number; audio: boolean }

/** the composition's time now, from the clock's start */
export function clockTime(c: Clock, now: number): number {
  return c.t0 + (now - c.at);
}

/**
 * The time now, stepped past the duration: `wrap` says "start again from
 * `t`" (the loop case, `advance` replays from there), `end` says "stop at
 * `duration`" (playback over).
 */
export function step(c: Clock, now: number, duration: number, loop: boolean): { t: number; wrap: boolean; end: boolean } {
  const t = clockTime(c, now);
  if (t < duration) return { t, wrap: false, end: false };
  if (loop) return { t: t % duration, wrap: true, end: false };
  return { t: duration, wrap: false, end: true };
}

/** the playback under way: only the latest id that has not been cancelled is live */
export class Runs {
  private latest = 0;

  /** cancels the run before it and returns a new id */
  begin(): number {
    return ++this.latest;
  }

  /** a pause: the run under way is no longer live */
  cancel(): void {
    this.latest++;
  }

  live(run: number): boolean {
    return run === this.latest;
  }
}

/**
 * The sound heard while the playhead is dragged: a window from `t` to play,
 * or null when the last one is not 60 ms old yet (a stutter is worse than
 * silence). `last` and `now` are in milliseconds (performance.now()).
 */
export function scrubWindow(t: number, last: number, now: number): { from: number; dur: number } | null {
  return now - last < 60 ? null : { from: t, dur: 0.08 };
}
