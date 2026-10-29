// The meshes of the 3D solids: box, slab, sphere, torus, capsule and cylinder,
// made as pure functions of a size, so the same node always draws the same
// solid. Every mesh is centred on the origin, indexed counter-clockwise seen
// from outside (back faces can be culled), with a unit normal per vertex.

export type SolidShape = 'box' | 'slab' | 'sphere' | 'torus' | 'capsule' | 'cylinder';

export interface MeshData { positions: Float32Array; normals: Float32Array; indices: Uint32Array }
export interface MeshOptions {
  /** the extent on x, y and z (px) */
  size: [number, number, number];
  /** box and slab: the rounding of the edges; a slab rounds a little unless it is told not to */
  radius?: number;
  /** the divisions around a curved solid (default 24) */
  segments?: number;
}

/** the vertices and triangles being gathered */
class Builder {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  vertex(p: ArrayLike<number>, n: ArrayLike<number>): number {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0] / l, n[1] / l, n[2] / l);
    return this.positions.length / 3 - 1;
  }
  /** a grid of vertices (rows × columns), its quads split into two triangles each, wound counter-clockwise from outside when the rows go up the surface and the columns round it */
  grid(first: number, rows: number, cols: number, wrapCols = false) {
    const at = (i: number, j: number) => first + i * (wrapCols ? cols : cols + 1) + (wrapCols ? j % cols : j);
    const last = wrapCols ? cols : cols;
    for (let i = 0; i < rows; i++) for (let j = 0; j < last; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      this.indices.push(a, b, c, b, d, c);
    }
  }
  done(): MeshData {
    return { positions: new Float32Array(this.positions), normals: new Float32Array(this.normals), indices: new Uint32Array(this.indices) };
  }
}

/** consecutive equal values are one value */
const distinct = (values: number[]) => values.filter((v, i) => i === 0 || Math.abs(v - values[i - 1]) > 1e-9);

/** where the grid lines of a box face fall along an axis: the two corners' arcs, and nothing between them (a flat face needs none) */
function lines(half: number, r: number, steps: number): number[] {
  if (r <= 0) return [-half, half];
  const arc = (from: number) => Array.from({ length: steps + 1 }, (_, i) => from + (r * i) / steps);
  return distinct([...arc(-half), ...arc(half - r)]);
}

/** a box of the size with its edges rounded by r: every vertex of the sharp box's faces is pulled onto the rounded surface around the box shrunk by r */
function box(size: [number, number, number], r: number, segments: number): MeshData {
  const half = size.map((s) => s / 2);
  const round = Math.max(0, Math.min(r, ...half));
  const steps = round > 0 ? Math.max(2, Math.ceil(segments / 4)) : 0;
  const b = new Builder();
  for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
    const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
    const us = lines(half[t1], round, steps), vs = lines(half[t2], round, steps);
    const first = b.positions.length / 3;
    for (const u of us) for (const v of vs) {
      const p = [0, 0, 0];
      p[axis] = sign * half[axis]; p[t1] = u; p[t2] = v;
      if (round <= 0) { const n = [0, 0, 0]; n[axis] = sign; b.vertex(p, n); continue; }
      const q = p.map((x, k) => Math.max(-(half[k] - round), Math.min(half[k] - round, x)));
      const n = p.map((x, k) => x - q[k]);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      b.vertex(q.map((x, k) => x + (n[k] / l) * round), n);
    }
    // the face's rows run along t1 and its columns along t2: the faces of a negative sign wind the other way round
    const cols = vs.length;
    for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < cols - 1; j++) {
      const a = first + i * cols + j, c = a + 1, d = a + cols, e = d + 1;
      if (sign > 0) b.indices.push(a, d, e, a, e, c); else b.indices.push(a, e, d, a, c, e);
    }
  }
  return b.done();
}

/** a point of a solid of revolution's profile: its distance from the axis (1 is the full radius), its height, and the profile's tangent there */
interface Rim { rho: number; y: number; dr: number; dy: number }

/**
 * A solid of revolution about y, from profiles walked from the bottom up: the
 * rings of each profile, joined. rx and rz are the radii on x and z, so an
 * elliptic section keeps exact normals (the cross product of the surface's
 * two tangents, which at a pole needs only the profile's).
 */
