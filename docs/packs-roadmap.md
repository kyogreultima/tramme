# Packs roadmap

The general-purpose plugin packs that ship with the editor (`plugins/*.js`, listed in `plugins/index.json`, added to a project from the Code section): the ones to come, and what Tramme needs first so they can exist. A pack is an ordinary plugin. It gives the assistant and the editor a new vocabulary — what they can build in one move, what they can check — for any film, never for one video.

Status: steps 0 to 17 are shipped (step 17 without its text, waiting on decision 4) (step 5 keeps its real recordings to check on a device; step 7 keeps its set of 300 emoji to confirm on a device). Shipped packs: charts, kinetic type, physics, stick figures, icons, diagrams, UI walkthrough, accessibility checks, localization ([plugins-roadmap.md](plugins-roadmap.md), step 10). The packs after step 0 are taken in order, each one landing whole. The decisions still open are listed at the end. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

The assistant makes a film from words, and what it can reach decides what the film can be. Today an explainer has no pictogram unless the assistant draws one vertex by vertex, a flow cannot be drawn without placing every box by hand, a product film cannot show code or a terminal, a screen recording plays flat at the size it was recorded, and a map is a line across an empty frame. Each is a whole kind of film the assistant cannot make well, and each comes back in prompt after prompt. The packs below bring them, in the order that opens the most films first.

A few things are missing under them, for several packs at once. A stroke cannot draw itself: the `shape.path` note asks the assistant to animate a `progress` the node does not have. An SVG cannot become paths. A shipped pack is one file and cannot carry data. And the assistant cannot add a pack at all: only the Code section can. Step 0 lands those once, in Tramme itself.

## Principles

- **Any film, never one video.** A pack is tried on at least three different inputs and in two formats (16:9 and 9:16) before its box is ticked. A threshold tuned on one example is a bug.
- **Taste, not templates.** A tool reads the content and the format before laying anything out, and picks among layouts with a seed: the same input and seed give the same result, another seed another one of equal quality. Colours are token references (`@plate`, `@ink`, `@accent`, `@accent2`), curves and pace the kit's (`enter`, `exit`, `pace`, `stagger`), type the kit's font. A pack never brings a look of its own, and never the gradients, glows and violets of generated-looking motion. The numbers of the taste guide hold ([taste-roadmap.md](taste-roadmap.md)): draw-ons of 0.4 to 0.8 s eased out, uneven stagger, reading time.
- **What a tool builds stays editable.** Ordinary layers and keyframes, as the recipes do ([plugins-roadmap.md](plugins-roadmap.md), step 2). A node only when layers cannot draw it: a lexer's colours, a projection, a simulation.
- **Authoring time and render time stay apart.** A layout, an analysis or a search runs in a tool, and its result is saved as props or as a JSON asset. A node is a pure function of its props and `t`; a state carried from frame to frame goes through `simulate`.
- **One file, no imports; shared needs land once.** A pack is one self-contained module: it is copied into the project as one file and loaded in the sandbox. What two packs would both need goes into Tramme itself (step 0), or into the pack that already owns it (the walkthrough's frames, the charts' scales), instead of being copied into each.
- **The editor ships the data, the project carries what it uses.** A pack's data (an icon set, map shapes, emoji) stays beside the pack in the editor and is read by its tools at authoring time. The tool writes into the project only the paths or shapes it used. No network for a pack, at authoring or at render time.
- **Permissive licences only.** MIT, ISC, BSD, Apache-2.0, OFL or public domain, each listed in `THIRD_PARTY_NOTICES.md`. Nothing that asks for an attribution inside the film (CC-BY): the film is the user's.
- **Complete when it lands.** Every node, effect, modifier and tool with its `ai` notes (when, avoid, an example); every title, label and description in French (`messages`); vector export hooks (`export.svg`, `export.lottie`) where the node can be static; the pure helpers exported and tested in `apps/editor/test/packs.test.ts`; the pack in `plugins/index.json` and in the README's Packs line; a changelog line under `Unreleased`.

## Steps

