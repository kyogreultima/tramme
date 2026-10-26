# Plugins roadmap

Where the plugin system goes, and in what order. The goal is not only a richer vocabulary of layers: it is to give the built-in assistant what it needs to produce impressive videos on its own. The editor gets the same abilities, since the editor and the assistant share one API.

Status: every step is done (glTF is lean: no skinning; rope, cloth and flock are done — fluid and rigid shapes left; pose and audio processing are lean) except the isolation of untrusted plugins (step 10): the author picked the staged path of [plugin-isolation.md](plugin-isolation.md) and stages 0 and 1 are shipped (the code question names what each plugin brings; the plugins' tools and checks run in a per-project worker); stage 2, the render path, waits until untrusted plugins must draw. Steps 7b and 8 still wait for decisions (a 3D library, the providers). Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

Today a plugin adds nodes, effects, modifiers, guided tours and translations (see [document.md](document.md#node-plugins)). The assistant writes the document as JSON Patch and checks it with stills. That is enough for simple motion design, not for striking results, because a model:

- composes building blocks and writes code well, but tunes pixels poorly and judges motion badly from one still;
- cannot see what matters in the material: where the face is, where the beats fall, where there is room for a title;
- has one feedback loop (`render_still`), with no way to measure what went wrong.

So the plugin system must extend three things, not one:

1. **What the assistant can perceive**: analyses of sound, video and images, saved as data.
2. **What it can build in one move**: high-level tools and recipes with good taste built in.
3. **How it checks its work**: quality checks and richer previews.

The renderer gains what those need (GPU effects, layer inputs, simulations, 3D).

## Principles

- **Authoring time and render time are separate.** Rendering stays a pure function of time (no network, no randomness, no state between frames). At authoring time a plugin may do anything the editor can: run a model, analyse a video, call a provider. What it computes is saved as project files (`assets/...json`, masks, depth maps, audio) and read by the render. The project stays self-contained and every render is reproducible.
- **One mechanism for the assistant and the editor.** A plugin tool is callable by the assistant and, later, from the editor's menus. Document changes always go through operations, so they are validated, previewed and undoable.
- **Plugins describe themselves to the model.** Every node, effect, modifier and tool can carry notes for the assistant: when to use it, what to avoid, values that look good.
- **The assistant's tool list stays fixed.** Plugin tools are reached through one generic tool (`use_tool`) and listed by `list_nodes`. The tool definitions sent to the model do not change with the project, which keeps prompt caching working on every path (companion, server, other providers).
- **Built-in features dogfood the system.** Templates, analyses and checks that ship with Tramme are written as built-in plugins, with the same API as project plugins.

## The plugin module, once complete

```js
export const nodes = [...];       // layer types (render time)
export const effects = [...];     // layer and finishing effects (render time)
export const modifiers = [...];   // value modifiers (render time)
export const tools = [...];       // authoring tools for the assistant and the editor (step 1)
export const checks = [...];      // quality checks run after a change (step 3)
export const kits = [...];        // style kits: tokens, curves, recipe defaults (step 2)
export const tours = [...];       // guided tours (exists)
export const messages = {...};    // translations (exists)
export const meta = { name, version, api: 1 };   // manifest (step 10)
```

## Steps

### Step 1. Tools for the assistant, notes for the model

- [x] `tools` export: `{ name, title?, description, input (JSON Schema), ai?, run(input, ctx) }` (`packages/core/src/tools.ts`, registered by `Registry.use`).
- [x] `ctx` (authoring context): the live document (pending proposal included), composition, time and selection of the editor, the registry, `assetUrl`, `readText`, `writeFile` (under `assets/`), `renderStill`, `transcript`.
- [x] An abort signal in `ctx` (`ctx.signal`), so a long analysis stops with the turn.
- [x] A tool returns text, images (shown to the model and the user) and/or operations with a label. Operations join the pending proposal like any other, so they are validated and shown as a preview.
- [x] Assistant: one generic tool `use_tool { name, input }`; `list_nodes` lists the tools with their input schema; the system prompt explains when to use them.
- [x] `ai` notes (`when`, `avoid`, `example`) on nodes, effects, modifiers and tools, returned by `list_nodes`.
- [x] Docs (document.md, "Tools" under "Node plugins") with an example tool.
- [x] `ai` notes on the built-in nodes, effects and modifiers (`packages/nodes/src/notes.ts`, `packages/core/src/modifiers.ts`).
- [x] An example project, `packages/cli/test/fixtures/night-sky` (once in `examples/`, now the plugin tests' project): its plugin brings a node (`sky.moon`), a tool (`sky.stars`), a workflow (`sky.night`) and French names.

Done when: a project plugin exports a tool, the assistant finds it with `list_nodes`, calls it, and its operations show up as a proposal.

### Step 1b. The chat's `/` menu (brought forward from step 9)

- [x] Typing `/` in the chat lists the tools and workflows of the vocabulary (the editor's own and the project's plugins'), filtered as you type, keyboard and touch friendly.
- [x] A tool gets a form generated from its input schema (`format: 'asset'`, `format: 'layer'` for pickers). Required fields filled and nothing written after the command: it runs at once, without a model, and its changes come as a proposal. Words after the command: the request goes to the assistant, with the tool named and the fields already filled.
- [x] `prompts` export: workflows (instructions for the assistant for one kind of result) picked with `/name`.
- [x] Built-in: `/captions`, `/title`, `/keyword`, `/lower-third` (the templates as tools), `/dress` and `/review` (workflows). The editor's base vocabulary is `editorRegistry()` (`apps/editor/src/vocabulary.ts`).
- [x] A tool run alone is told to the assistant at the next message.
- [x] `/cutout` (step 4's segmentation masks).
- [x] More built-in commands as steps land: `/cut-silences` (the `silences` tool cuts on the transcript's gaps), `/transcript`, `/still` (the `still` tool saves a frame of the composition), `/beats`.

### Step 2. Recipes and style kits

- [x] Recipes are tools that return operations, expanded into ordinary layers and keyframes that stay editable (`apps/editor/src/recipes.ts`): `kinetic-title` (rise, pop, slide, blur), `bar-chart`, `stat` (rolling figure), `transition` (wipe, circle, bars, flash).
- [x] More recipes: map journey (a line travelling stop to stop, revealed in step with the dot), word-by-word quote, logo reveal (iris, wipe or rise), list (tick, number or dash markers), timeline, split screen.
- [x] The built-in templates (captions, title, keyword, lower third) are also tools of the editor's vocabulary, with the same API. `apply_template` stays for the assistant.
- [x] `kits` export: a motion language as tokens (`plate`, `ink`, `accent`, `accent2`, `enter`, `exit`, `pace`, `stagger`) applied by the `kit` tool and read by the recipes. Built-in kits: editorial, punchy, calm, neon.
- [x] Fonts in kits: each built-in kit names its typeface (Newsreader, IBM Plex Mono, Archivo Black, Karla, Space Grotesk — a woff2 fetched once, kept as a project file); the `kit` tool brings it in as a font asset, and the recipes write in it.

### Step 3. Quality loop

- [x] `checks` export: `run(ctx) → issues` with a severity, the times and layers involved; `ctx.samples` is the composition sampled 4 times a second, each layer placed in composition space (`packages/core/src/checks.ts`). Built-in: text size, reading time, safe zone, overlapping text, text crossing an element, crowded entrances, still stretches.
- [x] Checks that need pixels or perception: text over a detected face (step 4), low contrast behind text (the free-space grid carries each cell's luminance; the check weighs the ink, its opacity and what sits under).
- [x] `check` tool: runs the checks and returns a contact sheet of the key moments; `motion` tool: a strip of frames to judge a movement (`apps/editor/src/review.ts`). Both in the `/` menu too.
- [x] The system prompt asks for `check` before summing up; the `/review` workflow uses both tools.

### Step 4. Perception

Built-in plugins whose tools analyse the material at authoring time and save the result as `json` assets. Nodes, expressions and recipes read them.

- [x] Audio (`beats` tool, `analyseAudio` in `packages/core/src/analysis.ts`): tempo, beats, bars, onsets, sections, loudness of the whole and of three bands at 50 Hz. Pure DSP, deterministic, tested on synthetic grooves.
- [x] Phonemes from the transcript (`lipsync` tool, `mouthKeys` in `packages/core/src/lipsync.ts`): the words said become the nine classic mouth shapes, held while their letters would be spoken and closed between the words, written as keys on a sequence's `drawing` (a drawn rig holds one drawing per shape, remappable with a mouths map).
- [x] Video: shot changes (`shots` tool, colour histograms), people boxes over time (`subjects` tool, YOLOS tiny through transformers.js, loaded on demand).
- [x] Video: segmentation masks (`cutout` tool, `apps/editor/src/cutout.ts`): U²-Net (people, or any salient subject) through onnxruntime on WebGPU or the processor, kept to the people the detector finds, steadied from frame to frame, saved as a mask video timed like the file.
- [x] Video: depth (`depth` tool, `apps/editor/src/depth.ts`): Depth Anything v2 small through transformers.js on WebGPU or the processor, steadied from frame to frame, saved as a grey video timed like the file (a grey PNG for a photo), played by a hidden layer and read by `fx.parallax` and `fx.depthBlur` (pose left).
- [x] Video: an object followed over time (`track` tool: template matching in `packages/core/src/track.ts`, framed by a rectangle, a region or the detector), saved as a JSON asset that the `callout` node and `track()` in expressions read through the video layer: tracked callouts.
- [x] Image: main colours as tokens (`palette` tool: plate, ink, accent).
- [x] Image: saliency and free space as data (the `space` tool, `freeSides`/`largestFree`/`clearMargins` in `packages/core/src/space.ts`): a small grid of how busy each cell is (edge energy of the frame, robustly scaled), saved as a JSON asset with the free sides and the largest clear rectangle in fractions of the frame — where a title or a caption block fits.
- [x] Render-time access: nodes read JSON assets with `host.asset(id)`; expressions with `audio(source)` (`pulse`, `barPulse`, `hit`, `energy`, `beat`, `bar`, `phase`, `section`), mapped to the time of a sound layer; the `react` modifier for the same without code. The renderer gives the evaluator the loaded analyses.
- [x] Checks read analyses: `text-over-subject` warns when text covers a face.
- [x] Models run in the browser at authoring time, never during a render; the system prompt says when to use each tool.

### Step 5. Rendering

- [x] Error isolation: in the preview (`isolate` renderer option), a node or effect that throws draws a red frame for its layer and is named in the error bar; the rest renders. Exports keep failing (checked with the CLI). The live preview test is still to do.
- [x] Finishing effects in GLSL (`gl: { code }`, `stage: 'finish'`): run by the compositor on the accumulated frame in linear light, before glow and grain (ping-pong targets). Built-in: `look.chromatic`, `look.grade`.
- [x] Layer effects in GLSL: a pass on the layer drawn alone, through one shared WebGL2 canvas (`packages/render/src/gpu.ts`); uniforms generated from the props schema, `uScale` for the preview size.
- [x] Layer inputs: the `layer` property type (validated, picked in the inspector); GLSL effects get it as a texture of that layer drawn alone, hidden or not; `host.drawLayer(ctx, id)` for nodes. Built-in: `fx.matte` (alpha, luma, inverted), `fx.displace`.
- [x] Masks as assets read per frame: a mask video (luma) played by a hidden video layer and read through `fx.matte`, so "text behind the subject" needs no new render path.
- [x] Depth sequences, the same way.

### Step 6. Time and state

- [x] Deterministic simulations: `simulate: { init, step }` on a node; the renderer steps from the in point, keeps a checkpoint every 10 frames and the last frame, and starts over after any change of the document. A frame rendered directly is byte-identical to the same frame reached after others (checked with the CLI).
- [x] `host.layer(id)`: evaluated props and transform of another layer; `host.state()` for the simulation.
- [x] Built-in `follow` node: a dot following another layer on a spring, with a trail.
- [x] More simulated nodes: `rope` (Verlet points, tied to the layer origin, pulled towards a layer, wind), `cloth` (a grid pinned along its top, gravity and a breathing wind, filled mesh or wireframe), `flock` (boids — separation, alignment, cohesion — seeded, held at their pace, turning back before the edges). Fluid and rigid shapes left.

### Step 7. 3D and camera

- [x] A WebGL node service for plugins: `render.gl(g, props, host, area)` on a node (`packages/render/src/gpu.ts`, `nodeContext`): one context per node type, kept from frame to frame (programs cached per source, meshes uploaded once), sized to the node's bounds and drawn into the layer; failures land in the error bar.
- [x] glTF models (`model.3d` node, `model` tool): a .glb (glTF 2.0) read by a lean parser (`packages/nodes/src/gltf.ts` — meshes, materials by base colour, rigid TRS animation with slerp), drawn on the node's own WebGL2 service (studio, sun or flat light, a turntable spin, explode keys); skinned meshes draw at rest, and the file arrives as an asset of type `model` (joined to a message or brought in).
- [x] A virtual camera for 2.5D: `camera` on the composition (pan, zoom, perspective, focus, blur) and `transform.depth` on layers: parallax and depth blur, in the inspector and the schema.
- [x] Photo to 2.5D from a depth map (step 4's depth): the `photo-2.5d` tool reads the depth, adds the composition camera with a slow drift and scales the photo past the relief's widest stretch.

### Step 8. Generated assets

- [x] Voice (TTS), music beds and sound effects through the Worker at authoring time, saved with their prompt and provider: the `generate-sound` tool ([sound-roadmap.md](sound-roadmap.md), step 8).
- [x] Images and textures, background removal, the same way (the `remove-bg` tool): the same U²-Net matte the video cutout uses, run once on a picture, written as its alpha — a PNG with transparency saved as a new image asset and placed as its own layer, so titles pass behind the subject.

### Step 9. Editor surfaces

- [x] Plugin tools in the editor: the chat's `/` menu runs the same tools (form generated from the input schema), see step 1b.
- [x] Viewport handles declared by nodes (`handles(props)`: points and distances in local space), drawn as accent diamonds and dragged like the frame's handles (a key at the current time when animated). Built-in: the rectangle's corner radius; the example's moon radius.
- [x] Presets in the add menu (`presets` export, ready-made layers with effects and motion). Built-in: neon title, frosted card, light leak, spotlight.
- [x] Effect-stack presets (several effects applied to the selection at once): a preset may carry an `effects` stack instead of a layer; the add menu pushes it onto every selected layer. Built-in: cinematic tone, dreamy glow, VHS, readable over anything.
- [x] Export hooks (`export.svg`, `export.lottie`) so plugin nodes are not dropped from vector exports.

### Step 10. Ecosystem

- [x] `meta` manifest (`name`, `version`, `description`, `api`), the API version checked at load (`PLUGIN_API`): a newer plugin is refused with a clear message.
- [x] `@tramme/plugin` (`packages/plugin`): every type a plugin exports and `definePlugin()`.
- [x] A library of plugins shared between projects (`/api/library` in the Worker, R2 `library/plugins/`); tools `library-add` and `library-use` (assistant and `/` menu); a plugin is copied into the project when used, so archives stay self-contained.
- [ ] Isolation of untrusted plugins for projects from unknown sources, staged ([plugin-isolation.md](plugin-isolation.md)). Stage 0 done: the code question names what each plugin brings. Stage 1 done: the plugins' tools and checks run in a per-project browser worker, their context bridged by message (`apps/editor/src/plugins`), and an archive's plugins are validated there at import — the page never imports them. Stage 2 done: every node draws in the worker — evaluated props in, one picture per layer out with its outline (SVG path data) and handles, transferred over its bounds; vector exports are computed in the sandbox and primed before a conversion. Still trusted on the page without the flag, documented: the module's load, the modifiers, the Canvas2D effects, the stepping of simulations, and the command line's Node rights. The move that closes them is shipped ([evaluator-sandbox.md](evaluator-sandbox.md)): the sandbox evaluates and renders whole frames, the preview runs that path behind an experimental flag, and so do the stills, the web exports and the command line's page; with the flag on, the plugins' modules no longer load on the page at all. The box stays open on the author's word: tick it to make the flag the default, or to accept the documented tail as the shipped state.
- [x] General-purpose packs ship with the editor (charts, kinetic type, physics, UI walkthrough, accessibility checks, localization), added to a project in one click from the Code section. The packs to come: [packs-roadmap.md](packs-roadmap.md).
- [x] Audio processing (gain curves, fades, low and high cut, equaliser in three bands, reverb, speed) with one mixer for the preview and every export ([sound-roadmap.md](sound-roadmap.md), step 7); a compressor (`compress`, 0 to 1, one DynamicsCompressor between the equaliser and the gain, in the one mixer).

## Flagship results and what they need

| Result | Steps |
|---|---|
| Talking video turned into a clip: word-level karaoke captions, keywords punched in, auto zoom on the speaker, b-roll on topics | 1, 2, 3, 4 (faces) |
| Title behind the subject: the person cut out of the video, the title between them and the background | 1, 4 (segmentation), 5 (layer inputs, mask sequences) |
| Music video: cuts on beats, audio-reactive shaders, lyrics in kinetic type, mood change on each chorus | 1, 2, 4 (audio), 5 (GLSL) |
| Photo to 2.5D: depth map, camera moving into the picture, particles at several depths, depth of field | 4 (depth), 7 |
| Drawn character lip sync: phonemes drive the `drawing` property of a `sequence` | 1, 4 (phonemes) |
| Product in 3D: glTF turntable, studio light, exploded view, camera moves | 7 |
| Data story: CSV to animated charts, voice-over, highlights synced to the voice | 1, 2, 8 (voice) |
| Tracked callouts: a label or circle following an object in the video | 4 (tracking), 6 (`host.layer`) |
| Matter and transitions: shape morphs, liquid transitions, cloth, torn paper | 5, 6 |
