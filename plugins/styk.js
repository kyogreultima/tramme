// Stick figures: Pivot and StykAnimate-style characters, brought into tramme.
// A figure is a tree of segments with fixed lengths (a rig, like a .stk figure
// type); a pose gives each segment an angle relative to its parent, so a
// keyframed pose animates frame by frame as in Pivot, an expression can drive
// the angles (a walk, a wave), and a pose entry may also drag a hand or foot
// with two-bone IK or stretch a limb. Everything is a pure function of the
// props: the same rig and time always draw the same figure. The styk-figure
// tool lays one in the composition; the styk-figure check says when a pose
// names a segment the figure does not have, or a target the limb cannot reach.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** the world angle a root segment hangs from: straight up */
const ROOT = -Math.PI / 2;
const DEFAULT_COLOR = '#16161a';

const isFinite_ = Number.isFinite;
const round1 = (v) => Math.round(v * 10) / 10;

// ── the rigs ─────────────────────────────────────────────────
// Angles are degrees, relative to the parent's direction; a root segment's 0
// points up. 0 continues the parent, positive turns clockwise on screen. A
// circle draws a disc of its length as diameter along the bone. `bend` (on a
// chain end) picks which side the elbow or knee points to when the segment
// carries an IK target (+1: the left of the chain's direction, −1: the right).

/** the man in blue, after StykAnimate's "Blue": ten segments, four two-bone chains */
export const MAN = {
  segments: [
    { id: 'torso', parent: null, length: 88, angle: 0, thickness: 14, kind: 'line' },
    { id: 'head', parent: 'torso', length: 56, angle: 0, thickness: 6, kind: 'circle' },
    { id: 'armL1', parent: 'torso', length: 52, angle: -160, thickness: 10 },
    { id: 'armL2', parent: 'armL1', length: 52, angle: 0, thickness: 10, bend: 1 },
    { id: 'armR1', parent: 'torso', length: 52, angle: 160, thickness: 10 },
    { id: 'armR2', parent: 'armR1', length: 52, angle: 0, thickness: 10, bend: 1 },
    { id: 'legL1', parent: null, length: 62, angle: -165, thickness: 12 },
    { id: 'legL2', parent: 'legL1', length: 62, angle: 0, thickness: 12, bend: -1 },
    { id: 'legR1', parent: null, length: 62, angle: 165, thickness: 12 },
    { id: 'legR2', parent: 'legR1', length: 62, angle: 0, thickness: 12, bend: -1 },
  ].map((s) => ({ ...s, color: '#0d99ff' })),
};

/** the plain black one, after Pivot's default man */
export const SIMPLE = {
  segments: [
    { id: 'torso', parent: null, length: 64, angle: 0, thickness: 8, color: '#1c1917' },
    { id: 'head', parent: 'torso', length: 44, angle: 0, thickness: 5, kind: 'circle', color: '#1c1917' },
    { id: 'armL1', parent: 'torso', length: 40, angle: -165, thickness: 6, color: '#1c1917' },
    { id: 'armL2', parent: 'armL1', length: 40, angle: 0, thickness: 6, bend: 1, color: '#1c1917' },
    { id: 'armR1', parent: 'torso', length: 40, angle: 165, thickness: 6, color: '#1c1917' },
    { id: 'armR2', parent: 'armR1', length: 40, angle: 0, thickness: 6, bend: 1, color: '#1c1917' },
    { id: 'legL1', parent: null, length: 48, angle: -165, thickness: 7, color: '#1c1917' },
    { id: 'legL2', parent: 'legL1', length: 48, angle: 0, thickness: 7, bend: -1, color: '#1c1917' },
    { id: 'legR1', parent: null, length: 48, angle: 165, thickness: 7, color: '#1c1917' },
    { id: 'legR2', parent: 'legR1', length: 48, angle: 0, thickness: 7, bend: -1, color: '#1c1917' },
  ],
};

const RIGS = { man: MAN, simple: SIMPLE, walker: MAN };

// ── the walk cycle ───────────────────────────────────────────
// Eight poses on the beat (contact, down, pass, high, and the other leg),
// held key to key like Pivot draws them, one second to a stride. Angles are
// [legR1, legR2, legL1, legL2, armL1, armL2, armR1, armR2], the figure
// walking towards the right.