function lathe(profiles: Rim[][], rx: number, rz: number, around: number): MeshData {
  const b = new Builder();
  for (const profile of profiles) {
    const first = b.positions.length / 3;
    for (const { rho, y, dr, dy } of profile) {
      for (let j = 0; j <= around; j++) {
        const th = (j / around) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
        b.vertex([rx * rho * c, y, rz * rho * s], [rz * dy * c, -rx * rz * dr, rx * dy * s]);
      }
    }
    b.grid(first, profile.length - 1, around);
  }
  return b.done();
}

/** the profile of a half turn of latitude from `from` to `to` (radians, 0 at the equator), a cap `rise` high, centred at height `at` */
function arc(from: number, to: number, steps: number, rise: number, at: number): Rim[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const psi = from + ((to - from) * i) / steps;
    return { rho: Math.cos(psi), y: at + rise * Math.sin(psi), dr: -Math.sin(psi), dy: rise * Math.cos(psi) };
  });
}

function sphere(size: [number, number, number], segments: number): MeshData {
  const [w, h, d] = size;
  return lathe([arc(-Math.PI / 2, Math.PI / 2, Math.max(4, Math.ceil(segments / 2)), h / 2, 0)], w / 2, d / 2, segments);
}

function capsule(size: [number, number, number], segments: number): MeshData {
  const [w, h, d] = size, rx = w / 2, rz = d / 2;
  const cap = Math.min(rx, rz, h / 2), length = h - 2 * cap, steps = Math.max(2, Math.ceil(segments / 4));
  return lathe([[...arc(-Math.PI / 2, 0, steps, cap, -length / 2), ...arc(0, Math.PI / 2, steps, cap, length / 2)]], rx, rz, segments);
}

function cylinder(size: [number, number, number], segments: number): MeshData {
  const [w, h, d] = size, y = h / 2;
  // three profiles, each its own vertices: the caps are flat, the wall is smooth
  return lathe([
    [{ rho: 0, y: -y, dr: 1, dy: 0 }, { rho: 1, y: -y, dr: 1, dy: 0 }],
    [{ rho: 1, y: -y, dr: 0, dy: 1 }, { rho: 1, y, dr: 0, dy: 1 }],
    [{ rho: 1, y, dr: -1, dy: 0 }, { rho: 0, y, dr: -1, dy: 0 }],
  ], w / 2, d / 2, segments);
}

/** a ring lying in the x–y plane, the tube as thick as the depth allows while the ring keeps its hole; every vertex belongs to the ring once, so the surface is closed */
function torus(size: [number, number, number], segments: number): MeshData {
  const [w, h, d] = size, tube = Math.min(d / 2, Math.min(w, h) * 0.22), rx = w / 2 - tube, ry = h / 2 - tube;
  const rings = Math.max(8, segments * 2), sides = Math.max(6, segments);
  const b = new Builder();
  for (let i = 0; i < rings; i++) {
    const th = (i / rings) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
    for (let j = 0; j < sides; j++) {
      const ph = (j / sides) * Math.PI * 2, cp = Math.cos(ph), sp = Math.sin(ph);
      const ox = rx + tube * cp, oy = ry + tube * cp;
      const du = [-ox * st, oy * ct, 0], dv = [-tube * sp * ct, -tube * sp * st, tube * cp];
      b.vertex([ox * ct, oy * st, tube * sp], [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]);
    }
  }
  // rows run round the ring, columns round the tube, both closing on themselves
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b2 = ((i + 1) % rings) * sides + j, c = i * sides + ((j + 1) % sides), d2 = ((i + 1) % rings) * sides + ((j + 1) % sides);
    b.indices.push(a, b2, c, b2, d2, c);
  }
  return b.done();
}

/** the mesh of a solid of this size */
export function mesh(shape: SolidShape, o: MeshOptions): MeshData {
  const size = o.size.map((s) => Math.max(1e-3, Math.abs(s))) as [number, number, number];
  const segments = Math.max(4, Math.min(96, Math.round(o.segments ?? 24)));
  switch (shape) {
    case 'box': return box(size, o.radius ?? 0, segments);
    case 'slab': return box(size, o.radius ?? Math.min(size[2] / 2, Math.min(size[0], size[1]) * 0.06), segments);
    case 'sphere': return sphere(size, segments);
    case 'torus': return torus(size, segments);
    case 'capsule': return capsule(size, segments);
    case 'cylinder': return cylinder(size, segments);
    default: throw new Error(`unknown solid: ${shape}`);
  }
}
