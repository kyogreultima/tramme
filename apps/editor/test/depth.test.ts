import { describe, expect, it } from 'vitest';
import { applyOps, Evaluator, validate, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { depthLayers, photo25dOps, scaleFor, steadyDepth } from '../src/depth.ts';
import { fieldsOf, inputOf } from '../src/ai/commands.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();

/** a photo and footage, and a title above them */
function project(): TrammeDoc {
  const doc = newProject({ name: 'Depth', width: 1920, height: 1080, fps: 25, duration: 10 }).doc;
  const c = doc.compositions[doc.root];
  doc.assets.photo = { type: 'image', src: 'assets/photo.png', name: 'Photo' };
  doc.assets.clip = { type: 'video', src: 'assets/clip.mp4', name: 'Clip' };
  doc.assets['depth-photo'] = { type: 'image', src: 'assets/depth/photo.png' };
  doc.assets['depth-clip'] = { type: 'video', src: 'assets/depth/clip.mp4' };
  c.layers = {
    photo: { type: 'image', name: 'Photo', props: { image: 'photo', size: [1920, 1080], fit: 'cover' } },
    clip: { type: 'video', name: 'Clip', in: 1, out: 9, props: { video: 'clip', start: 2, size: [1920, 1080], fit: 'cover' } },
    title: { type: 'text', props: { text: 'SAND' } },
  };
  c.order = ['photo', 'clip', 'title'];
  return doc;
}

describe('the depth of a picture', () => {
  it('wires a photo: the map hidden right above it, the parallax linked to the camera', () => {
    const doc = project(), root = doc.root;
    const { ops, depth } = depthLayers(doc, root, 'photo', 'depth-photo', [25, 12.5, 75, 37.5]);
    const out = applyOps(doc, ops).doc, c = out.compositions[root];
    expect(validate(out, reg)).toEqual([]);
    expect(c.order).toEqual(['photo', depth, 'clip', 'title']);
    expect(depth).toBe('photo-depth');
    // the map: hidden, the same frame and fit, its area scaled to the map's pixels, the same transform
    const m = c.layers[depth];
    expect(m).toMatchObject({ type: 'image', visible: false, props: { image: 'depth-photo', fit: { $link: 'photo.fit' }, box: [25, 12.5, 75, 37.5] } });
    expect(m.transform?.position).toEqual({ $link: 'photo.transform.position' });
    // the parallax: the camera's settings and the layer's own depth, so the camera's move is not counted twice
    expect(c.layers.photo.effects).toEqual([{ id: 'parallax', type: 'fx.parallax', props: { source: depth, perspective: { $link: '$comp.camera.perspective' }, zoom: { $link: '$comp.camera.zoom' }, pan: { $link: '$comp.camera.pan' }, at: { $link: 'photo.transform.depth' } } }]);
    // the map follows the photo
    const ev = new Evaluator(out, reg);
    for (const t of [0, 5, 9.9]) expect(ev.layerAt(depth, t, root).transform).toEqual(ev.layerAt('photo', t, root).transform);
  });

  it('wires footage: silent, timed like the file, no area of its own', () => {
    const doc = project(), root = doc.root;
    const { ops, depth } = depthLayers(doc, root, 'clip', 'depth-clip');
    const out = applyOps(doc, ops).doc, c = out.compositions[root];
    expect(validate(out, reg)).toEqual([]);
    expect(c.layers[depth]).toMatchObject({ type: 'video', visible: false, in: 1, out: 9, props: { video: 'depth-clip', start: 2, fit: 'cover', muted: true } });
    expect(c.layers[depth].props?.box).toBeUndefined();
  });

  it('run again, reuses the map and the parallax', () => {
    const doc = project(), root = doc.root;
    const once = applyOps(doc, depthLayers(doc, root, 'photo', 'depth-photo').ops).doc;
    expect(depthLayers(once, root, 'photo', 'depth-photo')).toEqual({ ops: [], depth: 'photo-depth', framing: 'kept' });
    // a map of another layer is not reused
    expect(depthLayers(once, root, 'clip', 'depth-clip').ops).toHaveLength(3);
  });

  it('steadies the flicker of the model, not the movements', () => {
    const prev = new Uint8ClampedArray([0, 100, 255, 0]), cur = new Uint8ClampedArray([20, 120, 0, 255]);
    expect([...steadyDepth(prev, cur)]).toEqual([10, 110, 0, 255]);
    expect(steadyDepth(null, cur)).toBe(cur);
    expect(steadyDepth(new Uint8ClampedArray([1]), cur)).toBe(cur);
  });

  it('scales the photo up by the most the map can stretch it', () => {
    expect(scaleFor(320, 0.5, 1000)).toBeCloseTo(1.184);
    expect(scaleFor(0, 0.5, 1000)).toBe(1);
    expect(scaleFor(320, 1, 1000)).toBe(scaleFor(320, 0, 1000));
  });

  it('frames a photo wider with its parallax, once, by its own scale', () => {
    const doc = project(), root = doc.root;
    const first = depthLayers(doc, root, 'photo', 'depth-photo');
    expect(first.framing).toBe('scaled');
    const out = applyOps(doc, first.ops).doc;
    expect(out.compositions[root].layers.photo.transform!.scale).toEqual([1.18, 1.18]);
    // run again (depth or photo-2.5d): never scaled twice
    const again = depthLayers(out, root, 'photo', 'depth-photo');
    expect(again.framing).toBe('kept');
    expect(again.ops).toEqual([]);
    // an inset stays an inset: its own scale times the margin, not the margin alone
    const inset = project();
    inset.compositions[root].layers.photo.transform = { scale: [0.4, 0.4] };
    const small = applyOps(inset, depthLayers(inset, root, 'photo', 'depth-photo').ops).doc;
    expect(small.compositions[root].layers.photo.transform!.scale).toEqual([0.47, 0.47]);
    // an animated scale is left as it is
    const moving = project();
    moving.compositions[root].layers.photo.transform = { scale: { $k: [{ t: 0, v: [1, 1] }] } };
    const animated = depthLayers(moving, root, 'photo', 'depth-photo');
    expect(animated.framing).toBe('animated');
    expect(animated.ops.some((o) => o.path.endsWith('/transform/scale') || o.path.endsWith('/transform'))).toBe(false);
    // footage is not framed
    expect(depthLayers(project(), root, 'clip', 'depth-clip').framing).toBeUndefined();
  });

  it('moves a photo in 2.5D: the camera drifts, only once', () => {
    const doc = project(), root = doc.root;
    const { ops, added, margin } = photo25dOps(doc, root);
    expect(added).toBe(true);
    // the photo needs room for the drift on each side: twice its farthest pan, as a share of the frame
    expect(margin).toBeCloseTo(0.128, 5);
    const out = applyOps(doc, ops).doc, c = out.compositions[root];
    expect(validate(out, reg)).toEqual([]);
    // the drift: an arc of uneven keys, eased
    const pan = c.camera!.pan as { $k: { t: number; v: [number, number]; ease?: number[] }[] };
    expect(pan.$k).toHaveLength(3);
    expect(pan.$k[0]).toEqual({ t: 0, v: [0, 0] });
    expect(pan.$k[1].ease).toEqual([0.4, 0, 0.2, 1]);
    expect(pan.$k[2].t).toBe(10);
    expect(c.camera!.perspective).toBe(1000);
    // a camera there already keeps its own move
    const twice = photo25dOps(out, root);
    expect(twice.added).toBe(false);
    expect(twice.ops).toEqual([]);
    expect(twice.margin).toBe(0);
  });

  it('asks for nothing that it can work out: the layer, the photo', () => {
    const doc = project(), root = doc.root, input = reg.tool('depth').tool.input;
    const auto = (selection: string[] = []) => inputOf(fieldsOf(input, doc, root, reg, selection), {});
    // two candidates: nothing is chosen for you; one selection is
    expect(auto()).toEqual({});
    expect(auto(['clip'])).toEqual({ layer: 'clip' });
    expect(fieldsOf(input, doc, root, reg).find((f) => f.key === 'layer')?.options).toEqual([['photo', 'Photo'], ['clip', 'Clip']]);
    const input25 = reg.tool('photo-2.5d').tool.input;
    expect(inputOf(fieldsOf(input25, doc, root, reg, []), {})).toEqual({ layer: 'photo', drift: 1 });
  });
});
