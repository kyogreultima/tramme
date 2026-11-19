// A video frame made small on the graphics card (Host.quick, the preview while
// it moves). WebGL takes a VideoFrame in by its fast path, where the 2D canvas
// converts every pixel of it on each draw; the small picture is then drawn as
// any other. Measured 2026-11-19 on a 4K take shown at 960×540: one shot
// 73 → 90 frames per second, two overlapping 33 → 43. A box filter (n×n
// bilinear taps, each the mean of 2×2 texels) keeps the small picture free of
// shimmer; mipmaps would cost more than the whole gain.
//
// One WebGL canvas serves every frame: drawImage copies its picture at once,
// so the next frame may draw over it.

interface Shrinker {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  gl: WebGL2RenderingContext;
  tex: WebGLTexture;
  u: { texel: WebGLUniformLocation | null; foot: WebGLUniformLocation | null; taps: WebGLUniformLocation | null };
}

const VERT = `#version 300 es
out vec2 uv;
void main() {
  vec2 q = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = vec2(q.x, 1.0 - q.y);
  gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
}`;

// taps: per axis, 1 to 4; foot: a target pixel's footprint in source texels
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform vec2 texel;
uniform vec2 foot;
uniform ivec2 taps;
in vec2 uv;
out vec4 color;
void main() {
  vec4 sum = vec4(0.0);
  vec2 n = vec2(taps);
  for (int y = 0; y < 4; y++) {
    if (y >= taps.y) break;
    for (int x = 0; x < 4; x++) {
      if (x >= taps.x) break;
      vec2 off = (vec2(float(x), float(y)) - (n - 1.0) * 0.5) * foot / n;
      sum += texture(tex, uv + off * texel);
    }
  }
  color = sum / (n.x * n.y);
}`;

let shrinker: Shrinker | null | undefined;

function make(): Shrinker | null {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : null;
  const gl = canvas?.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null;
  if (!canvas || !gl) return null;
  const shader = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  gl.useProgram(p);
  gl.bindVertexArray(gl.createVertexArray());
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.uniform1i(gl.getUniformLocation(p, 'tex'), 0);
  return { canvas, gl, tex, u: { texel: gl.getUniformLocation(p, 'texel'), foot: gl.getUniformLocation(p, 'foot'), taps: gl.getUniformLocation(p, 'taps') } };
}

/** taps per axis for a footprint of `foot` texels: each tap covers 2 of them, 4 at most */
export const tapsFor = (foot: number) => Math.min(4, Math.max(1, Math.ceil(foot / 2)));

/** `frame` at width × height (at least half smaller), or null (no WebGL2, a lost context): the caller draws the frame itself */
export function shrinkFrame(frame: VideoFrame, width: number, height: number): CanvasImageSource | null {
  if (shrinker === undefined) shrinker = make();
  const s = shrinker;
  if (!s || s.gl.isContextLost()) return null;
  const fw = frame.displayWidth, fh = frame.displayHeight;
  if (!fw || !fh) return null;
  const { gl, canvas, u } = s;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  gl.viewport(0, 0, width, height);
  gl.bindTexture(gl.TEXTURE_2D, s.tex);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame); }
  catch { return null; }
  const fx = fw / width, fy = fh / height;
  gl.uniform2f(u.texel, 1 / fw, 1 / fh);
  gl.uniform2f(u.foot, fx, fy);
  gl.uniform2i(u.taps, tapsFor(fx), tapsFor(fy));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return canvas as CanvasImageSource;
}
