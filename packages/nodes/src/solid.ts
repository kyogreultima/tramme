// A simple 3D solid (box, slab, sphere, torus, capsule, cylinder) with a matte,
// glossy, glass or metal material, lit by an environment picture or, without
// one, by a studio gradient. Drawn on the node's WebGL2 service like model.3d,
// with the kit they share (gl3d.ts). The solid sits in a square frame of
// `height` px, at the scale of its size in px.

import { type NodeType, type NodeGL } from '@tramme/core';
import { mesh, type SolidShape } from './solids.ts';
import { M, mul, turnX, turnY, lookAt, project, uploadMesh, envTexture, rgbOf, setLit, LIT_FRAG, LIT_VERT, type Upload } from './gl3d.ts';

const FOV = 35 * Math.PI / 180;
const D2R = Math.PI / 180;
const MATERIALS = ['matte', 'glossy', 'glass', 'metal'];

/** uploaded meshes, by what makes them; made again for a new context */
const uploads = new Map<string, { gl: WebGL2RenderingContext; up: Upload }>();

export const solid: NodeType = {
  type: 'solid.3d',
  title: '3D solid',
  category: 'Media',
  description: 'A box, slab, sphere, torus, capsule or cylinder with a matte, glossy, glass or metal material, lit by an environment picture or a studio gradient.',
  props: {
    shape: { type: 'enum', default: 'sphere', options: ['box', 'slab', 'sphere', 'torus', 'capsule', 'cylinder'], animatable: false, label: 'Shape' },
    size: { type: 'json', default: [240, 240, 240], animatable: false, label: 'Size', description: '[width, height, depth] in px' },
    radius: { type: 'number', default: 0, min: 0, max: 2000, step: 1, unit: 'px', animatable: false, label: 'Rounding', description: 'the rounding of a box or a slab’s edges (a slab rounds a little when it is 0)' },
    material: { type: 'enum', default: 'glossy', options: MATERIALS, animatable: false, label: 'Material' },
    color: { type: 'color', default: '#2E6BFF', label: 'Color', description: 'the base colour; glass is tinted by it, metal reflects with it' },
    roughness: { type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, label: 'Roughness', description: '0: a mirror, 1: chalk' },
    env: { type: 'asset', default: null, nullable: true, assetType: 'image', animatable: false, label: 'Environment', description: 'an equirectangular picture that lights the solid; empty: the studio gradient below' },
    envTop: { type: 'color', default: '#DDE6F5', animatable: false, label: 'Studio top' },
    envBottom: { type: 'color', default: '#1B2230', animatable: false, label: 'Studio bottom' },
    yaw: { type: 'number', default: 25, min: -180, max: 180, step: 1, unit: 'deg', label: 'Yaw' },
    pitch: { type: 'number', default: 15, min: -89, max: 89, step: 1, unit: 'deg', label: 'Pitch' },
    spin: { type: 'number', default: 0, min: -360, max: 360, step: 1, unit: 'deg', label: 'Spin', description: 'a turntable spin, degrees per second, from the layer’s start' },
    height: { type: 'number', default: 400, min: 8, max: 4096, step: 1, unit: 'px', label: 'Height', description: 'the square frame the solid is drawn in' },
  },
  bounds(p) {
    const h = Math.max(8, p.height ?? 400);
    return { x: -h / 2, y: -h / 2, w: h, h };
  },
  render: {
    gl(g: NodeGL, p: any, host) {
      const { gl } = g;
      const size = (Array.isArray(p.size) ? p.size : [240, 240, 240]).map((v: unknown) => Math.max(1, Number(v) || 1)) as [number, number, number];
      const key = `${p.shape}|${size.join(',')}|${p.radius}`;
      let hit = uploads.get(key);
      if (!hit || hit.gl !== gl) { hit = { gl, up: uploadMesh(gl, mesh(p.shape as SolidShape, { size, radius: p.radius > 0 ? p.radius : undefined })) }; uploads.set(key, hit); }
      gl.viewport(0, 0, g.width, g.height);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const prog = g.program(LIT_FRAG, LIT_VERT);
      gl.useProgram(prog);
      // one world unit is one px at the centre: the frame's height spans the field of view
      const h = Math.max(8, p.height ?? 400), dist = (h / 2) / Math.tan(FOV / 2), radius = Math.hypot(size[0], size[1], size[2]) / 2;
      const eye = [0, 0, dist];
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uProj'), false, project(M(), FOV, g.width / g.height, Math.max(1, dist - radius * 1.1), dist + radius * 1.5));
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uView'), false, lookAt(M(), eye, [0, 0, 0]));
      let env: { tex: WebGLTexture; lod: number } | null = null;
      if (p.env) { try { env = envTexture(gl, host.asset<TexImageSource & object>(p.env)); } catch { env = null; } }
      const mat = Math.max(0, MATERIALS.indexOf(p.material));
      setLit(g, prog, { mat, roughness: mat === 3 && p.roughness < 0.05 ? 0.05 : p.roughness, eye, env, top: rgbOf(p.envTop), bottom: rgbOf(p.envBottom) });
      const [r, gr, b] = rgbOf(p.color);
      gl.uniform4f(gl.getUniformLocation(prog, 'uColor'), r, gr, b, mat === 2 ? 0.6 : 1);
      const ta = host.t - (host.layerIn ?? 0);
      const turn = mul(M(), turnY(M(), ((p.yaw ?? 0) + (p.spin ?? 0) * ta) * D2R), turnX(M(), (p.pitch ?? 0) * D2R));
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uModel'), false, turn);
      gl.bindVertexArray(hit.up.vao);
      gl.enable(gl.CULL_FACE);
      if (mat === 2) {
        // glass is seen through itself: its far side first, then its near side over it
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.cullFace(gl.FRONT);
        gl.drawElements(gl.TRIANGLES, hit.up.count, gl.UNSIGNED_INT, 0);
        gl.cullFace(gl.BACK);
        gl.drawElements(gl.TRIANGLES, hit.up.count, gl.UNSIGNED_INT, 0);
        gl.disable(gl.BLEND);
      } else {
        gl.cullFace(gl.BACK);
        gl.drawElements(gl.TRIANGLES, hit.up.count, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(null);
    },
  },
};
