// Step 0 prototype node: the export helper fills `frames` from a scene folder.
export const meta = { name: 'Web scene prototype', version: '0.1.0', api: 1 };

export const nodes = [{
  type: 'webscene', title: 'Web scene', category: 'Media',
  props: {
    folder: { type: 'string', default: '', label: 'Scene folder', animatable: false },
    frames: { type: 'json', default: [], label: 'Captured frames', animatable: false },
    fps: { type: 'number', default: 6, min: 1, label: 'Frame rate', animatable: false },
    size: { type: 'vec2', default: [320, 180], label: 'Scene size', animatable: false },
  },
  bounds: (props) => ({ x: -props.size[0] / 2, y: -props.size[1] / 2, w: props.size[0], h: props.size[1] }),
  render: {
    canvas2d(ctx, props, host) {
      if (!props.frames.length) return;
      const index = Math.min(props.frames.length - 1, Math.max(0, Math.floor(host.t * props.fps + 1e-6)));
      const image = host.asset(props.frames[index]);
      ctx.drawImage(image, -props.size[0] / 2, -props.size[1] / 2, props.size[0], props.size[1]);
    },
  },
}];
