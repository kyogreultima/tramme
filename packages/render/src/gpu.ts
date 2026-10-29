// GLSL passes for effects, on one shared WebGL2 canvas. An effect writes
//   vec4 effect(vec2 uv)
// reading uImage (the picture it applies to: a layer drawn alone, or the
// whole frame), uRes (its size in pixels), uScale (pixels per composition
// pixel: sizes in props are composition pixels), uTime, uLayerTime (the time
// since the in point of the layer it applies to), and one uniform per
// property of its schema, declared here from the schema: u_<name> as float
// (number, bool, enum: the rank of the option), vec2, vec4 (colour, 0..1
// straight) or sampler2D (a layer, drawn alone at the same instant); a LUT
// asset (assetType 'lut') as sampler3D u_<name> with u_<name>_size,
// u_<name>_min and u_<name>_max (its table's size and domain); a tone curve
// (a path prop of format 'curve') as sampler2D u_<name>, 256 values in red.
// Programs are compiled once per source.

import { applyHomography, curveTable, homography, invertHomography, parseColor, type Lut3D, type PathValue, type PropSchema, type Quad } from '@tramme/core';

const VERT = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/** the declarations a schema gives a fragment */
export function uniformsOf(schema: PropSchema): string {
  return Object.entries(schema).map(([k, d]) => {
    const n = `u_${k.replace(/\W/g, '_')}`;
    if (d.type === 'number' || d.type === 'bool' || d.type === 'enum') return `uniform float ${n};`;
    if (d.type === 'vec2') return `uniform vec2 ${n};`;
    if (d.type === 'color') return `uniform vec4 ${n};`;
    // a layer, and whether one is named (a mask left out acts as all white, by the effect's choice)
    if (d.type === 'layer') return `uniform sampler2D ${n}; uniform float ${n}_set;`;
    if (d.type === 'asset' && d.assetType === 'lut') return `uniform highp sampler3D ${n}; uniform float ${n}_size; uniform vec3 ${n}_min; uniform vec3 ${n}_max;`;
    if (d.type === 'path' && d.format === 'curve') return `uniform sampler2D ${n};`;
    return '';
  }).filter(Boolean).join('\n');
}

/** the whole fragment program of an effect */
export const fragmentOf = (code: string, schema: PropSchema) => `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uImage; uniform vec2 uRes; uniform float uScale; uniform float uTime; uniform float uLayerTime;
${uniformsOf(schema)}
${code}
void main() { fragColor = effect(vUv); }`;

interface GL { canvas: OffscreenCanvas | HTMLCanvasElement; gl: WebGL2RenderingContext; programs: Map<string, WebGLProgram | Error>; vao: WebGLVertexArrayObject; textures: WebGLTexture[] }
let shared: GL | null = null;

/** a canvas for WebGL2, where the platform makes one (null in a bare runtime) */
function glCanvas(): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(4, 4);
  if (typeof document !== 'undefined') return document.createElement('canvas');
  return null;
}

function context(): GL {
  if (shared && !shared.gl.isContextLost()) return shared;
  const canvas = glCanvas();
  const gl = canvas?.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null;
  if (!canvas || !gl) throw new Error('WebGL2 unavailable for GPU effects');
  shared = { canvas, gl, programs: new Map(), vao: gl.createVertexArray()!, textures: [] };
  return shared;
}

/** a compiled program, or the compile error (kept, so a broken effect is not compiled each frame) */
export function program(g: { gl: WebGL2RenderingContext; programs: Map<string, WebGLProgram | Error> }, frag: string, vert = VERT): WebGLProgram {
  const hit = g.programs.get(frag);
  if (hit instanceof Error) throw hit;
  if (hit) return hit;
  const { gl } = g;
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`GLSL: ${gl.getShaderInfoLog(s)?.trim()}`);
    return s;
  };
  try {
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vert));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`GLSL: ${gl.getProgramInfoLog(p)}`);
    g.programs.set(frag, p);
    return p;
  } catch (e) {
    g.programs.set(frag, e as Error);
    throw e;
  }
}