const WALK = [
  [145, 20, -155, -15, 125, -10, -145, 10],
  [165, 15, -150, 5, 110, -5, -135, 5],
  [180, -25, -175, 0, 170, -10, -170, 5],
  [160, -50, -170, 0, -145, -10, 145, 10],
  [-155, -15, 145, 20, -145, 10, 125, -10],
  [-150, 5, 165, 15, -135, 5, 110, -5],
  [-175, 0, 180, -25, -170, 5, 170, -10],
  [-170, 0, 160, -50, 145, 10, -145, -10],
];
const WALK_IDS = ['legR1', 'legR2', 'legL1', 'legL2', 'armL1', 'armL2', 'armR1', 'armR2'];
const WALK_STEP = 0.125;

/** the walk cycle as a keyframed pose (json keys hold, Pivot-style) */
export function walkPose(cycles = 1) {
  const keys = [];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i <= WALK.length; i++) {
      const pose = WALK[i % WALK.length];
      const v = {};
      WALK_IDS.forEach((id, k) => { v[id] = pose[k]; });
      keys.push({ t: round1((c * WALK.length + i) * WALK_STEP), v, ease: 'hold' });
    }
  }
  return { $k: keys };
}

// ── posing ───────────────────────────────────────────────────
/** what the pose says about one segment: its relative angle, its length, its target */
function poseOf(pose, id, defAngle, defLength) {
  let rel = isFinite_(defAngle) ? defAngle : 0;
  let len = Math.max(0, isFinite_(defLength) ? defLength : 0);
  const pv = pose?.[id];
  let target = null;
  if (typeof pv === 'number' && isFinite_(pv)) rel = pv;
  else if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
    if (Array.isArray(pv.target) && pv.target.length === 2 && isFinite_(pv.target[0]) && isFinite_(pv.target[1])) target = [pv.target[0], pv.target[1]];
    else {
      if (isFinite_(pv.a)) rel = pv.a;
      if (isFinite_(pv.l) && pv.l > 0) len = Math.max(0.05, len * pv.l);
    }
  }
  return { rel: rel * DEG, len, target };
}

/** two-bone IK over [parent, segment]: the world angles of both, the target clamped into reach */
export function ik(sx, sy, l1, l2, target, bend) {
  const dx = target[0] - sx, dy = target[1] - sy;
  const d = Math.hypot(dx, dy);
  const dc = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, d));
  const a1 = Math.atan2(dy, dx);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc)));
  const w1 = a1 - Math.acos(cosA) * (bend === -1 ? -1 : 1);
  const ex = sx + Math.cos(w1) * l1, ey = sy + Math.sin(w1) * l1;
  const tx = sx + (d > 1e-6 ? dx / d : 0) * dc, ty = sy + (d > 1e-6 ? dy / d : 1) * dc;
  const w2 = Math.atan2(ty - ey, tx - ex);
  return { w1, w2, out: d > l1 + l2 + 1e-4 ? 'far' : d < Math.abs(l1 - l2) - 1e-4 ? 'near' : null };
}

/**
 * The figure at its pose: every segment's start and tip, in the layer's
 * space. Segments draw parents first, then their children in the rig's order;
 * a segment whose parent does not exist hangs from the origin instead (the
 * styk-figure check says so), and a cycle of parents is never reached. A
 * target pose on a segment bends the chain [parent, segment]: the parent's
 * own angle follows the solve; a second target on the same chain is followed
 * for its direction only (one target per chain).
 */
