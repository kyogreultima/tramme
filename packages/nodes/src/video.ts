// A video in a frame centred on the layer origin. The layer's in point plays
// the file from `start`: several layers of the same file with different
// starts and lengths make the cuts of an edit. Its sound plays with it unless
// muted (mixed like an audio layer, in the preview and the exports). `rate`
// speeds it up or slows it down (the pitch of its sound with it); looping,
// the section from `start` to `loopEnd` starts over as long as the layer runs.

import { correctionAt, isStabilization, mediaTime, pictureRect, type NodeType, type Vec2, type VideoAsset } from '@tramme/core';
import { RATE_PROP, SOUND_PROPS } from './sound.ts';

interface VideoProps {
  video: string | null;
  stabilize: string | null;
  start: number;
  rate: number;
  loop: boolean;
  loopEnd: number;
  size: Vec2;
  fit: 'cover' | 'contain' | 'fill';
  focus: Vec2;
  gain: number;
  muted: boolean;
}

export const video: NodeType<VideoProps> = {
  type: 'video', title: 'Video', category: 'Media',
  props: {
    video: { type: 'asset', default: null, nullable: true, assetType: 'video', label: 'File', animatable: false },
    start: { type: 'number', default: 0, min: 0, step: 0.01, unit: 's', label: 'Start in the file', animatable: false, description: "the video time shown at the layer's in point (used for cuts)" },
    rate: { ...RATE_PROP.rate },
    loop: { type: 'bool', default: false, label: 'Loop the section', animatable: false, group: 'Cut', description: 'when the layer runs past the section, it starts over from the start in the file' },
    loopEnd: { type: 'number', default: 0, min: 0, step: 0.01, unit: 's', label: 'Section end', animatable: false, group: 'Cut', description: 'time in the file where the looped section ends' },
    size: { type: 'vec2', default: [1920, 1080], label: 'Frame', unit: 'px' },
    fit: { type: 'enum', default: 'cover', options: ['cover', 'contain', 'fill'], label: 'Fit mode' },
    focus: { type: 'vec2', default: [0.5, 0.5], label: 'Focal point', step: 0.01, description: 'point of the picture kept at the center of the frame (0..1); animated, it follows the subject in a cropped frame' },
    stabilize: { type: 'asset', default: null, nullable: true, assetType: 'json', label: 'Stabilisation', animatable: false, description: "the camera's shake read by the stabilize tool: the picture moved back, zoomed just enough to keep its edges out" },
    muted: { type: 'bool', default: false, label: 'Muted', animatable: false, group: 'Sound' },
    ...SOUND_PROPS,
  },
  path({ size: [w, h] }) { const p = new Path2D(); p.rect(-w / 2, -h / 2, w, h); return p; },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      if (!p.video) return;
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      // slowed down, the file's interpolated copy (more frames, the same time) plays instead of repeating frames
      const speed = typeof p.rate === 'number' ? Math.abs(p.rate) : 1;
      const smooth = speed < 0.999 ? host.assetInfo(p.video).interpolated : undefined;
      const src = host.asset<VideoAsset>(smooth ?? p.video);
      const t = mediaTime(p, host.t, host.layerIn ?? 0);
      const { image, exact } = src.frameAt(t);
      if (!exact) host.defer?.(src.request(t));
      if (!image || !src.width || !src.height) return;
      // the frame is centred on the layer origin; cropped, the point named by focus stays at its centre (pictureRect, shared with the tracking and the checks)
      const r = pictureRect(p.fit, w, h, src.width, src.height, p.focus);
      if (p.fit === 'cover') { ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip(); }
      // stabilised: the frame's correction about the picture's centre, the clip's zoom about the frame's
      const st = p.stabilize ? host.asset<unknown>(p.stabilize) : null;
      if (isStabilization(st)) {
        const c = correctionAt(st, t), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        ctx.scale(st.zoom, st.zoom);
        ctx.translate(cx + c.x * r.w, cy + c.y * r.h);
        ctx.rotate(c.a);
        ctx.scale(c.s, c.s);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(image, r.x, r.y, r.w, r.h);
    },
  },
};