### Step 0. What the packs need first

- [x] Strokes that draw themselves: `trimStart`, `trimEnd` and `trimOffset` (0 to 1, animatable) on `shape.rect`, `shape.ellipse` and `shape.path`, measured along the path's length (Béziers flattened once per path and cached) and drawn with a dash on Canvas 2D; exported to Lottie as trim paths (`tm`) and to SVG with `pathLength` and a dash. The `shape.path` note in `packages/nodes/src/notes.ts` is rewritten on them, and the `map-journey` recipe reveals its line with them instead of a matte.
- [x] SVG to paths: SVG path data (`M L H V C S Q T A Z`, arcs as cubic Béziers), `circle`, `rect`, `line`, `polyline`, `polygon` and their transforms read into `PathValue`s, one per contour — the inverse of `pathD` (`packages/nodes/src/paint.ts`), in `packages/interop/src/svg.ts` beside the export. A built-in tool `svg-paths` (editor vocabulary and `/` menu) turns an SVG asset into a group of path layers with their fills and strokes, so a logo can draw itself; the packs' build scripts use the same reader.
- [x] Packs that carry data: a pack may have a folder beside it (`plugins/<pack>/`, its files listed in its `index.json` entry). Its tools read them at authoring time with `ctx.packFile(path)` (text or bytes from the editor's own origin, passed from the page to the sandbox as `readText` is), offered to a plugin whose `meta.id` is a shipped pack's (`tramme/<pack>`) and absent in the command line. The data is never copied into the project; the module is, as today.
- [x] The assistant reaches the packs: the shipped packs' nodes, tools and presets are found by `list_nodes { query }` even when the project holds none of them (counted, not listed, as the installed plugins are), and a proposal that draws with one adds the pack to the project in the same undo step — the path the installed plugins already take ([installed-plugins-roadmap.md](installed-plugins-roadmap.md), steps 3 and 4: `attachInstalled`, the copy on first draw, the version recorded). A pack whose tools only write ordinary layers (icons, diagrams) is never copied. A pack's checks run in the projects that hold it. The system prompt names the packs in one line. Whether they then draw through the sandbox is decision 1.
- [x] One test for every pack: `apps/editor/test/packs.test.ts` reads `plugins/index.json` and runs the shared checks on each pack it lists (registers, every node validates with its default props, tools and checks described, every title, label and description translated into French), so a pack cannot ship untested; each pack's own helpers keep their own `describe`.

Done when: a path draws itself in the preview, in Lottie and in SVG; an SVG logo becomes paths that draw themselves; a pack's tool reads its data; and the assistant, asked for something only a pack does, finds it and uses it in a project that did not hold it.

### Step 1. Icons (`icons.js`)

The pictograms of explainers, feature lists and steps, drawn as strokes that stay editable.

- [x] The data: Lucide (ISC: about 1,600 icons on a 24-unit grid, one stroke family) with its names and tags, converted by `scripts/packs/icons.ts` through step 0's SVG reader into `plugins/icons/lucide.json` (paths per icon), committed with the version it came from.
- [x] The `icon` tool (`/icon`): icons found by name, tag or a few words (a ranked search over names and tags, with synonyms of common words: "money" finds `banknote`, `wallet`, `coins`), several at once laid in a row, a grid or beside the lines of a list. Each icon is a group of `shape.path` layers in the kit's ink or accent, round caps and joins, its stroke scaled to sit with the text near it, drawn on with step 0's trim, its contours staggered unevenly. When the words are vague, the candidates come back as a contact sheet.
- [x] `ai` notes: when (a point a picture says faster than a word, a step of a process, a feature), avoid (an icon per word, more than five on screen at once, icons as decoration, two icon families in one film).
- [x] The `icon-stroke` check: an icon's stroke under 2 px at the composition's size (it vanishes on a phone), or the icons of one row at different stroke weights.
- [x] Tests: the search (names, tags, synonyms, nothing found), rows and grids in both formats, the operations validate, the stroke scale.

Done when: "three reasons to switch" gets three icons that draw themselves beside the reasons, in the film's colours, in a project that did not hold the pack.

### Step 2. Diagrams (`diagram.js`)

Flows, architectures, cycles and trees, written as text and laid out by the pack.

- [x] The text the assistant writes: a flowchart subset of Mermaid's syntax (`A[Label] --> B(Label)`, `-->|label|`, `---`, `-.->`, `subgraph`, `LR` and `TB`), or the same as JSON (`nodes`, `edges`, `groups`); an error names its line.
- [x] The layouts, written in the pack, pure and deterministic: layered (ranks by longest path, crossings reduced by barycentres, coordinates balanced), a cycle (a ring, for loops and lifecycles), a hub (a centre and its spokes), a tree. The direction follows the format (left to right in 16:9, top to bottom in 9:16) unless the text says otherwise; edges are routed with elbows or curves, off the boxes (decision 5).
- [x] The `diagram` tool (`/diagram`): the layout expanded into ordinary layers — boxes (`shape.rect`, the kit's radius), labels (`text`, sized to fit, wrapped), edges (`shape.path` with an arrowhead, drawn on with step 0's trim) — revealed in reading order (a box, then its edges drawing towards the next), with uneven stagger, in one group. A `highlight` input dims the rest and lifts one route through the graph, for a scene that explains one path.
- [x] The `diagram-legibility` check: a label overflowing its box or under its type size, edges crossing labels, more boxes than the format holds at once (about 12 in 16:9, 8 in 9:16).
- [x] Tests: the parser (every form, the errors), each layout (no overlap, crossings on known graphs, determinism), the reading order, the switch to portrait.

Done when: a six-step pipeline written in one line of text becomes a diagram that builds itself in reading order, readable in 16:9 and 9:16, and editable box by box.

### Step 3. Code and terminal (`codeview.js`)

Programs on screen, for developer tools and product films: code that types, changes and points at itself, and a terminal that runs.

- [x] The `codeview.code` node: code in the kit's mono typeface, coloured by a lexer written in the pack (JavaScript and TypeScript, Python, Rust, Go, shell, JSON, YAML, SQL, HTML, CSS: keywords, strings, numbers, comments, functions, punctuation), its colours derived from the tokens at a contrast of 4.5:1 at least (decision 6); line numbers, highlighted lines (the others dimmed), typing (`typed`, 0 to 1: characters at a seeded human rhythm, a pause at each line's end, the caret blinking at rest), scrolling to a line.
- [x] A change between two versions (`from`, `to`, `progress`): the tokens both share slide to their new place, the removed ones fade out, the new ones type in (a diff of tokens by longest common subsequence), the way a code change is shown in a talk.
- [x] The `codeview.terminal` node: a session written as a script (`$ npm run build`, its output, its waits): commands typed, output arriving in chunks, spinners and progress bars stepping with time, ANSI colours mapped to the tokens.
- [x] The window around them: the walkthrough pack's `device` node gains a `window` kind (title bar and tabs, no address bar), so Tramme has one family of frames, not two.
- [x] The `code-screen` tool (`/code-screen`): code from the words, from a file joined to the message or from a project file, laid in the window at a size the format can read; a long file cut to the lines that matter, the rest folded; each line typed or shown for its reading time.
- [x] The `code-legibility` check: type under 24 px on a 1080-pixel-high frame (28 px in 9:16), more lines than fit at that size, a line typed faster than it can be read.
- [x] Tests: the lexer on each language (a known line into its tokens), the token diff, the typing rhythm (deterministic, ending on the full text), the terminal script and its ANSI codes.

  Tried in the tests on synthetic code in both formats; a developer tool's real film is to check on a device (to try: a typed build, a fixed function, a 9:16 terminal).

