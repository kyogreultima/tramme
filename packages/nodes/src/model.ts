// A 3D model read from a .glb (glTF 2.0), drawn on the node's own WebGL2
// service (packages/render/src/gpu.ts): the file is parsed once at load, the
// meshes are uploaded once per context, and each frame animates the parts'
// translation, rotation and scale (rigid animation — skinned meshes draw at
// rest) and turns with the layer's time. The model is centred on the layer
// origin, framed square by `height` composition pixels; the camera sits far
// enough to hold the whole model whatever its shape.

import { type NodeType, type NodeGL } from '@tramme/core';
import { parseGltf, sampleChannel, type GltfModel, type GltfNode } from './gltf.ts';
import { M, ident, mul, trs, turnY, turnX, move, project, lookAt, uploadMesh, envTexture, rgbOf, setLit, LIT_FRAG, LIT_VERT, type Mat4, type Upload } from './gl3d.ts';

// ── the parsed files and their uploads ───────────────────────

/** parsed files, keyed by asset id, with the address they were read from (a replaced file is read again) */
const models = new Map<string, GltfModel>();
const modelUrls = new Map<string, string>();
/** uploaded meshes, keyed by asset id; made again when the context is new */
interface Uploads { gl: WebGL2RenderingContext; prims: (Upload & { color: number[] })[] }
const uploads = new Map<string, Uploads>();

const FOV = 35 * Math.PI / 180;
const D2R = Math.PI / 180;

const VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uProj, uView, uModel;
out vec3 vN;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vN = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * w;
}`;
const FRAG = `#version 300 es
precision highp float;
in vec3 vN;
uniform vec4 uColor;
uniform int uLight;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 base = uColor.rgb;
  float a = uColor.a;
  if (uLight == 2) { fragColor = vec4(base * a, a); return; } // flat
  float lit = 0.16; // a floor of ambient
  lit += 0.85 * max(dot(n, normalize(vec3(-0.5, 0.85, 0.55))), 0.0); // the key
  lit += 0.34 * max(dot(n, normalize(vec3(0.35, 0.45, 1.0))), 0.0); // the fill, towards the eye
  if (uLight == 0) lit += 0.35 * max(dot(n, normalize(vec3(0.8, 0.15, -0.5))), 0.0); // a studio rim
  fragColor = vec4(base * min(lit, 1.35) * a, a);
}`;

const T = new Float32Array(3), Q = new Float32Array(4), S = new Float32Array(3);

/** the node's local matrix at ta, its animation tracks applied */
function localOf(n: GltfNode, ta: number, out: Mat4): Mat4 {
  T.set(n.translation); Q.set(n.rotation); S.set(n.scale);
  for (const c of n.channels) sampleChannel(c, ta, c.path === 'rotation' ? Q : c.path === 'scale' ? S : T);
  return trs(out, T, [Q[0], Q[1], Q[2], Q[3]], S);
}

export const model: NodeType = {
  type: 'model.3d',
  title: '3D model',
  category: 'Media',
  description: 'A .glb model (glTF 2.0) drawn in 3D: its parts animate rigidly, it may spin slowly, its materials show by their base colour. Skinned meshes draw at rest.',
  props: {
    source: { type: 'asset', default: null, nullable: true, assetType: 'model', animatable: false, label: 'Model' },
    height: { type: 'number', default: 400, min: 8, max: 4096, step: 1, unit: 'px', label: 'Height', description: 'the square frame the model is drawn in' },
    spin: { type: 'number', default: 0, min: -360, max: 360, step: 1, unit: 'deg', label: 'Spin', description: 'a turntable spin, degrees per second, from the layer’s start' },
    yaw: { type: 'number', default: 0, min: -180, max: 180, step: 1, unit: 'deg', label: 'Yaw' },
    pitch: { type: 'number', default: 0, min: -89, max: 89, step: 1, unit: 'deg', label: 'Pitch' },
    explode: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, label: 'Explode', description: 'the parts drift away from the centre' },
    light: { type: 'enum', default: 'studio', options: ['studio', 'sun', 'flat'], animatable: false, label: 'Light' },
    env: { type: 'asset', default: null, nullable: true, assetType: 'image', animatable: false, label: 'Environment', description: 'an equirectangular picture that lights the model by reflection; empty: the light above' },
  },
  async load(p, host) {
    if (!p.source) return;
    const url = host.asset<string>(p.source);
    if (models.has(p.source) && modelUrls.get(p.source) === url) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the model file could not be read (HTTP ${res.status})`);
    models.set(p.source, parseGltf(await res.arrayBuffer()));
    modelUrls.set(p.source, url);
    uploads.delete(p.source);
  },
  bounds(p) {
    const h = Math.max(8, p.height ?? 400);
    return { x: -h / 2, y: -h / 2, w: h, h };
  },
  render: {
    gl(g: NodeGL, p: any, host) {
      const m = p.source ? models.get(p.source) : null;
      if (!m) throw new Error('the model file is not loaded yet');
      const { gl } = g;
      // this layer's picture: g.width × g.height from the bottom left of the type's shared canvas
      gl.viewport(0, 0, g.width, g.height);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      let env: { tex: WebGLTexture; lod: number } | null = null;
      if (p.env) { try { env = envTexture(gl, host.asset<TexImageSource & object>(p.env)); } catch { env = null; } }
      const prog = env ? g.program(LIT_FRAG, LIT_VERT) : g.program(FRAG, VERT);
      gl.useProgram(prog);
      let up = uploads.get(p.source);
      if (!up || up.gl !== gl) { up = { gl, prims: [] }; upload(m.roots, gl, up); uploads.set(p.source, up); }
      const aspect = g.width / g.height;
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uProj'), false, project(M(), FOV, aspect, m.radius / 32, m.radius * 8));
      const dist = m.radius / Math.sin(FOV / 2) * 1.06;
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uView'), false, lookAt(M(), [m.center[0], m.center[1], m.center[2] + dist], [m.center[0], m.center[1], m.center[2]]));
      if (env) setLit(g, prog, { mat: 1, roughness: 0.4, eye: [m.center[0], m.center[1], m.center[2] + dist], env, top: rgbOf('#DDE6F5'), bottom: rgbOf('#1B2230') });
      else gl.uniform1i(gl.getUniformLocation(prog, 'uLight'), p.light === 'sun' ? 1 : p.light === 'flat' ? 2 : 0);
      const uModel = gl.getUniformLocation(prog, 'uModel'), uColor = gl.getUniformLocation(prog, 'uColor');
      const ta = host.t - (host.layerIn ?? 0);
      const at = m.duration > 0 ? ta - Math.floor(ta / m.duration) * m.duration : 0;
      // the turn pivots on the model's centre: a model authored away from the origin spins in place instead of orbiting
      const turn = mul(M(), mul(M(), move(M(), m.center), mul(M(), turnY(M(), ((p.yaw ?? 0) + (p.spin ?? 0) * ta) * D2R), turnX(M(), (p.pitch ?? 0) * D2R))), move(M(), [-m.center[0], -m.center[1], -m.center[2]]));
      const explode = p.explode ?? 0;
      let i = 0;
      const walk = (n: GltfNode, parent: Mat4) => {
        const world = mul(M(), parent, localOf(n, at, M()));
        for (const prim of n.prims) {
          const d = up!.prims[i++];
          let local = world;
          if (explode > 0) {
            const dx = n.center[0] - m.center[0], dy = n.center[1] - m.center[1], dz = n.center[2] - m.center[2];
            const l = Math.hypot(dx, dy, dz) || 1;
            const apart = ident(M()); apart[12] = (dx / l) * explode * m.radius * 1.5; apart[13] = (dy / l) * explode * m.radius * 1.5; apart[14] = (dz / l) * explode * m.radius * 1.5;
            local = mul(M(), world, apart);
          }
          gl.uniformMatrix4fv(uModel, false, mul(M(), turn, local));
          gl.uniform4fv(uColor, d.color);
          gl.bindVertexArray(d.vao);
          gl.drawElements(gl.TRIANGLES, d.count, gl.UNSIGNED_INT, 0);
        }
        n.children.forEach((c) => walk(c, world));
      };
      walk({ name: '§root', prims: [], children: m.roots, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], channels: [], center: m.center, radius: m.radius }, ident(M()));
      gl.bindVertexArray(null);
    },
  },
};

/** one upload per primitive, in the order the walk meets them */
function upload(roots: GltfNode[], gl: WebGL2RenderingContext, up: Uploads) {
  const walk = (n: GltfNode) => {
    for (const prim of n.prims) up.prims.push({ ...uploadMesh(gl, prim), color: prim.color });
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  gl.bindVertexArray(null);
}
