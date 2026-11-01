# The evaluator in the sandbox

Status: the migration series below is implemented behind an experimental flag. It does not yet satisfy the [safe projects release gate](safe-projects-roadmap.md#release-gate): origin/credential isolation, expression-only projects, every import/export path, scoped permissions and adversarial tests still need validation before the code-execution question can be removed. The rationale below records why whole-frame rendering was moved; it is not a claim that the same-origin worker is a complete security boundary.

The last page-side pieces of plugin code are the modifiers, the Canvas2D effects, the stepping of simulations and — because they need those — the module's load itself. They all live where the **Evaluator** and the effect pipeline live: the page. This note prices the ways to move them, and the series this repo follows. It complements [plugin-isolation.md](plugin-isolation.md), whose stage 2 ends at exactly this decision.

## Why the plain fixes do not exist

- **Modifiers** (`$mod`) are applied per property, per frame, synchronously, inside every evaluation. A synchronous call cannot cross a worker boundary, and a plugin's modifier may read nothing but its params — the call itself is cheap; the crossing is what costs. There is no batching: each value is needed before the layer draws.
- **Canvas2D effects** mutate the layer's pixels in place, stacked in order with the built-in ones. Moving one means shipping the layer's pixels over and back per effect, and stacking plugin effects correctly means a batched pipeline contract (apply the whole ordered list to one snapshot) that the engine does not have. Shipping per effect is both slow and, when effects interleave with built-in ones, wrong unless the whole layer's draw moves too.
- **Simulation stepping** needs the props evaluated *at each step* (a rope's wind is keyframed), which only an evaluator next to the stepper can produce.
- **The module's load** disappears by itself once those three are gone: nothing else on the page needs the plugin's functions — nodes draw in the sandbox, tools and checks talk through it, geometry crosses as data.

So the tail is not four patches. It is one move: **the evaluation and the draw of the frame happen in the sandbox, and the page receives a finished picture.**

## The options

### (a) Document the trust boundary

Keep everything as it is; the code question says plainly that a plugin's modifiers, Canvas2D effects and simulations run with the editor's rights, and untrusted projects carrying such plugins are flagged before they open. Cost: nil. Isolation: none for exactly the parts strangers write most (a wobble modifier is the hello world of plugins). It is the fallback, not the answer.

### (b) The whole frame in the sandbox

The worker owns an Evaluator, the built-in registry, the plugin modules and the draw: the page sends the document (it already does, for the sandbox) and the time, and receives **one finished picture** per frame, transferred. The preview blits it; stills and exports use the same path.

- **What moves:** modifiers (the worker's evaluator applies them), Canvas2D effects (the worker draws them in the layer's pass, stacked in order), simulations (the worker steps them, checkpoints included — its props are local), the module's load (only the sandbox imports the module).
- **What the page keeps:** the mirror Evaluator that feeds the interface. Built-in nodes evaluate there fully (expressions and keyframes are trusted built-ins); a plugin node's props read as the document holds them (raw values, keyframes unapplied where a plugin modifier would sit — the inspector shows the document's truth, the picture shows the evaluated truth). Gizmos and outlines for plugin layers already come from the sandbox as data; nothing new is needed.
- **The document's sync:** the page already ships the sandbox the whole document whenever it changes (`SandboxDoc`); ops reach it the same way — a changed document is a changed `SandboxDoc`, and the sandbox rebuilds its evaluator from it.
- **Latency:** one crossing per frame, and the picture is a transferable — the round trip is the draw itself, which used to happen on the page anyway. The preview keeps drawing the last picture while the fresh one crosses (the pattern stage 2 uses per layer; here it is one picture).
- **Determinism:** exports and stills wait for the frame's own picture; the worker's draw is a pure function of document and time.
- **What is lost:** the page's render pipeline (motion blur sub-times, finish passes, the GPU raster path) must exist in the worker — the engine already runs there (the sandbox draws nodes with it); finish passes and sub-times are engine code too and move with it. The first release of this move may ship without motion blur for the sandboxed preview, stated in the flag's label.
- **Effort:** the preview's draw path branches to the sandbox behind a setting (the flag ships it experimental); then stills, then the browser exports, then the command line's page. Weeks in total, but the first stage is a flag, not a rewrite of everything at once.

### (c) Split layers between two evaluators

Layers whose subtree touches no plugin modifier/effect draw on the page as today; the others draw in the sandbox. The isolation is the same as (b) for less work *per layer*, but the frame runs two pipelines that must interleave in z-order, containers that mix both kinds pull their whole subtree across, and every new feature has to be written twice. More complexity than (b), same isolation. Rejected.

### (d) Contain the interpreter, not the frame

Run the tail inside a gas-limited interpreter on the page (the Wasm option of plugin-isolation.md). It keeps everything synchronous but changes what plugins may be: no WebGL, a display list for Canvas2D, an interpreter on hot paths. Already rejected there for the render path; it stays rejected here.

## The decision

**(b), behind a flag, in this series:**

1. **The frame primitive (done).** The sandbox renders a whole composition: built-in registry, plugin modules, its own Evaluator, the draw and the finish passes on an OffscreenCanvas; one picture comes back. Video frames are still decoded on the page and shipped with the request. Not wired anywhere yet; tested against the protocol.
2. **The preview flag (done — shipped experimental, off by default).** A setting turns the viewport's picture into the sandbox's frame, blitted through the renderer's own compositor (the canvas is WebGL: the bitmap goes in as a frame, the checker shows behind transparency as anywhere). The mirror evaluator keeps feeding the interface, the real renderer stays open for the registry and the assets, and scrubbing may show the previous picture for a moment. Video frames are still decoded on the page and travel with the request. Said plainly: the plugin's draw, tools, checks and geometry no longer run on the page — and since step 5, the module's *load* does not either.
3. **Stills and the browser exports (done — behind the same flag, with plugins in the project).** The stills (the assistant's, the contact sheets, the storyboard) and every web export (PNG sequence, GIF, WebM, MP4; the WAV is audio only) ask the sandbox for the frame — videos are decoded on the page first (`request` then `frameAt`), the picture comes back and is either read as pixels (PNG, GIF, WebM) or blitted through the renderer's compositor for the capture-based encoder (MP4). Without the flag, or with no plugin in the project, the native path runs as before.
4. **The command line's page (done).** The CLI's runtime page renders through the sandbox when the project has plugins — stills, the assistant's previews and the frame capture included; `?sandbox=0` opts out. The page is a browser page like the editor, so the mechanism is the same one.
5. **The registry from declarations (done).** When the flag is on, the sandbox owns the plugins' modules outright: the asset store skips them (their code never loads on the page), and the registry takes its nodes, effects, modifiers, tours and translations from the sandbox's declarations — schemas and the same sandbox-backed wrappers, no function of the plugin's anywhere. The flag flips at runtime: the registry is rebuilt from the other source.

Through all five, the code question keeps its meaning: a plugin from an unknown source no longer runs *any* of its code on the page once its project previews through the sandbox.
