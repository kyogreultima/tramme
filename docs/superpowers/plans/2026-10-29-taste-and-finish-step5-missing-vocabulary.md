# Taste and finish, step 5: the missing vocabulary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** What both measured cases needed and nothing gave, written at the level of meaning so a scene costs few operations:
- layers tilted in perspective, and a picture pinned on four corners;
- a camera that pushes onto a detail and back, with the framing kept readable;
- interface pieces (rows, plan cards, a cart, a level ring, bars, badges, toasts, toggles, buttons, tables) that sit in the device frame;
- simple 3D solids with glossy, glass and metal materials lit by an environment;
- candlesticks and price lines;
- a comparison of a render with a picture, the critic's tool against the style frame.

**Architecture:**
- **Core:** the transform gains `rotationX` and `rotationY`. A pure `perspective.ts` gives a layer's projected quad and the homography between two quads.
- **Render:** a layer that is tilted, or carries `fx.pin`, is drawn alone, then warped onto its quad by one WebGL pass in `gpu.ts`.
- **Push-in:** a tool keys the composition camera from a layer's evaluated bounds.
- **Interface pieces:** a new shipped pack `plugins/interface.js`, whose `screen` tool fills the content group that `device-screen` (walkthrough pack) lays.
- **Solids:** a node `solid.3d` in `@tramme/nodes` that shares a GL kit extracted from `model.ts`, with mesh generators that are pure functions.
- **Finance charts:** two nodes added to the Charts pack.
- **Comparison:** the PSNR and difference code of `packages/cli/src/compare.ts`, the colour clustering and the busy grid of `apps/editor/src/perception.ts` move to `@tramme/core`, where a `likeness` score uses them. An editor tool `compare` draws the render and the target side by side with their difference and the scores.

**Tech Stack:** TypeScript (Node 24, vitest), `@tramme/core`, `@tramme/render` (Canvas 2D, WebGL2), `@tramme/nodes`, shipped packs (`plugins/*.js`, plain ES modules with `meta`, `nodes`, `tools`, `messages`), `scripts/packs`.

