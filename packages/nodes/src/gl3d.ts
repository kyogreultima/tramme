// What the 3D nodes (model.3d, solid.3d) share on the node's WebGL2 service:
// a small mat4 kit, the upload of a mesh, the environment picture as a
// texture, and the lit program that shades a surface by that environment
// (GGX-style specular with Schlick Fresnel, the reflected direction sampled
// with a mip bias from the roughness; glass refracts it).

import { type NodeGL } from '@tramme/core';
import type { Quat } from './gltf.ts';

// ── a small mat4 kit (column-major, like WebGL) ──────────────

export type Mat4 = Float32Array;

export const M = (): Mat4 => new Float32Array(16);
export const ident = (m: Mat4): Mat4 => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; };
export const mul = (out: Mat4, a: Mat4, b: Mat4): Mat4 => {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
};
export const trs = (out: Mat4, t: ArrayLike<number>, q: Quat, s: ArrayLike<number>): Mat4 => {
  const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * s[0]; out[1] = (xy + wz) * s[0]; out[2] = (xz - wy) * s[0]; out[3] = 0;
  out[4] = (xy - wz) * s[1]; out[5] = (1 - (xx + zz)) * s[1]; out[6] = (yz + wx) * s[1]; out[7] = 0;
  out[8] = (xz + wy) * s[2]; out[9] = (yz - wx) * s[2]; out[10] = (1 - (xx + yy)) * s[2]; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
};
export const turnY = (out: Mat4, a: number): Mat4 => { ident(out); const c = Math.cos(a), s = Math.sin(a); out[0] = c; out[2] = -s; out[8] = s; out[10] = c; return out; };
export const turnX = (out: Mat4, a: number): Mat4 => { ident(out); const c = Math.cos(a), s = Math.sin(a); out[5] = c; out[6] = s; out[9] = -s; out[10] = c; return out; };
export const move = (out: Mat4, t: ArrayLike<number>): Mat4 => { ident(out); out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; return out; };
export const project = (out: Mat4, fovY: number, aspect: number, near: number, far: number): Mat4 => {
  const f = 1 / Math.tan(fovY / 2), k = 1 / (near - far);
  out.fill(0); out[0] = f / aspect; out[5] = f; out[10] = (far + near) * k; out[11] = -1; out[14] = 2 * far * near * k;
  return out;
};
export const lookAt = (out: Mat4, eye: number[], at: number[]): Mat4 => {
  let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
  let xx = zz, xz = -zx; const xy = 0; // up (0,1,0) × z
  const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
};

// ── meshes ───────────────────────────────────────────────────

export interface Upload { vao: WebGLVertexArrayObject; count: number }

/** one buffer per attribute, 0 the positions, 1 the normals (or up) */
export function uploadMesh(gl: WebGL2RenderingContext, mesh: { positions: Float32Array; normals?: Float32Array | null; indices: Uint32Array }): Upload {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()!);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  if (mesh.normals) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()!);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  } else {
    gl.disableVertexAttribArray(1);
    gl.vertexAttrib3f(1, 0, 1, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()!);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  return { vao, count: mesh.indices.length };
}

// ── the environment ──────────────────────────────────────────

const envs = new WeakMap<WebGL2RenderingContext, WeakMap<object, { tex: WebGLTexture; lod: number }>>();

/** an equirectangular picture as a mipmapped texture that wraps around, made once per picture and context (the node's `texture` has no mips) */
export function envTexture(gl: WebGL2RenderingContext, src: TexImageSource & object): { tex: WebGLTexture; lod: number } {
  let per = envs.get(gl);
  if (!per) envs.set(gl, per = new WeakMap());
  let hit = per.get(src);
  if (!hit) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const w = (src as { width?: number }).width || 1, h = (src as { height?: number }).height || 1;
    hit = { tex, lod: Math.floor(Math.log2(Math.max(w, h))) };
    per.set(src, hit);
  }
  return hit;
}

/** "#rrggbb" or "rgb(…)" as 0..1 channels; anything else is mid grey */
export function rgbOf(css: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})/i.exec(css.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const rgb = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(css);
  return rgb ? [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255] : [0.5, 0.5, 0.5];
}

// ── the lit program ──────────────────────────────────────────