export function layoutOf(figure, pose) {
  const segs = Array.isArray(figure?.segments) ? figure.segments.filter((s) => s && typeof s.id === 'string') : [];
  const ids = new Set(segs.map((s) => s.id));
  const children = new Map();
  const roots = [];
  for (const s of segs) {
    if (s.parent && ids.has(s.parent)) {
      if (!children.has(s.parent)) children.set(s.parent, []);
      children.get(s.parent).push(s);
    } else roots.push(s);
  }
  const parts = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  /** a segment at its place: `base` its parent's world angle, `forced` a world the caller already resolved (an IK solve) */
  const body = (s, base, sx, sy, forced) => {
    const { rel, len } = poseOf(pose, s.id, s.angle, s.length);
    let world = forced ?? (base + rel);
    const kids = children.get(s.id) ?? [];
    const ikKid = kids.find((c) => poseOf(pose, c.id, 0, 0).target);
    let note = null;
    if (ikKid) {
      const k = poseOf(pose, ikKid.id, ikKid.angle, ikKid.length);
      const sol = ik(sx, sy, len, k.len, k.target, ikKid.bend);
      world = sol.w1;
      note = { ikKid, w2: sol.w2 };
    }
    const tx = sx + Math.cos(world) * len, ty = sy + Math.sin(world) * len;
    const th = Math.max(0.5, isFinite_(s.thickness) ? s.thickness : 6);
    const r = (s.kind ?? 'line') === 'line' ? th / 2 : len / 2;
    grow(sx - r, sy - r); grow(sx + r, sy + r); grow(tx - r, ty - r); grow(tx + r, ty + r);
    parts.push({ seg: s, sx, sy, tx, ty, len, th, kind: s.kind ?? 'line' });
    for (const c of kids) {
      if (note && c === note.ikKid) body(c, world, tx, ty, note.w2);
      else {
        const ct = poseOf(pose, c.id, 0, 0).target;
        if (ct) body(c, world, tx, ty, Math.atan2(ct[1] - ty, ct[0] - tx)); // direction only: the chain's bend is taken
        else body(c, world, tx, ty);
      }
    }
  };
  for (const s of roots) body(s, ROOT, 0, 0); // a target on a parentless segment is ignored
  return {
    parts,
    box: parts.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null,
    dropped: segs.length - parts.length,
  };
}

// ── the node ─────────────────────────────────────────────────
const colorOf = (p, seg) => (p.color != null ? p.color : (seg.color ?? DEFAULT_COLOR));

const FIGURE_FORMULA = "{ segments: [{ id, parent (id, or null = the figure's origin), length (px), angle (rest, °, relative to the parent; a root's 0 points up), thickness (px), color, kind: 'line' | 'circle' | 'ring', bend: 1 | -1 (which side an IK elbow or knee points to) }] } — a segment's parent comes before it";

const figureNode = {
  type: 'styk.figure', title: 'Stick figure', category: 'Stick figures',
  description: 'a Pivot-style figure of fixed-length segments, posed by joint angles, IK targets or stretch, drawn frame by frame',
  ai: {
    example: { figure: MAN, pose: { torso: 0, armL1: -120, armR1: 150, legR1: 145, legR2: 20 } },
  },
  props: {
    figure: { type: 'json', default: MAN, label: 'Figure', animatable: false, description: `the rig: ${FIGURE_FORMULA}` },
    pose: { type: 'json', default: {}, label: 'Pose', description: '{ segmentId: angle° } — the angle replaces the segment\'s rest angle (relative to its parent, °, positive turns clockwise on screen); or { a: °, l: stretch } for a stretched limb; or { target: [x, y] } for two-bone IK on the chain [parent, segment]. Keyframes hold (frame by frame); an expression may return the whole object' },
    thickness: { type: 'number', default: 1, min: 0.1, step: 0.1, unit: 'x', label: 'Thickness', description: "multiplies every segment's thickness" },
    color: { type: 'paint', default: null, nullable: true, label: 'Colour', description: "one colour for the whole figure, over each segment's own" },
    joints: { type: 'bool', default: false, label: 'Joints', description: 'small dots at the joints, to pose by' },
  },
  bounds(p) { return layoutOf(p.figure, p.pose).box; },
  path(p) {
    const b = layoutOf(p.figure, p.pose).box;
    if (!b) return null;
    const s = new Path2D();
    s.rect(b.x, b.y, b.w, b.h);
    return s;
  },
  render: {
    canvas2d(ctx, p) {
      const { parts } = layoutOf(p.figure, p.pose);
      const mult = p.thickness > 0 ? p.thickness : 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const st of parts) {
        const col = colorOf(p, st.seg);
        const th = Math.max(0.5, st.th * mult);
        if (st.kind === 'circle') {
          if (st.len < 0.2) continue;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc((st.sx + st.tx) / 2, (st.sy + st.ty) / 2, st.len / 2, 0, TAU);
          ctx.fill();
        } else if (st.kind === 'ring') {
          const r = st.len / 2 - th / 2;
          if (r < 0.6) continue;
          ctx.strokeStyle = col;
          ctx.lineWidth = th;
          ctx.beginPath();
          ctx.arc((st.sx + st.tx) / 2, (st.sy + st.ty) / 2, r, 0, TAU);
          ctx.stroke();
        } else {
          ctx.strokeStyle = col;
          ctx.lineWidth = th;
          ctx.beginPath();
          ctx.moveTo(st.sx, st.sy);
          ctx.lineTo(st.tx, st.ty);
          ctx.stroke();
        }
      }
      if (p.joints) {
        const r = 2.5 * mult;
        ctx.fillStyle = colorOf(p, {});
        for (const st of parts) {
          for (const [x, y] of [[st.sx, st.sy], [st.tx, st.ty]]) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
          }
        }
      }
    },
  },
  export: {
    svg(p) {
      const { parts } = layoutOf(p.figure, p.pose);
      const mult = p.thickness > 0 ? p.thickness : 1;
      const col = (seg) => {
        const c = p.color != null ? p.color : (seg.color ?? DEFAULT_COLOR);
        return typeof c === 'string' ? c : DEFAULT_COLOR; // a gradient paints nothing in SVG
      };
      const n = (v) => Math.round(v * 100) / 100;
      return `<g stroke-linecap="round">` + parts.map((st) => {
        const c = col(st.seg), th = n(Math.max(0.5, st.th * mult));
        if (st.kind === 'circle') return `<circle cx="${n((st.sx + st.tx) / 2)}" cy="${n((st.sy + st.ty) / 2)}" r="${n(st.len / 2)}" fill="${c}"/>`;
        if (st.kind === 'ring') return `<circle cx="${n((st.sx + st.tx) / 2)}" cy="${n((st.sy + st.ty) / 2)}" r="${n(st.len / 2 - th / 2)}" fill="none" stroke="${c}" stroke-width="${th}"/>`;
        return `<line x1="${n(st.sx)}" y1="${n(st.sy)}" x2="${n(st.tx)}" y2="${n(st.ty)}" stroke="${c}" stroke-width="${th}"/>`;
      }).join('') + `</g>`;
    },
  },
};

