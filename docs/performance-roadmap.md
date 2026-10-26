# Performance roadmap

How Tramme renders faster without leaving its stack: measure where a frame's time goes, export in parallel, prepare the Evaluator for documents with hundreds of instances, and move to WebGL or to Rust compiled to WebAssembly only what a measure points at.

Status: steps 1 and 5 done (the breakdown per frame, the load cases and `tramme load`; a pool of readers per video file, one asset per file), step 2 done (a parallel export: `tramme render --pages n`, segments joined without encoding again, frames identical to one page's, simulations included; 1.2× here on 4 cores and a software GPU), step 3 done (the Evaluator for many instances: 400 instances under a time field evaluated in 12 ms a frame instead of 29, in Node; the `instances` load case); step 4 done (what the measures pointed at: the Canvas 2D filters run over the layer's box instead of the whole frame, the `effects` case 27.4 s → 6.8 s a frame with the same pixels; nothing called for Rust); figures taken on a laptop with a GPU (step 1's second table), those of a machine with 8 cores or more are still to take for step 2. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Where things stand

- The export already converts to YUV on the GPU: `readPixels` hands back ffmpeg's rawvideo yuv420p (`packages/render/src/compositor.ts`), no conversion on the CPU.
- One frame is in flight on the WebSocket while the next renders (double buffer, `capture` in `packages/cli/src/page.ts`).
- The Evaluator caches static properties across frames (`packages/core/src/evaluate.ts`).
- The time per frame is measured, as a total only.
- One page renders every frame of an export in order (`packages/cli/src/jobs.ts`).
- An asset is stored once and referenced by id: every layer that uses it points to it, and the renderer loads and decodes it once (`packages/render/src/assets.ts`). A video asset has one decoder, with one read position, shared by all its layers (`packages/render/src/video.ts`).

## Principles

- **Measure before changing.** Every step after the first states the figure it should move, and is checked against it.
- **Rendering stays a pure function of time.** It is what makes parallel export and caching safe; nothing here may break it.
- **Same pixels.** An optimisation is done when the export it produces is identical frame by frame to the one before it, or the difference is understood and accepted.
- **Rust where measured, through WebAssembly.** A hot spot moves to a module called from TypeScript, the same in the editor, the export and the worker; never a second implementation of the engine.

## Steps

### Step 1. Where a frame's time goes

- [x] `capture` times each frame's parts apart: evaluation, drawing, GPU readback, waiting for the send. The breakdown is reported next to the existing `ms/image`.
  The parts are `evaluate`, `draw`, `video` (waiting for decoded frames, which the box did not name but the step's "Done when" asks for), `readback` and `send` (`packages/render/src/timing.ts`). The GPU works asynchronously: its share of a frame is paid at `readPixels` and lands in `readback`, not in `draw`. A frame drawn by the plugin sandbox counts no evaluation or drawing on the page.
- [x] Load cases in `bench/`: many layers, blurs and effects, a 4K source video, a simulation (particles, cloth), and later a distribution of hundreds of instances.
  In `bench/load/cases.ts`: `layers`, `effects`, `video4k` (its 4K file made by ffmpeg on the first run, not kept in the repository) and `simulation` (particles, cloth, a rope and a flock). Left out: the distribution of hundreds of instances, which waits for the distributions of the components roadmap; it is added with them, before step 3.
- [x] A command that runs them and prints the breakdown, so a change is compared before and after.
  `tramme load [case…] [--frames n] [--json file] [--before file]`: a line per case with the parts per frame and what holds it back; `--json` keeps the figures, `--before` prints each one with its change. To check on a device: the figures here come from a container without a GPU (Chrome's software GL), where the readback weighs on every case; the reference figures are to be taken on a machine with a real GPU.

Done when: for each load case we can say whether the bottleneck is the JavaScript, the GPU, video decoding or the transfer.

First figures, 15 frames per case, in a cloud container without a GPU (Chrome's software GL and canvas), ms per frame:

| case | frame | evaluate | draw | video | readback | send | held back by |
|---|---|---|---|---|---|---|---|
| `layers` | 341 | 4.0 | 28 | 0 | 251 | 44 | the GPU |
| `effects` | 40,236 | 2.3 | 39,618 | 0 | 543 | 56 | the JavaScript (Canvas 2D filters drawn by the processor) |
| `video4k` | 501 | 0.2 | 41 | 36 | 361 | 46 | the GPU |
| `crossfade4k` | 666 | 0.6 | 83 | 121 | 372 | 61 | the GPU |
| `simulation` | 331 | 0.2 | 40 | 0 | 233 | 42 | the GPU |

Without a GPU, the readback weighs on everything, and the filters of the `effects` case cost 40 s a frame: these figures say where to look on such a machine, not on a user's. The reference figures are to be taken with a real GPU (`tramme load --json`), before step 4 picks anything to move.

Figures with a real GPU, 15 frames per case, after steps 3 to 5, on a modest laptop (Windows 11, Chrome 155 headless on ANGLE/D3D11, an Intel HD 620, an i5-7300U with 2 cores and 4 threads), ms per frame:

| case | frame | evaluate | draw | video | readback | send | held back by |
|---|---|---|---|---|---|---|---|
| `layers` | 140 | 5.0 | 25 | 0 | 29 | 67 | the transfer |
| `effects` | 8,716 | 2.3 | 8,616 | 0 | 35 | 50 | the JavaScript (Canvas 2D filters) |
| `video4k` | 112 | 0.3 | 2.5 | 5.3 | 47 | 45 | the GPU |
| `crossfade4k` | 159 | 0.5 | 2.6 | 21 | 67 | 55 | the GPU |
| `simulation` | 133 | 0.3 | 36 | 0 | 28 | 57 | the transfer |
| `instances` | 132 | 1.4 | 33 | 0 | 27 | 58 | the transfer |

With a GPU the readback falls from 230–370 ms to 27–67 ms, and sending the frame to ffmpeg becomes the largest part of most cases. The `effects` case stays far above the others: an export draws in Canvas 2D on the processor by design (`raster: 'cpu'`, exact antialiasing; the editor's preview uses `'gpu'`), so its filters run on the processor even with a GPU. The 4K sources were VP9 made by ffmpeg.

### Step 2. Parallel export

- [x] The film cut into N segments rendered by N pages of the same Chrome, each encoding its segment; the segments joined by ffmpeg without re-encoding (cuts on keyframes).
- [x] N bounded by memory (each page opens its own video decoders) and by the GPU; a sensible default from the machine, overridable.
- [x] Simulations started mid-film: check that `particles`, `cloth`, `rope` and `flock` give at frame k the same result whether rendering started at 0 or at k; fix those that keep state across frames.
- [x] Sound mixed once over the whole film, not per segment.

Done when: an export with N pages is identical frame by frame to the sequential one, and faster by close to N on a multi-core machine for the load cases.

### Step 3. The Evaluator for many instances

- [x] A per-frame cache of values by `(address, t)` for the calls through `base(t)`: `smooth` already makes 9 per value, `timeField` over hundreds of instances will make many more (`docs/components-roadmap.md`).
- [x] The instances of a distribution evaluated in batches into typed arrays rather than object by object: the shape that suits a WebAssembly module if step 1 calls for one.

Done when: a distribution of several hundred instances with a time field stays within the frame budget of the editor's preview.

### Step 4. What the measures point at

- [x] Layers costly in Canvas 2D (blurs, shadows, compositing) drawn through WebGL2, later WebGPU.
  Done otherwise: the measure did not point at the drawing API but at the area. Each layer with effects is drawn alone on a canvas the size of the frame, and its filters (`blur`, `drop-shadow`, the glow's shadows) ran over all of it, on the processor where Chrome has no GPU raster: 26.7 s of the `effects` case's 27.4 s a frame. They now run over the layer's box on the canvas, grown by a margin for its ink (48 px and 5 % of its size, in its own pixels) and by what each filter spreads (`canvas2d.reach`, a new optional field of an effect), and clipped to it, since Skia sizes a filter's layer by the clip (`filterBox`, `packages/render/src/canvas2d.ts`). Anything that cannot say where it draws keeps the whole frame: a node without bounds, a simulation, a nested composition, a child with effects of its own, an effect drawn by code or GLSL, or a filter without a reach. Measured on `effects` (3 frames, software GL): 27,351 → 6,765 ms a frame (−75 %), drawing 26,710 → 6,076 ms. Same pixels: three stills of `effects`, with a rotated rectangle with a 60 px stroke and a scaled text with a shadow and a glow added, are identical to before (PSNR ∞, no pixel differs). Moving the blurs to WebGL2 would change their pixels for a gain the measures no longer ask for; it is left until the figures of a machine with a GPU say otherwise. On a laptop with a GPU (the second table of step 1): 27,151 → 6,102 ms a frame on `effects` (3 frames, −78 %), the same gain, since exports draw their filters on the processor there too; 16 stills of the three examples are identical before and after (PSNR ∞). A Canvas 2D filter on the GPU raster (the preview's) costs about a tenth of the processor's in that Chrome (the chain of `effects`, one layer: 40 ms against 521 over the frame, 12 against 167 over its box): the preview's figure for this case is to be read in the editor.
- [x] Hot spots in Rust compiled to WebAssembly, only those step 1 shows: simulations, noise in bulk, sound analysis. One module, called from TypeScript, working in the editor, the export and the worker; native through Tauri on the desktop if it helps.
  Measured, and not called for. Evaluating costs 0.2 ms a frame for `simulation` (its drawing 40 ms and its readback 233 ms), 4 to 6 ms for `layers`' 400 shapes, and 12 ms for the 400 instances of step 3 once batched. Nothing written in JavaScript holds a case back; the GPU readback and, before this step, the filters do. No module is written; the typed arrays of step 3 are the shape one would take.

Done when: each move is justified by a figure from step 1 and improves it, with the same pixels.

### Step 5. Media used in several places

- [x] A pool of decoders per video asset: one reader per play position in use, so two layers showing the same file at different moments at the same instant (a transition between two shots of one take, a split screen, the cut-out's footage drawn over itself, the clips of a cut overlapping) each read forward instead of making the one decoder seek back and forth at every frame. Bounded (a few readers per file, the least recently used closed), the frames of one reader shared when two layers ask for the same moment.
  `packages/render/src/video-pool.ts`: three readers per file at most, each with its own decoder, its own six kept frames and its own ring of canvases (a kept frame is never overwritten by another reader). Measured on `crossfade4k` (30 frames, software GL): waiting for video 359 → 84 ms a frame (-77 %), the frame 831 → 584 ms (-30 %). Same pixels: `video4k` (one layer) exports identical frames; `crossfade4k` does not, and the new frames are the right ones: the single decoder kept its frames sorted by time and dropped the earliest when the other layer's arrived, so a layer was drawn with a frame of the other shot (frame 20 showed 4.533 s on the first shot, which plays 0.633 s). To check on a device: the crossfade playing in the preview at 30 fps with a real GPU.
- [x] The same file imported twice becomes one asset: a hash of its content computed at import, an import of a file already in the project answered with the existing asset (its id returned, nothing written), for the editor, the assistant's attachments and the sources of a film alike.
  The hash is kept on the asset (`hash`, an optional field added to the format): SHA-256 of the whole file up to 64 MB, of its size and 32 evenly spread slices above (`apps/editor/src/hash.ts`), so a long video is not read into memory. Left out: assets imported before this version carry no hash and are not matched; files written by tools (stills, cut-outs, sounds) are not imports and keep their own paths.

Done when: a load case of step 1 with a crossfade between two shots of the same 4K file plays in the preview at the composition's frame rate where it stuttered before, with the same pixels on export; and importing the same video twice leaves one file in the project.