Done when: a developer tool's film shows a command typed and run, then a function changing into its fixed version, each readable on a phone.

### Step 4. Rhythm and coherence (`rhythm.js`)

Checks only, like the accessibility pack: what a motion designer catches in a film that is right frame by frame and wrong as a whole. None of the built-in checks looks at it today.

- [x] `off-beat`: when the film's music has a beats analysis (the `beats` tool), cuts and scene changes (in points of video layers and nested compositions, scene markers) more than 70 ms from the nearest beat; the issue names that beat, and a bar line at a section change.
- [x] `even-shots`: four shots or more of nearly the same length (their spread under 15 % of their mean). The film plods: vary them.
- [x] `palette-drift`: fills and strokes written as colours outside the tokens and far from all of them (ΔE over 10), or more than five colours on screen at once.
- [x] `type-drift`: more than two typefaces in one film, or near-duplicate sizes on one frame (two sizes within 10 % of each other).
- [x] The `/review` workflow adds the pack when the film has music; the issues say what to do, as the taste checks do.
- [x] Tests on built documents: on and off the beat, even and varied shots, colours in and out of the tokens.

Done when: the review of a film cut to music flags the cut that lands between two beats, names the beat to move it to, and stays silent on a film that already lands on them.

### Step 5. Screen recordings (`screencast.js`)

