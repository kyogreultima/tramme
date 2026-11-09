# Plugin isolation

How to run plugins from projects of unknown sources without handing them the editor. This note prices the options and proposes a staged path; the author picked the staged path, and it is under way: stages 0 and 1 below are shipped, and stage 2 is shipped for drawing (its tail is listed there).

Current priority and acceptance criteria: [safe-projects-roadmap.md](safe-projects-roadmap.md). The whole-frame worker is implemented behind an experimental flag, but ordinary projects must keep the code question until the stronger boundary and all execution paths are validated. The comparisons below describe architecture options, not a claim that today's worker isolates credentials or storage.

Today a plugin is arbitrary JavaScript with the page's full power. The import asks before running an archive's code (the code question, `apps/editor/src/importer.ts`), the Code section shows what a project runs, and the shared library vouches for what it ships — but once the answer is yes, the module runs in the editor's page: it can rewrite the document, read and write every project file, reach the provider routes with the keys the user connected, and do anything else the page can do. That is the right deal for projects you wrote and plugins you read. It is not an answer for "projects from unknown sources", which is what the roadmap asks for.

## What a plugin is made of

The editor loads a plugin with a dynamic `import()` of a blob URL and registers what it exports (`Registry.use`, which checks the API version and the shape of each entry). The top-level code of the module runs at once, where it is imported — that is the true attack surface: a `path()` that only draws is harmless, a module top level that reads your keys is not. The exports split in three kinds, and the kind decides what isolation can cost:

1. **Declarations — data.** Props schemas, `ai` notes, kits, presets, prompts, tours, `meta`, and the GLSL source of `gl: { code }` effects. These cross any boundary unchanged. A GLSL pass cannot touch the DOM: it runs on the GPU, and its worst mischief is a long loop the browser's watchdog stops. Nothing here needs isolating.
2. **Authoring-time functions.** Tools (`run(input, ctx)`, already async) and checks (`run(ctx)`, sync or Promise; their samples are plain data). They run when the assistant or the user calls them, never per frame.
3. **Render-time functions.** Nodes (`canvas2d`, `gl`, `path`, `bounds`, `simulate`, `handles`, `export`), effects' `canvas2d.apply/filter`, modifiers' `apply`. These run inside every frame of the preview and of every export, against a live surface (a `CanvasRenderingContext2D`, the node's `NodeGL` service) and through the host (`asset`, `layer`, `state`, `drawLayer`, `drawComposition`, `defer`).

Three boundary costs are worth naming once, because every option pays some of them:

- **Live objects do not cross.** `Path2D` (the selectable outline, clips), image elements, module namespaces, `AbortSignal`, functions themselves: each becomes a copy, a serialized form (an SVG path string), or a proxy — or stays behind.
- **Synchronous calls do not cross a worker boundary.** Anything moved there turns async at its caller. Checks already accept a Promise; the draw loop does not — render-time code must move as whole frames (batched), not as per-call RPC, and modifiers (applied per property, many times a frame) cannot pay a round trip at all.
- **Pixels cross cheaply but not for free.** A transferable `ImageBitmap` moves without a copy, yet each side still uploads or draws it. One per plugin layer per frame is affordable; a dozen round trips per frame is not.

One scope note: the worker of the roadmap's title is a browser Worker, not the Cloudflare Worker the app deploys as — `apps/worker` has no canvas and never renders. The isolation boundary lives where the frames live: the editor's page and the browser page the command line drives (`packages/cli/src/browser.ts`).

## The options

### (a) The status quo: one thread, trust and review

Everything stays in the main thread. Isolation is the code question, the Code section, the library's curation and plain review. Nothing is technically enforced.

- **Isolation:** none. A malicious plugin is arbitrary code in the page.
- **What the plugin loses:** nothing. Every export works everywhere — preview, checks, tools, exports, tours.
- **Effort:** nil, or a day to make the trust path sharper (the code question could name what the plugin brings — nodes, tools, checks — and the Code section could show where each plugin came from).
- **Preview and exports:** unchanged.
- **Right call when:** the projects are yours and the plugins are reviewed. Also the only option that keeps hang-safety at zero: a `while (true)` in a node still freezes the whole tab.

### (b) A dedicated worker per project, with OffscreenCanvas and RPC

Plugin modules are imported in a Dedicated Worker, one per project. Registration sends the declarations back as data (schemas, kits, presets, prompts, tours, GLSL sources, the tool list that `list_nodes` reads — the assistant's surface does not change at all). Tools and checks run there against a proxied `ToolContext`: `readText`, `files`, `fileUrl`, `assetUrl` answered by the host; `writeFile` ships the bytes back; `renderStill` and `transcript` render on the main thread and ship the result; `signal` becomes a message. Render-time code draws in the worker: the engine ships each frame's evaluated props for the plugin's layers, the worker draws them (Canvas2D, or its own WebGL2 on an `OffscreenCanvas` — `gpu.ts` already prefers `OffscreenCanvas`, so the GL service moves nearly as-is) and returns one transferable `ImageBitmap` per plugin layer; the main thread composites. GLSL effects need not move: their code is data, run by the host's own pipeline.

- **Isolation:** no editor DOM and a separate execution thread, but not a credential or storage boundary by itself. A same-origin worker can use network and storage APIs. The host proxy becomes the only reach only after a separate/opaque origin and platform policy enforce it; see [safe projects](safe-projects-roadmap.md). A hung worker can be terminated by its host, once deadlines and failure recovery cover its calls.
- **What the plugin loses or pays:**
  - `host.asset(id)` hands out copies (cached bitmaps) instead of live elements; module namespaces are imported on the worker's side.
  - `path()` returns an SVG path string instead of a `Path2D`; the engine rebuilds it.
  - `host.layer()` and `host.state()` cross as structured clones per frame; `host.drawLayer`/`drawComposition` draw on the main thread and ship a bitmap — a plugin that reads another layer every frame pays two crossings.
  - Container plugin nodes (children drawn in the node's local space) need their children shipped and drawn in the worker too.
  - Modifiers and the evaluator stay on the main thread (per-property calls cannot cross): plugin modifiers stay unisolated, or the whole evaluation moves into the worker — a much larger engine change, a decision of its own.
  - Effects' `canvas2d.apply` mutates the layer's offscreen pixels on the main thread today; either those pixels ship over and back per effect, or Canvas2D effects stay main-thread (trusted-only, documented).
  - Tools lose nothing that exists: `ToolContext` is already an abstract surface, and every built-in tool would keep working through the proxy.
- **Effort:** the largest item left on the roadmap — the worker runtime, the registration protocol, the frame protocol (props in, bitmaps and per-layer errors out, so the red frame of the isolated preview keeps working), the `ToolContext` proxy, the editor and CLI wiring, tests. Weeks, not days.
- **Preview:** with batching, one transferable per plugin layer per frame keeps a plugin-heavy composition interactive; scrubbing over many simulated plugin nodes is the case to measure. Without batching (naïve RPC per call) it does not work at all.
- **Exports:** the command line already renders in a browser page, so the same worker runs there and determinism holds as long as the worker's draw stays a pure function of the shipped props. A bare-Node renderer neither gains nor loses: it cannot host WebGL2 today (`WebGL2 unavailable` in `gpu.ts`) nor plugin Canvas2D without a DOM canvas.

### (c) An iframe or a worker with a strict CSP and a reduced API

The same shape as (b), with the boundary tightened by the platform: a worker whose only network is the host proxy (no free `fetch`), transferables only; or a sandboxed iframe (`sandbox="allow-scripts"`, opaque origin, `connect-src 'none'`), which keeps a DOM — useless for rendering (the pixels still have to leave) but comfortable for tools that parse media with platform codecs or build their own interface.

- **Isolation:** strong for network and origin. An iframe is weaker than a worker on DOM reach (it has one, even barren), but its opaque origin keeps it out of the editor's storage and the API.
- **What the plugin loses:** those of (b) wherever rendering moves. The reduced API falls exactly on the strangers' plugins worth having: one that loads its own model or calls its own service must go through a per-project allowlist the user grants — a permission dialog, like the code question today. In the partial version (only tools and checks move), render-time code stays on the main thread and stays trusted: the isolation is real but half the story.
- **Effort:** the protocol work of (b) plus policy plumbing (allowlists, permissions); roughly half of (b) if only authoring-time code moves.
- **Preview and exports:** as (b) where it applies; the authoring-time-only version costs the frame path nothing.

### (d) A Wasm/QuickJS sandbox

Plugin code runs in an embedded interpreter (QuickJS compiled to Wasm, or a Wasm runtime) inside the page or a worker. The interpreter can execute synchronously on the main thread under an instruction budget (a gas limit), so the synchronous surfaces survive — checks and modifiers could stay sync and abortable, the one option that keeps both. The host exposes a narrow binding: the document as data, a display list for drawing.

- **Isolation:** maximal in practice — no platform to escape: no fetch, no timers unless granted, bounded memory.
- **What the plugin loses:**
  - No WebGL in the sandbox: `render.gl` nodes cannot run their own GL service. A plugin's 3D must ship GLSL to the host or be drawn by the host from data — and the impressive plugins (a `model.3d`-style node, particles on the GPU) are exactly the ones it cannot host as code.
  - Canvas2D drawing becomes a display-list dialect replayed by the host: paths, fills, transforms, images. Gradients, filters, `getImageData`, the free mixing with `host.drawLayer` shrink or vanish; every Canvas2D plugin ever written needs a port.
  - Speed: an interpreter on per-frame code is many times slower; the DSP-heavy tools of step 4 would hurt under a gas limit.
- **Effort:** very large and permanent — bindings, a display list kept faithful to Canvas2D semantics, gas accounting, a debugging story, and a second dialect plugin authors must learn.
- **Preview:** interpreter overhead per plugin layer, plus the crossings of (b). **Exports:** the only option whose render story does not depend on a browser — the host replays the display list anywhere, bare Node included; moot today, since bare Node cannot render at all yet.

## The decision table

| Option | Isolation | Effort | What the plugin loses | Right call when |
|---|---|---|---|---|
| (a) status quo | none — trust, review, the code question | nil | nothing | the projects are yours, the plugins reviewed |
| (b) worker per project + OffscreenCanvas + RPC | strong: no DOM, no origin, a proxied API, hangs contained | weeks: registration, frame protocol, `ToolContext` proxy | live objects become copies; modifiers (and maybe Canvas2D effects) stay main-thread; per-frame host reads pay crossings | untrusted projects are a real case and plugin-heavy previews can pay a bitmap per layer |
| (c) worker or iframe + strict CSP, reduced API | strong on network and origin; iframe weaker on DOM reach | half of (b) if only tools and checks move; as (b) plus policy plumbing otherwise | strangers' tools need a per-project network allowlist; render-time code stays trusted in the partial version | a first real boundary for authoring-time code, before the render path moves |
| (d) Wasm/QuickJS | maximal; keeps checks and modifiers synchronous under a gas limit | very large and permanent | WebGL nodes impossible; Canvas2D reduced to a display list; interpreter speed; a second API dialect | never for the render path; perhaps one day for checks and modifiers |

## A staged recommendation

The picked path, one shippable step at a time:

1. **Stage 0 — sharpen the trust path (done).** The code question names what each plugin brings (nodes, tools, checks, kits...), read statically in the module's text before anything runs.
2. **Stage 1 — the first real boundary: authoring-time code (done).** Tools and checks run in the per-project worker, with the reduced API: no free network beyond its own origin, no sockets, files and stills through the bridge. The frame path is untouched, so the preview pays nothing; GLSL effects, being data, stay where they are. The assistant's surface does not change: `use_tool` and `list_nodes` already speak in names and schemas. An archive's plugins are validated from the sandbox's declarations too: the import imports them in the worker, and the page never runs their code at import time. The sandbox's own document carries a CSP (`default-src 'none'; script-src 'self' blob:; connect-src 'self'`), so a dynamic import of a remote module is blocked by the platform, not just by convention. What stays open, said plainly: a module's load and its render-time code still run in the page (they draw). The command line keeps its own rule: plugins load in Node, with a local tool's rights.
3. **Stage 2 — render-time code, only when untrusted plugins must draw (done).** Every node draws in the worker: the engine sends the evaluated props, the frame's numbers, the simulation state computed on the page and the other layers' evaluated data, and one picture comes back per layer, transferred, drawn over the layer's bounds. The geometry crosses as data with it: the outline is built in the sandbox with a recording Path2D and arrives as SVG path data (rebuilt on the page for clips and the viewport), the handles as plain values, and a node's vector export (`svg`, `lottie`) is computed in the sandbox and primed before a conversion reads it. The first pass of a frame defers, so stills and exports keep waiting for the exact picture, and the preview draws the last picture while the fresh one crosses. Still on the page, documented: the module's load, the modifiers, the Canvas2D effects (their pixels would pay a round trip per effect, and stacked effects would need a batched pipeline contract), the stepping of simulations, and the command line's Node rights. Those all wait for one architectural decision — the evaluator and the effect pipeline moving into the worker, priced in [evaluator-sandbox.md](evaluator-sandbox.md) — not for five more patches.

The stages compose: each one is shippable alone, none is undone by the next, and the declaration half of every plugin (schemas, kits, presets, prompts, tours, GLSL) never needs to move at all.

## Limits of the worker

What the host enforces, the same in the browser, on the desktop and in the CLI (all three host the worker in the same sandboxed frame):

- Time: the frame must start within 10 seconds; a plugin loads within 15; checks, drawing, frames and vector exports finish within 30; tools within 120. A timeout terminates the worker and the next call gets a fresh one, whether or not the script cooperates.
- Size: a project module is at most 1 MiB, at most 64 plugins load, a worker answer is at most 8 MiB (64 MiB for a fetch body), a message to the worker at most 64 MiB, its graphics at most 256 MiB, a canvas at most 8192 pixels a side. Archive, package and backup readers refuse oversized or over-expanding input before inflating it.
- Concurrency: at most 64 calls wait at once; the next is refused.

What no web platform lets the host enforce: a hard memory cap or a CPU quota on a worker. A script can allocate until the browser or the webview reclaims the tab or kills the process, and it can use a core until its deadline ends it. The size limits above bound what crosses the boundary, not what the worker allocates inside it. Only the deadline and the size limits are promised; a memory cap is not.
