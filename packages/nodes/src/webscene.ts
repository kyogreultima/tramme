// A web scene remains a structured layer. The CLI supplies captured alpha
// frames; the editor's seekable iframe preview is a later integration step.
import type { NodeType, Vec2 } from '@tramme/core';

interface WebSceneProps {
  folder: string;
  frames: string[];
  fps: number;
  size: Vec2;
}

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
      if (!p.frames.length || p.fps <= 0) return;
      const index = Math.min(p.frames.length - 1, Math.max(0, Math.floor(host.t * p.fps + 1e-6)));
      const image = host.asset<CanvasImageSource>(p.frames[index]);
      ctx.drawImage(image, -p.size[0] / 2, -p.size[1] / 2, p.size[0], p.size[1]);
    },
  },
};
