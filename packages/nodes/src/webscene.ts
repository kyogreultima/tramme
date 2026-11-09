// A web scene remains a structured layer. The CLI supplies captured alpha
// frames; the editor's seekable iframe preview is a later integration step.
import type { NodeType, Vec2 } from '@tramme/core';

interface WebSceneProps {
  folder: string;
  frames: string[];
  fps: number;
  size: Vec2;
}

let placeholder: ((folder: string) => string) | null = null;
/**
 * The editor shows a labelled stand-in for a scene whose frames are not captured yet (they are
 * captured at export), instead of failing the whole preview. Exports leave this unset: a scene
 * without frames is an error there, never a blank or stand-in layer.
 */
export function setWebScenePlaceholder(label: ((folder: string) => string) | null) { placeholder = label; }

export const webscene: NodeType<WebSceneProps> = {
  type: 'webscene', title: 'Web scene', category: 'Media',
  props: {
    folder: { type: 'string', default: '', label: 'Scene folder', animatable: false },
    frames: { type: 'assets', default: [], assetType: 'image', label: 'Captured frames', animatable: false },
    fps: { type: 'number', default: 30, min: 1, label: 'Frame rate', animatable: false },
    size: { type: 'vec2', default: [1920, 1080], label: 'Scene size', unit: 'px' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      if (!p.frames.length && placeholder && p.size[0] > 0 && p.size[1] > 0) {
        const [w, h] = p.size;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(12, Math.round(Math.min(w, h) / 18))}px sans-serif`;
        ctx.fillText(placeholder(p.folder || '(unnamed)'), 0, 0, w * 0.9);
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