A screen recording played as a product film: the picture goes where things happen.

- [x] The `screencast` tool: reads a recording at authoring time (frames sampled as the `shots` tool samples them, `apps/editor/src/perception.ts`), measures where the picture changes on a small grid (frame differences; the whole-screen change of a scroll or a page load told apart from a local one), finds the moments of activity (a click, typing, a menu opening) and the still stretches, and saves them as a JSON asset (`screencast-<media>.json`: regions of interest over time, with their kind).
- [x] From it, zoom keys on the video layer: scale and position eased, at most 2.5×, held while the activity stays in the region, out again before a whole-screen change, never cutting the region off, never moving during a scroll. The still stretches are marked for the edit (a speed-up or a cut, offered, never applied without the user).
- [x] A click found is marked with the walkthrough pack's cursor ripple, at its point and time.
- [x] The `screencast-motion` check: a zoom faster than the eye follows (over 1.5× a second), a region of interest off the frame, a zoom during a scroll.
- [x] Tests on synthetic recordings (a square moving on a still page, a scroll, a page change), and the tool tried by hand on three real recordings of different apps.

Done when: a one-minute recording of a web app plays with zooms on where the action is, and out again at each new page, without a key placed by hand.

### Step 6. Made by hand (`handmade.js`)

Warmth for explainers: strokes that boil, annotations drawn around what matters, motion on twos.

- [x] The `fx.boil` layer effect (GLSL): a small displacement by noise, drawn again every 2 or 3 frames, so a machine-drawn line trembles like one drawn by hand; its amplitude in pixels, held between changes.
- [x] The `twos` modifier: any value held for 2 frames (or n), with a small seeded jitter at each change, for stop motion and cut-out paper.
- [x] The `sketch` node: rough shapes (line, arrow, rectangle, ellipse, hachured fill), each drawn as two seeded passes that overshoot their corners — rough.js's idea, in the pack's own code — that draw themselves (`progress`).
- [x] The `annotate` tool: a circle, an underline, a box, a marker highlight, a strike or a bracket around a layer, drawn on a beat after the layer lands; its box measured by the tool, its moves followed through `host.layer`. A single word of a text layer once the text node gives word boxes, not before.
- [x] A `sketchbook` kit: a paper plate, a graphite ink, a handwritten typeface (OFL), slower curves.
- [x] Tests: the rough strokes deterministic per seed, the holds of `twos`, an annotation following a moving layer.

Done when: the key sentence of an explainer gets a circle drawn around it a beat after it lands, the shapes boil, and two renders are identical.

### Step 7. Conversations and emoji (`chat.js`, `emoji.js`)

The text-message stories of short videos, and the emoji that come with them.

