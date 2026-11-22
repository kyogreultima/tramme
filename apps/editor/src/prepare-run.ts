// The preparing of heavy passages (prepared.ts), on a renderer of its own:
// it starts a moment after the preview stops moving, draws the frames nearest
// the playhead first, and stops as soon as anything moves again.

import type { TrammeDoc } from '@tramme/core';
import { renderSize } from '@tramme/render';
import { Stills } from './frames.ts';
import { frameKey, overlapFrames, prepareOrder, PreparedFrames } from './prepared.ts';

/** how long the preview stays still before the preparing starts (ms) */
const QUIET_MS = 1200;

interface Wanted { doc: TrammeDoc; compId: string; scale: number; from: number }

export class Preparer {
  readonly frames = new PreparedFrames();
  private stills: Stills | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted: Wanted | null = null;
  private running = false;

  /** says the preview is still still: checked before every frame drawn */
  private idle: () => boolean;
  constructor(idle: () => boolean) { this.idle = idle; }

  /** the preview stands on this document, composition and frame: prepare its heavy passages once it has stayed still a moment */
  schedule(w: Wanted) {
    this.wanted = w;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, QUIET_MS);
  }

  /** a playback starts, a project closes: nothing more drawn */
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wanted = null;
  }

  /** a new project, files changed under the same names: everything prepared goes */
  reset() {
    this.stop();
    this.frames.clear();
    this.stills?.dispose();
    this.stills = null;
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (let w = this.wanted; w && this.idle(); w = this.wanted === w ? null : this.wanted) {
        const { doc, compId, scale, from } = w;
        const comp = doc.compositions[compId];
        if (!comp) continue;
        this.frames.prune(doc, scale);
        const { width, height } = renderSize(comp.width, comp.height, scale);
        for (const f of prepareOrder([...overlapFrames(doc, compId), ...this.frames.lateFrames(compId)], from)) {
          if (!this.idle() || this.wanted !== w) break;
          if (this.frames.holds(doc, compId, f, scale)) continue;
          if (!this.frames.hasRoom(width * height * 4)) break;
          this.stills ??= new Stills();
          let picture: ImageBitmap | null = null;
          try { picture = await this.stills.picture(doc, f / comp.fps, compId, scale); }
          // a frame that cannot be drawn stays live: the preview shows what it can
          catch (e) { console.warn('[prepared] frame', f, (e as Error).message); }
          if (!picture) continue;
          // an edit while it drew: kept only if the frame still shows the same
          if (this.wanted && this.wanted.doc !== doc && frameKey(this.wanted.doc, compId, f) !== frameKey(doc, compId, f)) { picture.close(); continue; }
          this.frames.put(compId, f, frameKey(doc, compId, f), scale, picture);
        }
        if (this.wanted === w) this.wanted = null;
      }
    } finally { this.running = false; }
  }
}