// ── the check ────────────────────────────────────────────────
/** what is wrong with a rig on its own (the check reports it once per layer) */
export function rigProblems(figure) {
  const out = [];
  const segs = Array.isArray(figure?.segments) ? figure.segments : [];
  if (!segs.length) return ['the figure has no segments'];
  const seen = new Map();
  segs.forEach((s, i) => {
    if (!s || typeof s.id !== 'string') { out.push(`segment ${i} has no id`); return; }
    if (seen.has(s.id)) out.push(`two segments are named "${s.id}"`);
    seen.set(s.id, s);
    if (!(s.length > 0)) out.push(`"${s.id}" has no length`);
    if (s.parent && !segs.some((q) => q && q.id === s.parent)) out.push(`"${s.id}" hangs from "${s.parent}", which does not exist`);
  });
  const index = new Map(segs.map((s, i) => [s?.id, i]));
  for (const s of segs) {
    if (!s?.id || !s.parent) continue;
    if ((index.get(s.parent) ?? -1) >= index.get(s.id)) {
      // a parent after its child, or a cycle: walk up to tell which
      let up = s, guard = new Set([s.id]);
      while (up?.parent && index.has(up.parent) && !guard.has(up.parent)) { guard.add(up.parent); up = seen.get(up.parent); }
      out.push(guard.has(up?.parent) ? `"${s.parent}" and "${s.id}" are in a cycle` : `"${s.id}" comes before its parent "${s.parent}" — move the parent first`);
    }
  }
  return out;
}