/** sets the uniforms of a schema's values; layer props are bound by the caller as textures (returned by name) */
export function setUniforms(gl: WebGL2RenderingContext, p: WebGLProgram, schema: PropSchema, props: Record<string, unknown>, firstUnit: number, textureOf: (name: string, value: unknown) => WebGLTexture | null, lutOf: (name: string, value: unknown) => Lut3D | null = () => null) {
  let unit = firstUnit;
  for (const [k, d] of Object.entries(schema)) {
    const loc = gl.getUniformLocation(p, `u_${k.replace(/\W/g, '_')}`);
    if (!loc) continue;
    const v = props[k];
    if (d.type === 'number') gl.uniform1f(loc, Number(v) || 0);
    else if (d.type === 'bool') gl.uniform1f(loc, v ? 1 : 0);
    else if (d.type === 'enum') gl.uniform1f(loc, Math.max(0, d.options?.indexOf(String(v)) ?? 0));
    else if (d.type === 'vec2') { const a = (v as number[]) ?? [0, 0]; gl.uniform2f(loc, a[0], a[1]); }
    else if (d.type === 'color') { let c = [0, 0, 0, 0]; try { const [r, g, b, a] = parseColor(String(v)); c = [r / 255, g / 255, b / 255, a]; } catch { /* left transparent */ } gl.uniform4fv(loc, c); }
    else if (d.type === 'layer') {
      // the unit first: making the texture binds it to the active unit
      gl.activeTexture(gl.TEXTURE0 + unit);
      const tex = textureOf(k, v);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit++);
      gl.uniform1f(gl.getUniformLocation(p, `u_${k.replace(/\W/g, '_')}_set`), typeof v === 'string' && v ? 1 : 0);
    } else if (d.type === 'path' && d.format === 'curve') {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, curveTexture(gl, ((v as PathValue | undefined)?.v ?? []) as number[][]));
      gl.uniform1i(loc, unit++);
    } else if (d.type === 'asset' && d.assetType === 'lut') {
      const n = `u_${k.replace(/\W/g, '_')}`, lut = lutOf(k, v);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_3D, lut ? lutTexture(gl, lut) : null);
      gl.uniform1i(loc, unit++);
      gl.uniform1f(gl.getUniformLocation(p, `${n}_size`), lut?.size ?? 0);
      gl.uniform3fv(gl.getUniformLocation(p, `${n}_min`), lut?.domainMin ?? [0, 0, 0]);
      gl.uniform3fv(gl.getUniformLocation(p, `${n}_max`), lut?.domainMax ?? [1, 1, 1]);
    }
  }
}

/** a tone curve as a 256 × 1 texture of half floats (red), the last ones kept by their points */
const CURVES = new WeakMap<WebGL2RenderingContext, Map<string, WebGLTexture>>();
function curveTexture(gl: WebGL2RenderingContext, points: number[][]): WebGLTexture {
  let made = CURVES.get(gl);
  if (!made) CURVES.set(gl, (made = new Map()));
  const key = JSON.stringify(points);
  let t = made.get(key);
  if (t) { made.delete(key); made.set(key, t); return t; }
  t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 256, 1, 0, gl.RED, gl.FLOAT, curveTable(points, 256));
  for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
  made.set(key, t);
  // an animated curve makes a new one each frame: the oldest go
  for (const [old, tex] of made) { if (made.size <= 64) break; gl.deleteTexture(tex); made.delete(old); }
  return t;
}

/** a LUT's table as a 3D texture (half floats, which WebGL2 always filters), made once per context */
const LUTS = new WeakMap<WebGL2RenderingContext, WeakMap<Lut3D, WebGLTexture>>();
function lutTexture(gl: WebGL2RenderingContext, lut: Lut3D): WebGLTexture {
  let made = LUTS.get(gl);
  if (!made) LUTS.set(gl, (made = new WeakMap()));
  let t = made.get(lut);
  if (t) return t;
  t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_3D, t);
  // an array upload refuses the flips and premultiplication the pictures' uploads leave set
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
  made.set(lut, t);
  return t;
}

function texture(gl: WebGL2RenderingContext, src: TexImageSource): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// ── a picture warped onto a quad ─────────────────────────────

/** the pixels a quad covers, whole ones (`scale`: canvas pixels per unit of the quad) */
export function warpBox(to: Quad, scale: number): { x: number; y: number; w: number; h: number } {
  const xs = to.map((p) => p[0] * scale), ys = to.map((p) => p[1] * scale);
  const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  return { x, y, w: Math.ceil(Math.max(...xs)) - x, h: Math.ceil(Math.max(...ys)) - y };
}

