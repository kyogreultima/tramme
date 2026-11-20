// A web scene remains a structured layer. The CLI supplies captured alpha
// frames; the editor's seekable iframe preview is a later integration step.
import type { NodeType, Vec2 } from '@tramme/core';

interface WebSceneProps {
  folder: string;
  frames: string[];
  fps: number;
  size: Vec2;
  parameters?: Record<string, unknown>;
}

let placeholder: ((folder: string) => string | null) | null = null;
/**
 * The editor shows a labelled stand-in for a scene whose frames are not captured yet (they are
 * captured at export), instead of failing the whole preview. Exports leave this unset: a scene
 * without frames is an error there, never a blank or stand-in layer.
 */
export function setWebScenePlaceholder(label: ((folder: string) => string | null) | null) { placeholder = label; }

/**
 * What a source gives for a scene at an instant: its picture, a wait for it, a failure, or nothing
 * (the scene is not drawn this way). The live view may give the scene's last picture (null: none
 * yet, its placeholder) while the one at the instant is on its way: drawn now, the frame deferred.
 */
export type WebSceneShot = CanvasImageSource | Promise<unknown> | Error | { last: CanvasImageSource | null; wait: Promise<unknown> } | null;
/** the scene, its time (the composition's, as for captured frames) and its parameters at that time */
export interface WebSceneAsk { folder: string; t: number; size: Vec2; params: Record<string, number | string | boolean> }
let source: ((ask: WebSceneAsk) => WebSceneShot) | null = null;
/**
 * The editor draws a scene without captured frames from the scene itself (its frame photographs its
 * page at the instant) for the pictures it makes away from the live view: the assistant's stills, the
 * storyboard and its exports. A wait is deferred, so those renders draw the frame again once it has
 * come; a failure is an error of the frame. Nothing set, or null: the placeholder below.
 */
export function setWebSceneSource(give: ((ask: WebSceneAsk) => WebSceneShot) | null) { source = give; }

export const webscene: NodeType<WebSceneProps> = {
  type: 'webscene', title: 'Web scene', category: 'Media',
  props: {
    folder: { type: 'string', default: '', label: 'Scene folder', animatable: false },
    frames: { type: 'assets', default: [], assetType: 'image', label: 'Captured frames', animatable: false },
    fps: { type: 'number', default: 30, min: 1, label: 'Frame rate', animatable: false },
    size: { type: 'vec2', default: [1920, 1080], label: 'Scene size', unit: 'px' },
    parameters: { type: 'json', default: {}, label: 'Scene parameters', animatable: false, hidden: true, description: 'the parameters scene.json declares (name: type and default); their values are the layer params, animated like any property' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      let shot = !p.frames.length && source && p.folder && p.size[0] > 0 && p.size[1] > 0
        ? source({ folder: p.folder, t: host.t, size: p.size, params: ((p as unknown as { $params?: Record<string, number | string | boolean> }).$params) ?? {} })
        : null;
      if (shot instanceof Error) throw new Error(`web scene ${p.folder}: ${shot.message}`);
      if (shot && typeof (shot as Promise<unknown>).then === 'function') { host.defer?.(shot as Promise<unknown>); return; }
      if (shot && 'wait' in shot) { host.defer?.(shot.wait); shot = shot.last; }
      if (shot) { ctx.drawImage(shot as CanvasImageSource, -p.size[0] / 2, -p.size[1] / 2, p.size[0], p.size[1]); return; }
      if (!p.frames.length && placeholder && p.size[0] > 0 && p.size[1] > 0) {
        const label = placeholder(p.folder || '(unnamed)');
        if (label === null) return; // the editor shows the live scene over the picture
        const [w, h] = p.size;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(12, Math.round(Math.min(w, h) / 18))}px sans-serif`;
        ctx.fillText(label, 0, 0, w * 0.9);
        return;
      }
      if (!p.frames.length) throw new Error(`web scene ${p.folder || '(unnamed)'} has no captured frames`);
      if (p.fps <= 0) throw new Error(`web scene ${p.folder || '(unnamed)'} has an invalid frame rate`);
      const index = Math.min(p.frames.length - 1, Math.max(0, Math.floor(host.t * p.fps + 1e-6)));
      const image = host.asset<CanvasImageSource>(p.frames[index]);
      ctx.drawImage(image, -p.size[0] / 2, -p.size[1] / 2, p.size[0], p.size[1]);
    },
  },
};