export const LIT_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uProj, uView, uModel;
out vec3 vN;
out vec3 vW;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * w;
}`;

/** uMat: 0 matte, 1 glossy, 2 glass, 3 metal */
export const LIT_FRAG = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
uniform vec3 uEye;
uniform vec4 uColor;
uniform int uMat;
uniform float uRough;
uniform sampler2D uEnv;
uniform int uHasEnv;
uniform float uLod;
uniform vec3 uTop, uBottom;
out vec4 fragColor;

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 gam(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

// a soft rectangle of light seen in direction d, wider and dimmer as the surface blurs
float softbox(vec3 d, vec3 at, float size, float blur) {
  float c = dot(d, normalize(at));
  return smoothstep(1.0 - size - blur, 1.0 - size + blur * 0.25, c);
}

vec3 envAt(vec3 d, float rough) {
  if (uHasEnv == 1) {
    vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, acos(clamp(d.y, -1.0, 1.0)) / 3.14159265);
    return lin(textureLod(uEnv, uv, rough * uLod).rgb);
  }
  // the studio: the two colours as a gradient, a key softbox up and to the left, a strip behind to the right
  vec3 col = mix(lin(uBottom), lin(uTop), smoothstep(-0.6, 0.8, d.y));
  float blur = 0.02 + rough * 0.5;
  col += vec3(3.2) * softbox(d, vec3(-0.6, 0.8, 0.6), 0.06, blur) * (1.0 - rough * 0.7);
  col += vec3(1.6, 1.7, 1.9) * softbox(d, vec3(0.9, 0.2, -0.5), 0.02, blur) * (1.0 - rough * 0.7);
  return col;
}

float ggx(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (3.14159265 * d * d); }

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vW);
  float nv = max(dot(N, V), 0.001);
  vec3 R = reflect(-V, N);
  vec3 base = lin(uColor.rgb);
  float rough = clamp(uRough, 0.04, 1.0);
  vec3 L = normalize(vec3(-0.6, 0.8, 0.6));
  vec3 H = normalize(L + V);
  float nl = max(dot(N, L), 0.0);

  vec3 f0 = uMat == 3 ? base : vec3(0.04);
  vec3 fr = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
  vec3 spec = envAt(R, rough) * fr;
  // a key light's highlight, so a glossy surface has a point of light whatever the picture holds
  float a = rough * rough;
  spec += vec3(ggx(max(dot(N, H), 0.0), max(a, 0.02)) * nl * 0.12) * fr * (1.0 - rough);

  if (uMat == 2) {
    // a thin transmissive surface: the environment through it, tinted, and its edge bright where it reflects
    vec3 T = refract(-V, N, 1.0 / 1.45);
    vec3 through = envAt(length(T) > 0.0 ? T : R, rough) * mix(vec3(1.0), base, 0.85);
    float edge = fr.r;
    vec3 c = through * (1.0 - edge) + spec;
    float alpha = clamp(uColor.a * 0.5 + 0.5 * edge + max(spec.r, max(spec.g, spec.b)), 0.0, 1.0);
    fragColor = vec4(gam(c) * alpha, alpha);
    return;
  }
  vec3 c = spec;
  if (uMat != 3) c += base * (1.0 - fr) * envAt(N, 1.0);
  fragColor = vec4(gam(c) * uColor.a, uColor.a);
}`;

export interface LitState {
  /** 0 matte, 1 glossy, 2 glass, 3 metal */
  mat: number;
  roughness: number;
  eye: number[];
  /** the picture lighting the surface: null for the studio gradient between top and bottom */
  env: { tex: WebGLTexture; lod: number } | null;
  top: [number, number, number];
  bottom: [number, number, number];
}

/** sets the uniforms of the lit program that do not change between meshes of a frame */
export function setLit(g: NodeGL, prog: WebGLProgram, s: LitState) {
  const { gl } = g, at = (n: string) => gl.getUniformLocation(prog, n);
  gl.uniform3fv(at('uEye'), s.eye);
  gl.uniform1i(at('uMat'), s.mat);
  gl.uniform1f(at('uRough'), s.roughness);
  gl.uniform1i(at('uHasEnv'), s.env ? 1 : 0);
  gl.uniform1f(at('uLod'), s.env?.lod ?? 0);
  gl.uniform3fv(at('uTop'), s.top);
  gl.uniform3fv(at('uBottom'), s.bottom);
  if (s.env) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.env.tex);
    gl.uniform1i(at('uEnv'), 0);
  }
}