const poseCheck = {
  name: 'styk-figure', title: 'Stick figure poses',
  description: 'a pose naming a segment the figure does not have moves nothing, and a target the limb cannot reach clamps',
  texts: ['{name}: the pose names "{key}", no segment of the figure — nothing moves there', '{name}: "{key}" carries an IK target but hangs from no segment — a target needs a parent to bend', '{name}: {n} segments hang from "{parent}" and carry a target — only the first bends it', '{name}: the target of "{key}" is beyond the limb\'s reach — it clamps to the nearest point', '{name}: {problem}'],
  run(ctx) {
    const out = [];
    const seen = new Map();
    const say = (id, key, message, t) => {
      if (seen.get(id).has(key)) return;
      seen.get(id).add(key);
      out.push({ check: 'styk-figure', severity: 'warning', message, t, layers: [id] });
    };
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        if (placed.node.type !== 'styk.figure') continue;
        if (!seen.has(placed.id)) seen.set(placed.id, new Set());
        const name = placed.layer.name ?? placed.id;
        const figure = placed.props.figure, pose = placed.props.pose;
        for (const problem of rigProblems(figure)) say(placed.id, `rig:${problem}`, `${name}: ${problem}`, sample.t);
        const segs = Array.isArray(figure?.segments) ? figure.segments : [];
        const byId = new Map(segs.map((s) => [s?.id, s]));
        const partOf = new Map(layoutOf(figure, pose).parts.map((st) => [st.seg.id, st]));
        const perParent = new Map();
        for (const [key, v] of Object.entries(pose ?? {})) {
          if (!byId.has(key)) { say(placed.id, `key:${key}`, `${name}: the pose names "${key}", no segment of the figure — nothing moves there`, sample.t); continue; }
          if (!(v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.target))) continue;
          const seg = byId.get(key);
          if (!seg?.parent) { say(placed.id, `orphan:${key}`, `${name}: "${key}" carries an IK target but hangs from no segment — a target needs a parent to bend`, sample.t); continue; }
          const n = (perParent.get(seg.parent) ?? 0) + 1;
          perParent.set(seg.parent, n);
          if (n > 1) say(placed.id, `chain:${seg.parent}`, `${name}: ${n} segments hang from "${seg.parent}" and carry a target — only the first bends it`, sample.t);
          const pp = partOf.get(seg.parent), cp = partOf.get(key);
          if (pp && cp) {
            const d = Math.hypot(v.target[0] - pp.sx, v.target[1] - pp.sy);
            const reach = pp.len + cp.len;
            if (d > reach + 1) say(placed.id, `far:${key}`, `${name}: the target of "${key}" is ${Math.round(d)} px away but the limb reaches ${Math.round(reach)} px — it clamps to the nearest point`, sample.t);
          }
        }
      }
    }
    return out;
  },
};

// ── the tool ─────────────────────────────────────────────────
const figureTool = {
  name: 'styk-figure', title: 'Stick figure',
  description: 'adds a Pivot-style stick figure layer: the blue man or the plain black one, or the man already walking (a 1 s walk cycle keyframed pose by pose), at a scale and a colour',
  input: {
    properties: {
      figure: { type: 'string', enum: ['man', 'simple', 'walker'], description: 'man: the blue figure; simple: black and thin; walker: the man with the walk cycle already keyed' },
      scale: { type: 'number', minimum: 0.1, description: 'scales the whole figure, 1 = about 270 px tall' },
      color: { type: 'string', description: "one CSS colour for the whole figure, over the rig's own" },
      at: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] of the hip in the composition; default: centred, at 55% of the height' },
      name: { type: 'string', description: 'the layer\'s name' },
    },
    required: ['figure'],
    additionalProperties: false,
  },
  run(input, ctx) {
    const comp = ctx.doc.compositions?.[ctx.compId];
    const c = { width: comp?.width ?? 1920, height: comp?.height ?? 1080 };
    const at = Array.isArray(input.at) && input.at.length === 2 && input.at.every(isFinite_) ? input.at : [Math.round(c.width / 2), Math.round(c.height * 0.55)];
    const scale = input.scale > 0 ? input.scale : 1;
    const layers = comp?.layers ?? {};
    let n = 1;
    while (layers[`styk${n}`]) n++;
    const id = `styk${n}`;
    const props = { figure: RIGS[input.figure] ?? MAN };
    if (input.figure === 'walker') props.pose = walkPose();
    if (typeof input.color === 'string' && input.color) props.color = input.color;
    const ops = [{ op: 'add', path: `/compositions/${ctx.compId}/layers/${id}`, value: { type: 'styk.figure', name: input.name ?? 'Stick figure', transform: { position: [Math.round(at[0]), Math.round(at[1])], scale: [scale, scale] }, props } }];
    const ops2 = [...ops, { op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: id }];
    return {
      ops: ops2, label: input.name ?? 'Stick figure',
      text: `A ${input.figure} stick figure at (${Math.round(at[0])}, ${Math.round(at[1])})${scale !== 1 ? `, scaled ×${scale}` : ''}. Its hip is the layer's origin. Pose it in the pose property: { segmentId: angle° } per segment (torso, head, armL1, armL2, armR1, armR2, legL1, legL2, legR1, legR2), keyframes hold frame by frame${input.figure === 'walker' ? '; the walk is keyed over 1 s — the layer loops by keyframing the pose again' : ''}, or { target: [x, y] } to bring a hand or a foot there with two-bone IK. The figure walks towards the right.`,
    };
  },
};

