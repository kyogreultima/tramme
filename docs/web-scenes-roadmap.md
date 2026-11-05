# Web scenes roadmap

How the assistant writes real web (HTML, CSS, JS, GSAP, Three.js) inside one layer of a film, with the freedom [HyperFrames](https://github.com/heygen-com/hyperframes) gives, and keeps what Tramme already has: a structured document, undo, takes to compare, and a correction that touches one part only.

Status: **planned, not started.** Step 0 decides the rest. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

The vocabulary of layers is closed. The only way out is the `code` node (`packages/nodes/src/misc.ts`), which draws on a Canvas 2D context: no DOM, no CSS layout, no SVG, no GSAP, no Three.js. The assistant must either assemble the existing nodes or write Canvas by hand, where HyperFrames lets it write the language it knows best. That ceiling, more than the prompts, limits what a film can look like.

The freedom goes in one layer, not in the whole format. Making HTML the source of truth would lose the scene graph, the generated inspector, the modifiers, the Lottie and SVG exports, the checks by structure and part of the assistant's tools.

## What HyperFrames does (read from its code, v0.9.13)

- A video is an HTML file; a paused timeline (`window.__timelines`, GSAP) or a page that exposes `window.__hf.seek(t)` and a duration is the contract.
- Headless Chrome seeks each frame (`HeadlessExperimental.beginFrame` on Linux, `Page.captureScreenshot` elsewhere), FFmpeg encodes. Seek adapters exist for GSAP, Three.js, Lottie, D3, WAAPI, CSS, Anime.js, Leaflet, Mapbox and others.
- A `<video>` is not captured as such: FFmpeg extracts its frames and they are injected, because a video element is not deterministic.
- Apache 2.0. `@hyperframes/engine` installs on its own from npm (a compiled `dist`); `ffprobe` is required next to `ffmpeg`.

## What the test showed

A scene with GSAP, flexbox, an animated SVG stroke, a CSS gradient and a rotation, rendered twice with `hyperframes@0.9.13` (`render --format png-sequence`, 1280x720, 30 fps, 90 frames): **90 of 90 frames identical byte for byte**, PNG with transparency, 16 to 20 s with one worker, Chrome start included. Not tested: Three.js, Lottie, `<video>`, audio, the preview in the editor.

## Principles

- A scene is a folder in the project. One scene, one set of files: a correction rewrites those files only, as an undoable operation.
- Rendering stays a function of time: a scene that cannot be seeked is refused by a check, not shipped.
- No scene runs outside the isolation boundary of [safe projects](safe-projects-roadmap.md). Until it holds, scenes are for the user's own projects.
- The project's tokens reach the scene (CSS variables); a scene does not invent its own palette.
- HyperFrames is called as a tool, with its version pinned, until step 0 says it can be a dependency.

## Steps

### Step 0: prototype and measure

- [ ] A `webscene` node that points at a scene folder, rendered on export by the HyperFrames engine to alpha PNG and composed with the other layers.
- [ ] The preview in an iframe seeked to `t` with the same contract.
- [ ] Three scenes (GSAP, SVG and CSS; a custom font; Three.js) compared preview against export with `tramme compare` (PSNR).
- [ ] Decision written here: reuse the engine (preview within a small PSNR gap), reuse it with documented limits, or write Tramme's own capture and take only the adapters that matter.

### Step 1: format

- [ ] Manifest (`scene.json`): duration, size, entry file, parameters.
- [ ] JSON schema, validation, allowed paths in `tramme-project/1`, `.tramme` pack and unpack.
- [ ] A scene survives an export then an import of an archive.

### Step 2: contract and adapters

- [ ] `window.__hf.seek(t)` and duration; adapters for CSS and WAAPI, GSAP, SVG, Lottie, Three.js.
- [ ] A linter that refuses what breaks determinism: free `Date.now`, `Math.random`, `fetch`, `requestAnimationFrame`.
- [ ] `tramme check` reports a scene's errors in readable form.

### Step 3: export

- [ ] Alpha frames composed by the compositor (blend, effects, motion blur, finishing).
- [ ] A cache keyed by the hash of the folder and the parameters: only the changed scene renders again.
- [ ] `ffprobe` bundled like `ffmpeg-static`; one Chrome for the CLI; the engine version pinned; the licence in the credits.
- [ ] Works with `--pages n` (parallel export).

### Step 4: faithful preview

- [ ] Iframe seeked to `t`; fallback on pre-rendered frames when the gap is too large.
- [ ] A parity test, preview against export, in the test suite with a PSNR threshold.

### Step 5: isolated execution

Needs the boundary of [safe projects](safe-projects-roadmap.md).

- [ ] The scene runs in an opaque-origin iframe: no network, no access to the editor's DOM, storage or keys.
- [ ] Assets reach it through explicit host calls only.
- [ ] Adversarial tests specific to scenes (escape through `postMessage`, remote imports, nested frames).

### Step 6: versions and the assistant

- [ ] Tools `write_scene`, `edit_scene` (patch one file) and `check_scene` (lint and stills).
- [ ] Every change is a take, comparable and undoable per scene.
- [ ] Guidance for writing a web scene (structure, the seek contract, what to avoid), in the assistant's prompt.
- [ ] "Fix the title of scene 3" changes that scene's files and nothing else (tested).

### Step 7: editor

- [ ] A code view of the scene.
- [ ] The manifest's parameters appear in the generated inspector and can be animated like any property.
- [ ] A bar in the timeline, thumbnails.

### Step 8: media and brand

- [ ] Project tokens injected as CSS variables.
- [ ] Project fonts and images available to the scene.
- [ ] `<video>` by frame extraction; the scene's sound goes to the mixer.

### Step 9: platforms

- [ ] CLI and desktop first (Chrome sidecar on desktop).
- [ ] Web editor: a rendering service behind the Worker, or export reserved to desktop and CLI, written in Known limits.

### Step 10: measure

- [ ] Replay the bench of [taste-finish-roadmap.md](taste-finish-roadmap.md) with web scenes against the `marketing` reference, scored blind.

## Risks

- The preview can differ from the export: the same engine for both is a principle of Tramme, and an iframe is not that engine.
- The HyperFrames engine is a 0.9.x release; its API can change.
- A browser alone has no headless Chrome.
- Steps 5 and 9 delay a public opening, not local use.