- [x] `emoji.js`: an emoji set shipped beside the pack (decision 7), the `emoji` tool placing one or several as picture layers (only those files copied into the project), found by name or by the character itself. Never the system's emoji font, which draws differently on every machine.
- [x] The `chat.thread` node: a conversation from a script (`A: …`, `B: …`, a time per line or the reading time of the line before), bubbles entering on a spring, a typing indicator before each incoming message, the thread scrolling up as it grows, reactions and pictures in bubbles. Its look comes from the tokens and stays generic: no messaging app's look or name.
- [x] The `chat.notice` node: notifications that drop in and stack (a sender, a line, a time), for the cold open of a story.
- [x] The `chat` tool (`/chat`): the script in the walkthrough pack's phone, or full frame in 9:16, timed by reading, a reply that takes thought pausing longer.
- [x] The `chat-reading` check: a message pushed away before its reading time, a typing indicator under 0.4 s.
- [x] Tests: the script parser, the timing by reading, the scroll keeping the last message in view.

Done when: a twelve-line text story plays in 9:16 at a pace that can be read, typing pauses included, its emoji the same on every machine.

### Step 8. Charts, further (`charts.js` 1.1)

- [x] `chart.race`: a ranking over time from a table of periods by entries (a CSV or JSON asset): bars sliding to their new rank, values rolling, the period shown large, the leaders kept in view; the `chart` tool takes `kind: 'race'`.
- [x] `chart.scatter`: points, and bubbles sized by a value, moving between periods with their trails, labels kept apart.
- [x] `chart.function`: axes with readable ticks (the pack's `niceMax`), a curve of x sampled by the tool and drawn on, a point travelling along it, a tangent or the area under it — the plotting the formulas of step 11 need, kept here instead of copied there.
- [x] CSV read by the `chart` tool: separators, quotes, decimal commas.
- [x] `chart-readability` covers them: overlapping labels, more than 12 entries racing at once in 9:16.
- [x] Tests: ranks over time (ties, entries arriving and leaving), the CSV reader, the ticks of a function.

Done when: ten years of twelve entries in a CSV become a ranking race readable in 9:16.

### Step 9. Maps (`maps.js`)

- [x] The data: Natural Earth (public domain) countries and first-level regions at 1:110m and 1:50m and its populated places, simplified and quantised by `scripts/packs/maps.ts` into `plugins/maps/`. The tool writes into the project only the shapes the map shows (`assets/maps/<id>.json`).
- [x] The `map` node: the shapes projected (equirectangular, Natural Earth, Mercator at city scale, an orthographic globe); countries filled from the tokens, the chosen ones in the accent, values on a sequential scale from plate to accent; borders, pins with their labels kept apart, routes as great circles drawn on with a dot at their head. A camera (centre, zoom, rotation) is animatable, and a flight between two places zooms out and in along the way (van Wijk and Nuij's smooth zoom).
- [x] The `map` tool (`/map`): places named in words found among the shipped places and countries (offline, no provider; an ambiguous name asked back), the projection and the framing chosen from what is shown, a route keyed in step with a line of voice-over when one is given.
- [x] The `map-legibility` check: highlighted places too small to see at their zoom, overlapping labels, a flight faster than the eye follows.
- [x] `export.svg` for a still map.
- [x] Tests: the projections (known points), the place search (accents, aliases, ambiguity), the great circle, the smooth zoom, an asset holding only what is shown.

Done when: "our offices in Lyon, Montreal and Dakar" gets a map with three pins and a camera travelling between them, offline, the project holding only those countries.

### Step 10. Audiograms (`audiogram.js`)

- [x] A spectrum at authoring time: `analyseAudio` (`packages/core/src/analysis.ts`) gains 32 bands on a log scale from 40 Hz to 16 kHz at its 50 Hz rate (an FFT of 2048 samples a frame, saved decimated to 12.5 Hz so a 30-minute analysis stays under 6 MB) and `logBands` reads one spectrum; `audio(source).band(i)` in expressions stays open, the audiogram reads the asset directly.
- [x] The `audiogram.wave` node: the sound of a layer or an asset as bars, a mirrored waveform, a line or a ring around a picture, from the analysis (the loudness envelope and the bands), with a meter's rise and decay and a playhead; colours from the tokens.
- [x] The `audiogram` tool (`/audiogram`): an extract of a podcast or an interview as a clip — the cover or the speaker's picture, the name, the wave, the built-in captions, a progress bar — laid out for the format, varied by the seed.
- [x] Tests: the bands on synthetic tones (a 1 kHz tone lights its band), the bars at a known time.

Done when: a podcast extract becomes a 9:16 clip whose wave moves with the voice, captioned, from one command.

### Step 11. Formulas (`math.js`)

- [x] A TeX subset laid out by the pack (fractions, scripts, roots, sums and integrals with limits, small matrices, Greek letters, operators and arrows, `\text`, `\color`) in an OpenType math font fetched once like a kit's font (STIX Two Math or Latin Modern Math, OFL), with the font's math constants (decision 2).
- [x] The `math.formula` node: the formula drawn glyph by glyph, written on in reading order, its parts coloured; a change between two formulas, the symbols they share moving to their new places and the others leaving and arriving, the way a proof unfolds on a board.
- [x] The `formula` tool (`/formula`) and the `formula-legibility` check: type under its size for the format, a formula on screen for less than its reading time (slower than text).
- [x] Tests: the boxes of known formulas, the matching of symbols between two formulas, determinism.

Done when: an explainer writes a² + b² = c², rearranges it into c = √(a² + b²) with the symbols moving to their places, and plots it with step 8's `chart.function`.

### Step 12. Matter: morphs, liquids and paper (`matter.js`)

The row the plugins roadmap left open ("Matter and transitions"), apart from the cloth already shipped.

- [x] The `morph` node: one shape becoming another (`PathValue`s from path layers or step 0's SVG reader): both resampled along their length, their starts and directions matched so nothing twists, several contours paired by area and place, the extra ones growing from a point; `progress` animatable.
- [x] The `liquid` node: seeded blobs that merge and part (a field of circles traced by marching squares); as a transition, a liquid flooding the frame from one side and draining to the next scene.
- [x] The `paper` node: a torn-paper transition, its edge torn by seeded noise, with its fibres and its shadow, crossing the frame and revealing what is under.
- [x] Tests: resampled lengths, matched starts (no twist), marching squares on known fields, determinism.

Done when: an icon morphs into another without twisting, and a liquid and a torn paper pass between two scenes, the same in every render.

### Step 13. Rigid bodies (`physics.js` 1.1)

- [x] The `phys.bodies` node: boxes, circles and convex shapes that fall, collide, stack and come to rest (impulses, friction, restitution, sleep), stepped through `simulate`; the bodies are the glyphs of a text, shapes or pictures, and they meet the frame's edges and floors written as segments (decision 3).
- [x] The text drop grows into letters that knock into each other and pile up.
- [x] Tests: a box at rest stays at rest, a stack of three holds, any frame is the same reached in any order.

Done when: a title falls into a pile of letters that collide and settle, the same at every frame rendered in any order.

### Step 14. Print looks (`print.js`)

- [x] GLSL effects, as finishes, computed on the frame in linear light inside the pass: `print.halftone` (cell, angle, one ink — an AM screen on a grid turned by the angle), `print.riso` (two inks, each a little off register, over paper grain), `print.grain` (luma-sized film grain), `print.duotone` (the light between two colours). A dither and a posterize stay open.
- [x] Effect-stack presets: risograph, newsprint, two-tone.
- [x] Tests: each pass compiles in the render tests' Chrome and gives its known pixels on a gradient.

Done when: a whole film prints as a risograph in its own two colours, the same in the preview and the export.

### Step 15. QR codes (`qr.js`)

- [x] A QR encoder in the pack's own code (ISO/IEC 18004: byte mode, versions 1 to 20, the four correction levels, the mask chosen by its penalty).
- [x] The `qr` node: square, rounded or dotted modules in ink on plate, a picture in the centre at level H, revealed module by module; `export.svg` and `export.lottie`, since it is static.
- [x] The `qr-scannable` check: modules under 5 px at the export's size, a quiet zone under four modules, a contrast under 4:1 or inverted, less than 3 s on screen.
- [x] Tests: the encoding against reference vectors, the mask penalties.

  The node is `qr.code`. The reference symbols (versions 1, 2 and 7) come from another encoder, segno, whose byte-mode padding adds a zero codeword the standard does not ask for once the stream ends on a byte (its output was compared with that padding brought to the standard's: 26 symbols of versions 1 to 19, every level, the same module for module, the same mask chosen). To check on a device: the codes scanned by two or three phones, a logo in the middle at level H included.

Done when: the QR of an end card scans from a phone off the exported video (to check on a device).

### Step 16. Kinetic type, further (`kinetic.js` 1.1)

- [x] `scramble`: characters cycling through others before they settle, left to right, seeded.
- [x] `flap`: a split-flap board, each character flipping through the alphabet to its letter, both halves of each flap drawn.
- [x] `ai` notes: for a word, a name or a figure, never for body text (the taste guide keeps text moving as a block or word by word).
- [x] Tests: both settle on the text, deterministic.

  Both are modes of the `text.kinetic` node (`mode: 'scramble'`, `mode: 'flap'`), with a seed for the scramble and the flaps' colour, and a preset each. To check on a device: the flap's fold at 24 and 60 frames a second.

### Step 17. Logos in 3D (`extrude.js`)

- [x] The `extrude` tool: SVG paths (a logo, an icon, through step 0) extruded with a bevel and triangulated (ear clipping, holes included), written as a `.glb` asset that the built-in `model.3d` node draws with its lights, turntable and explode keys — no second 3D renderer.
- [ ] Text extruded once glyph outlines can be read (decision 4).

  Blocked by decision 4 (paths only): the pack reads no font, so type goes through the SVG as outlines first. It waits for a reader of glyph outlines.
- [x] Tests: the triangulation of shapes with holes, the `.glb` read back by `packages/nodes/src/gltf.ts`.

  The tool takes a group of path layers (what svg-paths makes) or one path, reads the holes by even-odd nesting, writes one primitive per colour, and hides the flat logo it came from. To check on a device: the .glb opened in a second glTF viewer, and the bevel under the studio light on a real logo.

Done when: a logo given as an SVG turns on a turntable under the studio light, and its `.glb` opens in any glTF viewer.

## Decisions

Open, for the author. Each step names the one it waits on; the recommended choice comes first.

1. **The sandbox for packs.** Once the assistant adds a pack, does it draw on the page like the editor's own code (recommended: the packs ship with the editor and are reviewed in this repository), or through the sandbox like an installed plugin (one rule for all, at the sandbox's speed)?

   Taken (2026-10-25): on the page (already how packs draw once copied).
2. **Formulas.** A TeX subset laid out by the pack in an OpenType math font (recommended: light, enough for explainers), or MathJax fetched on first use (complete TeX, about 2 MB, run in the sandbox).

   Taken (2026-10-25): a TeX subset laid out by the pack, in STIX Two Math (OFL).
3. **Rigid bodies.** A small engine in the pack, for boxes, circles and convex shapes (recommended), or planck.js (MIT, about 200 KB) vendored into it.

   Taken (2026-10-25): a small engine in the pack.
4. **Text in 3D.** Paths only to start (recommended), or opentype.js (MIT, about 170 KB) in the tool to read glyph outlines.

   Taken (2026-10-25): paths only.
5. **Diagram layouts.** Written in the pack (recommended), or dagre (MIT) vendored.

   Taken (2026-10-25): written in the pack (shipped).
6. **Code colouring.** A lexer written in the pack (recommended), or Prism (MIT) vendored with its grammars.

   Taken (2026-10-25): a lexer written in the pack.
7. **Emoji.** Fluent Emoji Flat (MIT) or Noto Emoji (Apache-2.0); the few hundred most used (recommended) or the whole set (tens of megabytes beside the editor).

   Taken (2026-10-25): Fluent Emoji Flat (MIT), the 300 most used.
8. **The roadmap loop.** Whether this roadmap joins the queue of [roadmap-loop.md](roadmap-loop.md), and at which place.

   Taken (2026-10-25): it joins the queue, after Polish and before the other roadmaps' open boxes (queue item 14).
