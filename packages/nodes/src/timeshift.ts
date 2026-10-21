// The cut per pixel (docs/components-roadmap.md, step 6): a composition read
// at a time that changes across the frame, t + d(uv). Slit-scan when the
// delay runs along one side (a line of the picture is a moment), a time
// ripple from the centre, a liquid time with noise. The node keeps a ring of
// past frames of its source as one 3D texture (a WebGL2 texture array) and
// reads each pixel from the slice of its delay, blended with the next. Each
// slice is the source at a time fixed by the frame number, so the picture
// stays a pure function of time: a frame rendered alone draws its slices,
// the next frame reuses all of them but one. Costly in memory (the slices
// are kept at a reduced size within a budget) and isolated: nothing else
// reads the ring.

import type { NodeGL, NodeType } from '@tramme/core';

interface TimeShiftProps { comp: string | null; depth: number; slices: number; map: 'left' | 'right' | 'top' | 'bottom' | 'centre' | 'edges' | 'noise'; scale: number; smooth: boolean }

/** what the ring may take on the GPU, all slices together */
const BUDGET = 192 * 1024 * 1024;
export const MAX_SLICES = 48;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uFrames;
uniform int uLayer[${MAX_SLICES}];
uniform int uCount, uMap, uSmooth;
uniform float uScale;
uniform vec2 uSize;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
/** the delay of a point, 0 (now) to 1 (the oldest slice) */
float delay(vec2 uv) {
  if (uMap == 0) return uv.x;
  if (uMap == 1) return 1.0 - uv.x;
  if (uMap == 2) return uv.y;
  if (uMap == 3) return 1.0 - uv.y;
  vec2 c = (uv - 0.5) * vec2(uSize.x / uSize.y, 1.0);
  if (uMap == 4) return clamp(length(c) / 0.75, 0.0, 1.0);
  if (uMap == 5) return 1.0 - clamp(length(c) / 0.75, 0.0, 1.0);
  vec2 q = uv * uScale * vec2(uSize.x / uSize.y, 1.0);
  return clamp(0.65 * noise(q) + 0.35 * noise(q * 2.03 + 7.1), 0.0, 1.0);
}
void main() {
  // y down, as the slices were drawn
  vec2 uv = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uSize;
  float s = delay(uv) * float(uCount - 1);
  int i = int(floor(s));
  int j = min(i + 1, uCount - 1);
  vec4 a = texture(uFrames, vec3(uv, float(uLayer[i])));
  vec4 b = texture(uFrames, vec3(uv, float(uLayer[j])));
  fragColor = uSmooth == 1 ? mix(a, b, fract(s)) : a;
}`;
const MAPS = ['left', 'right', 'top', 'bottom', 'centre', 'edges', 'noise'];

/** the ring of one layer: its texture array, the frame each layer of it holds, and when each was last used */
interface Ring { tex: WebGLTexture; w: number; h: number; layers: number; frames: (number | null)[]; used: number[]; key: string; clock: number }
const rings = new WeakMap<NodeGL, Map<string, Ring>>();

/** the frames of the source the slices show: the newest at t, the oldest depth seconds before, on the source's frames */
export function sliceFrames(t: number, fps: number, depth: number, slices: number): number[] {
  const now = Math.round(t * fps), n = Math.max(2, Math.min(MAX_SLICES, Math.round(slices)));
  const span = Math.max(0, depth) * fps;
  return Array.from({ length: n }, (_, i) => Math.max(0, now - Math.round((span * i) / (n - 1))));
}

/** the size the slices are kept at: the layer's size, reduced so the ring stays within the budget */
export function sliceSize(w: number, h: number, n: number): [number, number] {
  const k = Math.min(1, Math.sqrt(BUDGET / (w * h * 4 * n)));
  return [Math.max(1, Math.floor(w * k)), Math.max(1, Math.floor(h * k))];
}

export const timeShift: NodeType<TimeShiftProps> = {
  type: 'time.shift', title: 'Time displacement', category: 'Time',
  description: 'a composition read later in some places than in others: slit-scan along a side, a time ripple from the centre, a liquid time with noise',
  props: {
    comp: { type: 'comp', default: null, nullable: true, label: 'Composition', animatable: false, description: 'the picture to displace in time (put a video in a composition to displace it)' },
    depth: { type: 'number', default: 0.5, min: 0, max: 4, step: 0.05, unit: 's', label: 'Delay', description: 'how far back the most delayed point reads' },
    slices: { type: 'number', default: 24, min: 2, max: MAX_SLICES, step: 1, label: 'Slices', animatable: false, description: 'moments kept between now and the delay: more is smoother and costs memory' },
    map: { type: 'enum', default: 'left', options: MAPS, label: 'Delay map', animatable: false, description: 'where the delay is: left, right, top, bottom grow it across the frame (slit-scan), centre from the middle out, edges from the sides in, noise in patches' },
    scale: { type: 'number', default: 3, min: 0.5, max: 20, step: 0.1, label: 'Noise scale', description: 'patches across the height, for the noise map' },
    smooth: { type: 'bool', default: true, label: 'Blend slices', animatable: false },
  },
  bounds(p, host) {
    const s = p.comp ? host.compositionSize?.(p.comp) : null;
    return s ? { x: -s.width / 2, y: -s.height / 2, w: s.width, h: s.height } : null;
  },
  render: {
    gl(g, p, host) {
      const { gl } = g;
      const size = p.comp ? host.compositionSize?.(p.comp) : null;
      if (!p.comp || !size || !host.drawComposition) { gl.viewport(0, 0, g.width, g.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return; }
      const lt = Math.max(0, host.t - (host.layerIn ?? 0));
      const frames = sliceFrames(lt, host.fps, p.depth, p.slices), n = frames.length;
      const [w, h] = sliceSize(g.width, g.height, n);
      // the layer's ring, made again when its size or source changes
      let mine = rings.get(g);
      if (!mine) rings.set(g, mine = new Map());
      const key = `${p.comp}/${w}x${h}/${n}`;
      let ring = mine.get(host.layerId);
      if (!ring || ring.key !== key) {
        if (ring) gl.deleteTexture(ring.tex);
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, n);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, v);
        ring = { tex, w, h, layers: n, frames: Array(n).fill(null), used: Array(n).fill(0), key, clock: 0 };
        mine.set(host.layerId, ring);
      }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, ring.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      // each slice's frame in the ring: kept, or drawn into the least recently used layer
      const clock = ++ring.clock, wanted = new Set(frames), layerOf = new Map<number, number>();
      ring.frames.forEach((f, i) => { if (f !== null && wanted.has(f)) { layerOf.set(f, i); ring!.used[i] = clock; } });
      const pad = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = pad.getContext('2d') as CanvasRenderingContext2D;
      for (const f of frames) {
        if (layerOf.has(f)) continue;
        let free = 0;
        for (let i = 1; i < ring.layers; i++) if (ring.used[i] < ring.used[free]) free = i;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.setTransform(w / size.width, 0, 0, h / size.height, 0, 0);
        // a slice drawn while its source was still loading is used once, not kept
        const whole = host.drawComposition(ctx, p.comp, f / host.fps) !== false;
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, free, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, pad as TexImageSource);
        ring.frames[free] = whole ? f : null; ring.used[free] = clock; layerOf.set(f, free);
      }
      const prog = g.program(FRAG);
      gl.useProgram(prog);
      gl.viewport(0, 0, g.width, g.height);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, ring.tex);
      gl.uniform1i(gl.getUniformLocation(prog, 'uFrames'), 0);
      gl.uniform1iv(gl.getUniformLocation(prog, 'uLayer'), Int32Array.from({ length: MAX_SLICES }, (_, i) => layerOf.get(frames[Math.min(i, n - 1)])!));
      gl.uniform1i(gl.getUniformLocation(prog, 'uCount'), n);
      gl.uniform1i(gl.getUniformLocation(prog, 'uMap'), Math.max(0, MAPS.indexOf(p.map)));
      gl.uniform1i(gl.getUniformLocation(prog, 'uSmooth'), p.smooth ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(prog, 'uScale'), p.scale);
      gl.uniform2f(gl.getUniformLocation(prog, 'uSize'), g.width, g.height);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  },
};