const WARP = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uImage; uniform vec2 uRes; uniform mat3 uInv;
void main() {
  vec3 s = uInv * vec3(gl_FragCoord.x, uRes.y - gl_FragCoord.y, 1.0);
  if (s.z <= 0.0) { fragColor = vec4(0.0); return; }
  vec2 uv = vec2(s.x / s.z / uRes.x, 1.0 - s.y / s.z / uRes.y);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { fragColor = vec4(0.0); return; }
  fragColor = texture(uImage, uv);
}`;

/**
 * A picture (a canvas of the frame's size) drawn through the projective map
 * of `from` onto `to`, both quads in canvas pixels times `scale`: one pass on
 * the shared WebGL2 canvas, bilinear, premultiplied. It is drawn into `ctx`
 * with the alpha, the blend and the filter `ctx` holds.
 */
export function warpQuad(ctx: CanvasRenderingContext2D, source: CanvasImageSource, from: Quad, to: Quad, scale = 1): void {
  const g = context(), { gl } = g, { width: w, height: h } = ctx.canvas;
  const sc = (q: Quad) => q.map((p) => [p[0] * scale, p[1] * scale]) as Quad;
  const hom = homography(sc(from), sc(to));
  // where the whole picture lands: only that box is drawn
  const lands = ([[0, 0], [w, 0], [w, h], [0, h]] as [number, number][]).map((p) => applyHomography(hom, p)) as Quad;
  const finite = lands.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const box = finite ? warpBox(lands, 1) : { x: 0, y: 0, w, h };
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y), x1 = Math.min(w, box.x + box.w), y1 = Math.min(h, box.y + box.h);
  if (x1 <= x0 || y1 <= y0) return;
  if (g.canvas.width !== w || g.canvas.height !== h) { g.canvas.width = w; g.canvas.height = h; }
  const p = program(g, WARP);
  const image = texture(gl, source as TexImageSource);
  try {
    const inv = invertHomography(hom);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, image);
    gl.uniform1i(gl.getUniformLocation(p, 'uImage'), 0);
    gl.uniform2f(gl.getUniformLocation(p, 'uRes'), w, h);
    // column-major
    gl.uniformMatrix3fv(gl.getUniformLocation(p, 'uInv'), false, [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
    gl.bindVertexArray(g.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(g.canvas as CanvasImageSource, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  } finally {
    gl.deleteTexture(image);
  }
}

// ── the nodes' WebGL2 service ────────────────────────────────

interface GLState { canvas: OffscreenCanvas | HTMLCanvasElement; gl: WebGL2RenderingContext; width: number; height: number; programs: Map<string, WebGLProgram | Error>; program(frag: string, vert?: string): WebGLProgram; texture(src: TexImageSource): WebGLTexture }
/** one node type's context, kept from frame to frame (its uploaded meshes, its programs) */
const nodes = new Map<string, GLState>();

/**
 * The WebGL2 service of one node type: its own canvas and context (a lost
 * context is made again, and the node's `load` may run again), the programs
 * cached per source. Sized by the caller to the area to fill.
 */
export function nodeContext(key: string): import('@tramme/core').NodeGL {
  const has = nodes.get(key);
  if (has && !has.gl.isContextLost()) return has;
  const canvas = glCanvas();
  const gl = canvas?.getContext('webgl2', { premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null;
  if (!canvas || !gl) throw new Error('WebGL2 unavailable for this node');
  const state: GLState = { canvas, gl, width: 1, height: 1, programs: new Map(), program: (frag, vert) => program(state, frag, vert), texture: (src) => texture(gl, src) };
  nodes.set(key, state);
  return state;
}

/**
 * Sets the picture a node draws next, in canvas pixels. The canvas only
 * grows: the layers of one type at different sizes share it without
 * reallocating its buffers every frame (each draws its corner, from the
 * bottom left).
 */
export function resizeNode(g: import('@tramme/core').NodeGL, w: number, h: number) {
  g.width = Math.max(1, w); g.height = Math.max(1, h);
  if (g.canvas.width < g.width || g.canvas.height < g.height) {
    g.canvas.width = Math.max(g.canvas.width, g.width);
    g.canvas.height = Math.max(g.canvas.height, g.height);
  }
}

/**
 * Runs an effect's fragment over the pixels of a 2D canvas, in place: the
 * canvas is read as premultiplied sRGB and gets the result. `layers` gives
 * the pictures of the effect's layer props (canvases of the same size).
 */
export function glPass(ctx: CanvasRenderingContext2D, code: string, schema: PropSchema, props: Record<string, unknown>, t: number, scale: number, layers: Record<string, CanvasImageSource | null> = {}, layerIn = 0, lutOf: (name: string, value: unknown) => Lut3D | null = () => null) {
  const g = context(), { gl } = g, { width: w, height: h } = ctx.canvas;
  if (g.canvas.width !== w || g.canvas.height !== h) { g.canvas.width = w; g.canvas.height = h; }
  const p = program(g, fragmentOf(code, schema));
  const made: WebGLTexture[] = [];
  try {
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p);
    const image = texture(gl, ctx.canvas as TexImageSource);
    made.push(image);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, image);
    gl.uniform1i(gl.getUniformLocation(p, 'uImage'), 0);
    gl.uniform2f(gl.getUniformLocation(p, 'uRes'), w, h);
    gl.uniform1f(gl.getUniformLocation(p, 'uTime'), t);
    gl.uniform1f(gl.getUniformLocation(p, 'uLayerTime'), t - layerIn);
    gl.uniform1f(gl.getUniformLocation(p, 'uScale'), scale);
    setUniforms(gl, p, schema, props, 1, (k) => {
      const src = layers[k];
      if (!src) return null;
      const tex = texture(gl, src as TexImageSource);
      made.push(tex);
      return tex;
    }, lutOf);
    gl.bindVertexArray(g.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.drawImage(g.canvas as CanvasImageSource, 0, 0);
    ctx.restore();
  } finally {
    for (const tex of made) gl.deleteTexture(tex);
  }
}