// ── the presets ──────────────────────────────────────────────
const presets = [
  { name: 'styk-man', title: 'Stick figure', category: 'Stick figures', description: 'the man in blue, posed by joint angles', layer: { type: 'styk.figure', name: 'Stick figure', props: { figure: MAN } } },
  { name: 'styk-walker', title: 'Walking figure', category: 'Stick figures', description: 'the man with a 1 s walk cycle, pose by pose', layer: { type: 'styk.figure', name: 'Walker', props: { figure: MAN, pose: walkPose() } } },
  { name: 'styk-simple', title: 'Simple figure', category: 'Stick figures', description: 'the plain black one, after Pivot', layer: { type: 'styk.figure', name: 'Stick figure', props: { figure: SIMPLE } } },
];

export const meta = { id: 'tramme/styk', name: 'Stick figures', version: '1.0.0', description: 'Pivot-style stick figures: fixed-length segments posed by joint angles, two-bone IK or stretch, a walk cycle, a figure tool and a pose check', api: 1 };
export const nodes = [figureNode];
export const tools = [figureTool];
export const checks = [poseCheck];
export { presets };
export const messages = {
  fr: {
    'Stick figure': 'Silhouette', 'Stick figures': 'Silhouettes', 'Walking figure': 'Marcheur', 'Simple figure': 'Silhouette simple',
    'Figure': 'Corps', 'Pose': 'Pose', 'Thickness': 'Épaisseur', 'Colour': 'Couleur', 'Joints': 'Articulations',
    'the man in blue, posed by joint angles': 'l\'homme en bleu, posé par angles d\'articulations',
    'the man with a 1 s walk cycle, pose by pose': 'l\'homme avec un pas d\'1 s, pose par pose',
    'the plain black one, after Pivot': 'le noir et fin, à la Pivot',
    'a Pivot-style figure of fixed-length segments, posed by joint angles, IK targets or stretch, drawn frame by frame': 'une silhouette à la Pivot, en segments de longueur fixe, posée par angles, cibles IK ou étirement, dessinée image par image',
    'multiplies every segment\'s thickness': 'multiplie l\'épaisseur de chaque segment',
    "one colour for the whole figure, over each segment's own": 'une couleur pour toute la silhouette, à la place de celle de chaque segment',
    'small dots at the joints, to pose by': 'des points aux articulations, pour poser',
    'Stick figure poses': 'Poses des silhouettes',

    'the rig: { segments: [{ id, parent (id, or null = the figure\'s origin), length (px), angle (rest, °, relative to the parent; a root\'s 0 points up), thickness (px), color, kind: \'line\' | \'circle\' | \'ring\', bend: 1 | -1 (which side an IK elbow or knee points to) }] } — a segment\'s parent comes before it': 'le corps : { segments : [{ id, parent (id, ou null = l\'origine de la silhouette), length (px), angle (au repos, °, relatif au parent ; le 0 d\'une racine pointe vers le haut), thickness (px), color, kind : \'line\' | \'circle\' | \'ring\', bend : 1 | -1 (le côté où pointe un coude ou un genou IK) }] } — le parent d\'un segment vient avant lui',
    '{ segmentId: angle° } — the angle replaces the segment\'s rest angle (relative to its parent, °, positive turns clockwise on screen); or { a: °, l: stretch } for a stretched limb; or { target: [x, y] } for two-bone IK on the chain [parent, segment]. Keyframes hold (frame by frame); an expression may return the whole object': '{ segmentId : angle° } — l\'angle remplace l\'angle au repos du segment (relatif à son parent, °, le positif tourne horaire à l\'écran) ; ou { a : °, l : étirement } pour un membre étiré ; ou { target : [x, y] } pour une IK à deux os sur la chaîne [parent, segment]. Les keyframes se tiennent (image par image) ; une expression peut renvoyer l\'objet entier',
    'adds a Pivot-style stick figure layer: the blue man or the plain black one, or the man already walking (a 1 s walk cycle keyframed pose by pose), at a scale and a colour': 'ajoute un calque de silhouette à la Pivot : l\'homme en bleu ou le noir et fin, ou l\'homme déjà en marche (un pas d\'1 s, posé keyframe par keyframe), à une échelle et une couleur',
    'a pose naming a segment the figure does not have moves nothing, and a target the limb cannot reach clamps': 'une pose qui nomme un segment que la figure n\'a pas ne bouge rien, et une cible que le membre ne peut pas atteindre se cale',
  },
};