**Spec:** [docs/superpowers/specs/2026-10-29-taste-and-finish-design.md](../specs/2026-10-29-taste-and-finish-design.md), section "5. The missing vocabulary". It builds on step 1 (`device-screen`, `screenOf` in `plugins/walkthrough.js`), step 3 (the film plan's `target`) and step 4 (Poly Haven environments: image assets whose record has `env: true`).

## Global Constraints

- Rendering stays a pure function of time: no state carried between frames, no random without a seed prop.
- One mechanism: every capability is a node, an effect or a tool of the vocabulary. Packs follow `docs/packs.md` (notes `ai.when` / `ai.avoid` per entry, `messages` in en and fr, `meta.version` bumped when an existing pack changes). After a pack changes, `npm run packs:index`, and `node scripts/packs/index.ts --check` must pass.
- A document written before this step renders exactly as before: `rotationX`/`rotationY` default to 0, and a layer at 0 takes today's drawing path untouched (no offscreen, no GL pass).
- Text is never drawn into a picture that ships. Interface pieces draw their text with the engine's text path and the document's font assets, so it stays editable through props.
- Sizes follow the format. A piece is sized from the screen it sits in (the content group's width) or from the composition's shorter side, never from a fixed 1920.
- New user-visible strings go through `t()` (en and fr, French in "vous"); pack strings go in the pack's `messages`; no em dash in user-visible text.
- Shared modules, no copies. Packs cannot import each other or `@tramme/core`: a pack reads the size of the device's screen from the document, it never copies `screenOf`. Audit your diff for duplication before handing over.
- Nothing tuned on one video; the test briefs stay unseen; dev runs on the trial server (port 8790), a quota-spending run waits for the user's go.
- Commits carry no Claude attribution; one commit per task. Use Edit or Write for code holding backslashes (GLSL included).

## Review Focus

- A tilted layer at exactly 90° (edge on), or past it (its back): nothing drawn at 90°. Past it, the mirrored back is drawn, never a degenerate quad, NaN or a crash. A tilted layer under a camera whose perspective is short enough that a corner falls behind the eye: not drawn, as `drawThroughCamera` does for a layer behind the eye.
- A tilted group: its children are flattened into it and warped together (documented). A tilted layer inside a tilted group composes both tilts in order.
- Selection and checks on a tilted layer use its projected quad: the bounding box drawn in the viewport, the off-frame check, the small-text check (text tilted 70° reads smaller).
- `push-in` on a layer that is off frame, hidden at that time, or larger than the frame: it says so and proposes nothing. On a composition with no camera, it adds one at the defaults, so nothing moves before the push.
- `screen` on a content group that is not one (`into` naming a plain group), or with more pieces than fit the screen: an error naming the group, or a text saying how many pieces were left out and the height they needed. Nothing is drawn past the clip.
- `compare` between a 16:9 render and a 9:16 target: the target is fitted to cover, and the text says the proportions differ.

---

### Task 1: Rotation around x and y, in core

**Files:**
- Create: `packages/core/src/perspective.ts`
- Modify: `packages/core/src/registry.ts` (`TRANSFORM_SCHEMA`: `rotationX`, `rotationY`, number, default 0, unit `deg`, labels `Tilt X` / `Tilt Y`, description `turns the layer around its horizontal (X) or vertical (Y) axis through its anchor, seen from the composition camera's perspective (1000 px without a camera)`), `packages/core/src/schema.ts` (line 40, the two props), `packages/core/src/evaluate.ts` (`EvaluatedTransform` gains `rotationX: number; rotationY: number`), `packages/core/src/index.ts` (exports), `packages/core/src/checks.ts` (the bounds a check reads come from `layerQuad` when a layer is tilted)
- Test: `packages/core/test/perspective.test.ts`, `packages/core/test/checks.test.ts`

**Interfaces:**
- Produces:
  - `type Quad = [Vec2, Vec2, Vec2, Vec2]` (top left, top right, bottom right, bottom left)
  - `isTilted(t: { rotationX?: number; rotationY?: number }): boolean` (an absolute angle above 0.01°)
  - `tiltQuad(box: Box, t: EvaluatedTransform, parent: Mat2D, perspective: number): Quad | null`. The layer's local box is turned around its anchor by `rotationX` then `rotationY`, projected at distance `perspective` around the layer's own position, then through its 2D scale, rotation and position and the parent matrix. The result is null when a corner sits at or behind the eye (`perspective + z <= 1`).
  - `homography(from: Quad, to: Quad): number[]` (9 numbers, row major; throws on a degenerate quad)
  - `applyHomography(h: number[], p: Vec2): Vec2`
  - `invertHomography(h: number[]): number[]`
  - `layerQuad(L: EvaluatedLayer, box: Box, parent: Mat2D, perspective: number): Quad` (the projected quad when tilted, else the box through the 2D matrix)
- [ ] **Step 1: Write the failing tests**:
  - `tiltQuad` of a 200×100 box with no tilt equals the box through `layerMatrix`.
  - `rotationY: 60` at perspective 1000 gives a quad whose width is less than half the box's and whose left and right edges differ in height (foreshortening), with its centre unchanged.
  - `rotationX: 180` mirrors top and bottom. `rotationY: 90` gives a quad of width under 1e-6.
  - With a corner behind the eye (perspective 50, `rotationX: 80` on a tall box) the result is null.
  - `homography` of a unit square onto itself is the identity within 1e-9, and maps four corners onto four target corners within 1e-6. A quad with three collinear corners throws.
  - `validate` accepts a layer with `rotationX` keyframed. An old document without the props evaluates `rotationX` to 0.
  - In `checks.test.ts`: a text of 60 px tilted by `rotationX: 70` is reported by the small-text check as an older one at about 20 px would be. A tilted layer whose quad leaves the frame is reported off frame.
- [ ] **Step 2: Run** `npx vitest run packages/core/test/perspective.test.ts packages/core/test/checks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Run** `npx vitest run packages/core`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): layers turned around x and y, their quad and the homography between quads`

### Task 2: Drawing a warped layer, and the corner pin

**Files:**
- Modify:
  - `packages/render/src/gpu.ts` (`warpQuad`);
  - `packages/render/src/canvas2d.ts` (`drawLayer`: a tilted or pinned layer is drawn alone into a pooled offscreen, as an effect's layer is, then warped);
  - `packages/nodes/src/effects.ts` (`fx.pin`: stage `layer`, props `tl`, `tr`, `br`, `bl` vec2 in composition pixels, default `[0, 0]` each; all four equal means "not set" and draws the layer as it is. It has no filter and no GLSL: `canvas2d.ts` reads it);
  - `apps/editor/src/ui/Viewport.tsx` (the selection outline of a tilted or pinned layer is its quad);
  - `packages/interop/src/lottie.ts` and `svg.ts` (a tilted or pinned layer is exported flat, and the export's warnings name it).

  The inspector needs no change: it lists `TRANSFORM_SCHEMA`.
- Create: `apps/editor/src/pin.ts` (tool `pin`)
- Test: `packages/render/test/warp.test.ts`, `apps/editor/test/pin.test.ts`, `packages/interop/test/interop.test.ts` (one tilted layer added), `packages/cli/test/render-effects.test.ts` (a tilted and a pinned layer rendered through the page, in the way its effects are)

**Interfaces:**
- Consumes: `tiltQuad`, `homography`, `invertHomography`, `isTilted` (Task 1).
- Produces:
  - `warpQuad(ctx: CanvasRenderingContext2D, source: CanvasImageSource, from: Quad, to: Quad, scale: number): void`. One pass on the shared WebGL2 canvas: for each pixel of the `to` quad's bounding box, the inverse homography gives the source pixel, sampled bilinear with premultiplied alpha. The pass's bounding box is drawn into `ctx`.
  - tool `pin` with input `{ layer: string; corners?: [Vec2, Vec2, Vec2, Vec2]; onto?: string; from?: number; to?: number }`. `corners` sets static corners. `onto` samples another layer's `layerQuad` every 1/10 s from `from` to `to` (its in and out by default) and keys the four corners with linear eases, so the picture rides that layer.
- [ ] **Step 1: Write the failing tests**:
  - `warpQuad` math, tested through its exported pure helper `warpBox(to: Quad, scale): { x; y; w; h }`, gives the integer box covering the quad.
  - The GL path is exercised in Step 4 through the CLI.
  - `pin { layer: 'shot', corners: [[100,100],[500,120],[480,400],[90,380]] }` proposes one `fx.pin` with those corners. `onto: 'card'` over 1 s proposes 11 keys per corner whose first values equal `layerQuad` of the card at its in point. Pinning a layer onto itself is an error.
  - The Lottie export of a document with a tilted layer warns `drawn flat` and names the layer.
- [ ] **Step 2: Run** `npx vitest run packages/render/test/warp.test.ts apps/editor/test/pin.test.ts packages/interop`. Expected: FAIL.
- [ ] **Step 3: Implement** it. A layer at 0 tilt with no pin takes today's path, byte for byte.
- [ ] **Step 4: Run** the tests, then the equivalence check by hand, with a scratchpad script writing three documents:
  - (a) an image card with `rotationY: 0`, rendered with `node packages/cli/src/main.ts still` before and after this task: `node packages/cli/src/main.ts compare a.png b.png` gives PSNR `Infinity`;
  - (b) `rotationY: 35` under a camera with perspective 800, and (c) a pinned picture: judged by eye, saved in the PR.

  Expected: (a) identical, (b) foreshortened with straight edges, (c) the picture's corners on the four points.
- [ ] **Step 5: Commit** `feat(render): layers drawn in perspective, and a picture pinned on four corners`

### Task 3: A push onto a detail

**Files:**
- Create: `apps/editor/src/camera.ts` (tool `push-in`)
- Modify: `apps/editor/src/vocabulary.ts`, `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/camera.test.ts`

**Interfaces:**
- Produces:
  - `pushFraming(target: Box, frame: { width: number; height: number }, o: { fill: number; minText?: number; maxZoom?: number }): { zoom: number; pan: Vec2 } | null`, a pure function:
    - zoom so the target fills `fill` of the frame on its limiting side (default 0.6), clamped to 1.1 to `maxZoom` (default 3);
    - raised so the smallest text height inside reaches `minText` px when given (at most 5 % of the frame's height);
    - the pan centres the target and is clamped so the frame never leaves the composition;
    - null when the target is outside the frame or larger than it at zoom 1.
  - tool `push-in` with input `{ layer: string; at: number; hold?: number; back?: boolean; fill?: number }`. It keys `camera.zoom` and `camera.pan` from the camera's value at `at` to the framing:
    - the push lasts `max(0.5, (zoom - 1) / 1.5)` s, the 1.5× a second the screencast pack reads at (`plugins/screencast.js`, `zoomKeys`);
    - eased with `@out` when the document has that token, else `[0.16, 1, 0.3, 1]`;
    - held `hold` s (default 1.2), then back over the same time with `@in` when `back` (default true);
    - a composition with no camera gets one at the defaults first.
- [ ] **Step 1: Write the failing tests**:
  - `pushFraming` of a 200×100 box at the centre of 1920×1080 with `fill: 0.6` gives zoom `0.6 * 1080 / 100` clamped to 3, and pan `[0, 0]`.
  - A box at the right edge gives a pan clamped so the right edge of the frame stays at the composition's.
  - `minText: 40` with the smallest text at 12 px raises the zoom to at least `40/12` when under `maxZoom`.
  - A box off frame gives null.
  - The tool on a document without a camera proposes the camera and four zoom keys (from, in, hold end, back) at the right times and with the eases given.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/camera.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it, with the target's box read from `Evaluator` at `at` (its `layerQuad`'s bounding box when tilted) and the smallest text inside it from the evaluated text layers. Write the `ai.when`: the detail that matters in a built scene (a price, a button, a figure) brought close, then back. Write the `ai.avoid`: a push on every scene; a push on footage (the screencast pack's zooms do it for a recording).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(camera): a push onto a detail and back, the framing kept readable`

### Task 4: Interface pieces

**Files:**
- Create: `plugins/interface.js` (pack `tramme/interface`, version `1.0.0`)
- Modify: `plugins/index.json` and `docs/packs.md` (regenerated), `docs/packs-roadmap.md` (the pack listed)
- Test: `apps/editor/test/packs.test.ts` (a new `describe('interface pieces')`)

**Interfaces:**
- Consumes: the `device-screen` tool's output (step 1): a group named `<name> · content` whose `clip` is a hidden `shape.rect` named `<name> · screen`, its `size` the screen's.
- Produces:
  - Nodes, all with `theme: 'light' | 'dark'`, `accent` (colour, default `#2E6BFF`), `font` (font asset), `width` (px), and `scale` (0.5 to 2, default 1):
    - `ui.row`: `text`, `sub`, `done`, `trailing`, `check: 'none' | 'box' | 'circle'`;
    - `ui.plan`: `title`, `price`, `period`, `features: string[]`, `badge`, `highlight: bool`;
    - `ui.cart`: `items: { name, qty, price }[]`, `currency`, `discount`, `total` (computed unless set);
    - `ui.ring`: `value` (0 to 1), `label`, `centre`;
    - `ui.bar`: `value`, `label`, `trailing`;
    - `ui.badge`: `text`, `tone: 'accent' | 'neutral' | 'success' | 'warning'`;
    - `ui.toast`: `icon` (a Lucide name, drawn from the Icons pack's data when present, else a dot), `title`, `text`;
    - `ui.toggle`: `on`, `label`;
    - `ui.button`: `label`, `state: 'idle' | 'hover' | 'pressed' | 'disabled' | 'loading'`, `kind: 'primary' | 'secondary' | 'ghost'`;
    - `ui.table`: `rows: { avatar?: string (initials or an image asset), name, value, sub? }[]`, `header: string[]`.
  - Each node's `bounds` gives its height for its width, so pieces stack without overlap.
  - A pure `layoutPieces(pieces: { piece: string; props: object }[], width: number, gap: number): { y: number; h: number }[]` (exported).
  - Tool `screen` with input `{ into: string; theme?: 'light' | 'dark'; title?: string; pieces: { piece: 'row' | 'plan' | 'cart' | 'ring' | 'bar' | 'badge' | 'toast' | 'toggle' | 'button' | 'table'; props?: object; at?: number }[]; gap?: number }`. It reads the screen's size from the document, stacks the pieces (a title first when given) from the top inset with `layoutPieces`, and gives each its entrance offset `at` (default a 40 to 60 ms uneven stagger).
- [ ] **Step 1: Write the failing tests**:
  - Every node draws on a recording context without throwing, at both themes.
  - `ui.row` with `done: true` draws a check mark.
  - The `bounds` height of `ui.plan` grows with `features.length`.
  - `ui.cart` without `total` shows the sum of `qty * price` with its currency formatted (`120 €` for `fr` text, `€120` for `en`, from `Intl.NumberFormat` with the document's language when known).
  - `layoutPieces` of three pieces of heights 80, 120, 60 with gap 16 gives y `0, 96, 232`.
  - `screen` into the content group made by `device-screen` on a 1080×1920 composition proposes one layer per piece inside that group, each `width` the screen's minus two insets.
  - `screen` with pieces past the screen's height leaves them out and says how many and the height needed. `into` naming a group that is not a content group is an error naming it.
  - The pack's index lines exist (`node scripts/packs/index.ts --check`).
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/packs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pack, in the shipped packs' voice. Its look is neutral and modern, with the radius, spacing and type scale taken from `width` (8 pt grid scaled), so it reads in a phone at 1080 wide. The accent is the only colour; light and dark are true palettes, not inverted.

  Notes:
  - `ai.when` per node, by need: "a to-do row with a checkbox", "a price or plan card", and so on;
  - the tool's `ai.when`: an interface built in layers in a phone or a browser, after `device-screen`: a screen is one `screen` call;
  - `ai.avoid`: drawing interface pieces by hand with rectangles and texts.
- [ ] **Step 4: Run** `npm run packs:index`, the tests and `node scripts/packs/index.ts --check`. Expected: PASS. Render one screen of each theme with the CLI and look at it.
- [ ] **Step 5: Commit** `feat(packs): interface pieces, a screen in a few parameters`

### Task 5: 3D solids with materials and an environment

**Files:**
- Create: `packages/nodes/src/gl3d.ts` (the mat4 kit, the mesh upload, the lit program with environment), `packages/nodes/src/solids.ts` (mesh generators), `packages/nodes/src/solid.ts` (node `solid.3d`)
- Modify: `packages/nodes/src/model.ts` (uses `gl3d.ts`; its look unchanged when no `env` is set, and it gains `env` like the solid), `packages/nodes/src/index.ts` (registers `solid.3d`), `apps/editor/src/forms.ts` (step 3: `solid.3d` is `3d`, already listed there)
- Test: `packages/nodes/test/solids.test.ts`, `packages/nodes/test/gltf.test.ts` (unchanged and passing)

**Interfaces:**
- Produces:
  - `mesh(shape: 'box' | 'slab' | 'sphere' | 'torus' | 'capsule' | 'cylinder', o: { size: [number, number, number]; radius?: number; segments?: number }): { positions: Float32Array; normals: Float32Array; indices: Uint32Array }`
  - node `solid.3d` with props:
    - `shape` (as above), `size` (vec3 as `json` `[w, h, d]` in px), `radius` (the rounding of a box or slab, px);
    - `material: 'matte' | 'glossy' | 'glass' | 'metal'`, `color`, `roughness` (0 to 1);
    - `env` (an image asset, an equirectangular picture; empty: a built-in studio gradient from the two colours `envTop`/`envBottom`);
    - `yaw`, `pitch`, `spin` (as `model.3d`);
    - `height` (the square frame, px).
  - Rendering: GGX specular with Schlick Fresnel and the environment sampled by the reflected direction (mip bias from roughness). Glass is a thin transmissive surface: the environment refracted through it, tinted by `color`, its Fresnel edge bright. Metal takes `color` as specular.
- [ ] **Step 1: Write the failing tests** for the generators:
  - a box of `[100, 50, 20]` has 24 vertices with unit normals and 36 indices, and its positions' bounds are the size;
  - a sphere of 16 segments has unit normals pointing away from the centre;
  - a torus is closed (every edge shared by two triangles);
  - a slab with `radius: 8` stays within its size.
  - `solid.3d`'s `bounds` are the `height` square.
- [ ] **Step 2: Run** `npx vitest run packages/nodes/test/solids.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the generators, then extract `gl3d.ts` from `model.ts` (no change in what `model.3d` draws without `env`), then the node.
- [ ] **Step 4: Run** `npx vitest run packages/nodes`, then render with the CLI one of each material under the studio gradient and under a Poly Haven environment kept with step 4's `stock`. Look at them, then check that `model.3d` stills of an existing project compare at PSNR `Infinity` with their renders before the extraction.
- [ ] **Step 5: Commit** `feat(nodes): 3D solids, glossy, glass and metal, lit by an environment`

### Task 6: Candlesticks and price lines

**Files:**
- Modify: `plugins/charts.js` (nodes `chart.candles`, `chart.price`; the `chart` tool gains both kinds; `meta.version` `1.2.0`; `messages`), `plugins/index.json`, `docs/packs.md` (regenerated)
- Test: `apps/editor/test/packs.test.ts`

**Interfaces:**
- Produces:
  - `chart.candles`:
    - `values: { o, h, l, c, label? }[]` (or a data set asset, as the other charts take);
    - `up`, `down` (colours);
    - `drawFor` (s: the candles appear left to right over it);
    - `grid`, `last` (bool: a tag at the last close in its colour, its value written), `size`, `font`.
  - `chart.price`:
    - `values: number[]`, `markers: { at: number (index), label: string }[]`;
    - `area` (a gradient under the line, from the line's colour to transparent);
    - `fill`, `last` (bool), `drawFor`, `size`, `font`.
- [ ] **Step 1: Write the failing tests**:
  - `chart.candles` of three candles draws three bodies and wicks on a recording context, an up candle in `up` and a down one in `down`.
  - At `t = drawFor / 2` only the first half is drawn.
  - The scale holds the lowest low and the highest high.
  - `chart.price` with two markers draws two marker dots and labels at their indices' points. With `last` it writes the last value.
  - The `chart` tool with `kind: 'candles'` lays the node sized for the composition.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** them, in the Charts pack's code style (its `scaleOf` and grid helpers reused).
- [ ] **Step 4: Run** `npm run packs:index` and the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(charts): candlesticks and price lines with markers`

### Task 7: A render compared with a picture

**Files:**
- Create: `packages/core/src/picture.ts` (`pictureDiff`, `dominant`, `busyGrid`, `likeness`, and `toLab(rgb: [number, number, number]): [number, number, number]` with `deltaE(a, b): number` (CIE76), since core has no Lab conversion yet)
- Modify:
  - `packages/cli/src/compare.ts` (calls `pictureDiff`; its output unchanged);
  - `apps/editor/src/perception.ts` (imports `dominant` and `busyGrid` from core; its own copies removed);
  - `apps/editor/src/review.ts` (tool `compare` beside `check` and `motion`; `REVIEW_TOOLS`);
  - `apps/editor/src/i18n/en.json`, `fr.json`.
- Test: `packages/core/test/picture.test.ts`, `apps/editor/test/review.test.ts`, `packages/cli/test/compare.test.ts`

**Interfaces:**
- Produces:
  - `pictureDiff(a: Pixels, b: Pixels, o?: { threshold?: number; diff?: boolean }): Diff & { image?: Uint8ClampedArray }`, with `type Pixels = { data: Uint8ClampedArray; width: number; height: number }`. `Diff` keeps its fields from `compare.ts`.
  - `likeness(render: Pixels, target: Pixels): { score: number; palette: number; layout: number; light: number; words: string[] }`. Each part is 0 to 100:
    - `palette` from the matched dominant colours' distance in Lab;
    - `layout` from the correlation of the two busy grids at 16×9;
    - `light` from the luma histograms' overlap;
    - `score` is their mean weighted 0.35, 0.4, 0.25.

    `words` are up to three sentences on the largest differences, from the measures: "the target is darker", "the target's busy area is in the left third, the render's in the centre", "the accent of the target is missing from the render".
  - tool `compare` with input `{ target?: string (an image asset or a project path; default the film plan's target); t?: number; compId?: string }`. Its images are one sheet: the render, the target and the difference side by side (`sheetOf`). Its text gives the scores and the words, and says that the measure is a guide: the frame is a target in look, not in content.
- [ ] **Step 1: Write the failing tests**:
  - `toLab([255, 255, 255])` is `[100, 0, 0]` within 0.01; `deltaE` of black and white is 100 within 0.01.
  - `pictureDiff` of two equal pictures gives `psnr: Infinity`, `over: 0`.
  - `likeness` of a picture with itself is 100 in every part.
  - Against its luma inverted, `light` falls under 30.
  - Against the same layout in other colours, `layout` stays over 80 and `palette` falls under 50.
  - The words of a darker target hold `darker`.
  - `compareFiles` of `packages/cli/src/compare.ts` gives the same `Diff` as before on two PNGs of `packages/cli/test/fixtures` (new `packages/cli/test/compare.test.ts`, written and passing before the move).
  - The tool without a target and without a plan says to give one. With a target of other proportions it says they differ.
- [ ] **Step 2: Run** `npx vitest run packages/core/test/picture.test.ts apps/editor/test/review.test.ts apps/editor/test/perception.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests and the CLI on two PNGs. Expected: PASS, and the CLI's output is unchanged.
- [ ] **Step 5: Commit** `feat(review): a render compared with its target, side by side, with what differs most`

### Task 8: The guide

**Files:**
- Modify: `packages/assistant/src/index.ts` (`INSTRUCTIONS`: in `Direction:` the line on rebuilding a scene ends with "and compare it with the target (use_tool compare)"; a new `Depth and camera:` paragraph after `Motion:`; the `Material:` paragraph names solids), `packages/assistant/test/fixtures/system-before.txt`
- Test: `packages/assistant/test/system.test.ts`

- [ ] **Step 1: Write the failing test**: `.fixed` holds `compare`, `rotationX`, `push-in`, `screen`, `solid.3d`.
- [ ] **Step 2: Run** `npx vitest run packages/assistant`. Expected: FAIL.
- [ ] **Step 3: Write** `Depth and camera:` in the file's voice, four bullets:
  - Planes separated by depth (transform depth and the camera's blur) and layers tilted in perspective (rotationX, rotationY: 10° to 35° reads, 60° hides) give a built scene its space. A card or a screen tilts, text you must read stays within 25°.
  - The camera moves with intent: push onto the detail that matters (use_tool "push-in") and come back; never a drift for its own sake.
  - An interface is built of pieces: the frame (device-screen), then one screen call with its rows, cards, rings and buttons. Its parameters are the content: names, figures and states from the brief.
  - 3D accents are solids with a material and an environment (solid.3d, an environment from stock), at a size that reads.
- [ ] **Step 4: Update the fixture.** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): depth, tilted planes, a camera with intent, screens of pieces, solids`

### Task 9: Docs, a dev run, whole-branch check

**Files:**
- Modify: `docs/document.md` (the transform's tilts, `fx.pin`, `solid.3d`), `docs/packs.md` (regenerated), `docs/taste-finish-roadmap.md` (tick step 5, link this plan), `CHANGELOG.md`

- [ ] **Step 1: Document and tick.**
- [ ] **Step 2: Verify** `npm run typecheck`, `npm test`, `node scripts/packs/index.ts --check`. Expected: all pass.
- [ ] **Step 3: Audit the diff for duplication.** Look for a mat4 kit left in `model.ts`, a second homography, a second dominant-colour clustering, and the screen size computed in the interface pack instead of read from the document. Fix what you find.
- [ ] **Step 4: One dev run with the user's go**, on the trial server: the dev dressing brief of bilal and one dev launch brief. Note in the PR:
  - whether the interface scenes used `screen`, whether layers were tilted, whether a push-in was used, and whether `compare` ran against the target;
  - the operations per scene against step 4's run;
  - the cost.
- [ ] **Step 5: Commit** `docs: the missing vocabulary, the roadmap and the changelog`
