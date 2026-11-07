# Web scenes roadmap

How the assistant writes real web (HTML, CSS, JS, GSAP, Three.js) inside one layer of a film, with the freedom [HyperFrames](https://github.com/heygen-com/hyperframes) gives, and keeps what Tramme already has: a structured document, undo, takes to compare, and a correction that touches one part only.

Status: **in progress (22 open, 10 done).** Step 0's prototypes and step 1's format are complete. Step 2 has a static determinism linter, readable CLI checks and browser-tested seek adapters. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

The vocabulary of layers is closed. The only way out is the `code` node (`packages/nodes/src/misc.ts`), which draws on a Canvas 2D context: no DOM, no CSS layout, no SVG, no GSAP, no Three.js. The assistant must either assemble the existing nodes or write Canvas by hand, where HyperFrames lets it write the language it knows best. That ceiling, more than the prompts, limits what a film can look like.

The freedom goes in one layer, not in the whole format. Making HTML the source of truth would lose the scene graph, the generated inspector, the modifiers, the Lottie and SVG exports, the checks by structure and part of the assistant's tools.

## What HyperFrames does (read from its code, v0.9.13)

- A video is an HTML file; a paused timeline (`window.__timelines`, GSAP) or a page that exposes `window.__hf.seek(t)` and a duration is the contract.
- Headless Chrome seeks each frame (`HeadlessExperimental.beginFrame` on Linux, `Page.captureScreenshot` elsewhere), FFmpeg encodes. Seek adapters exist for GSAP, Three.js, Lottie, D3, WAAPI, CSS, Anime.js, Leaflet, Mapbox and others.
- A `<video>` is not captured as such: FFmpeg extracts its frames and they are injected, because a video element is not deterministic.
- Apache 2.0. `@hyperframes/engine` installs on its own from npm (a compiled `dist`); `ffprobe` is required next to `ffmpeg`.

## What the test showed

A scene with GSAP, flexbox, an animated SVG stroke, a CSS gradient and a rotation, rendered twice with `hyperframes@0.9.13` (`render --format png-sequence`, 1280x720, 30 fps, 90 frames): **90 of 90 frames identical byte for byte**, PNG with transparency, 16 to 20 s with one worker, Chrome start included. Later low-level engine prototypes tested Three.js, Lottie, WAAPI, CSS/SVG and GSAP with iframe preview; see the measurements below. Still untested: `<video>`, audio and the preview in the editor.

## Principles

- A scene is a folder in the project. One scene, one set of files: a correction rewrites those files only, as an undoable operation.
- Rendering stays a function of time: a scene that cannot be seeked is refused by a check, not shipped.
- No scene runs outside the isolation boundary of [safe projects](safe-projects-roadmap.md). Until it holds, scenes are for the user's own projects.
- The project's tokens reach the scene (CSS variables); a scene does not invent its own palette.
- HyperFrames is called as a tool, with its version pinned, until step 0 says it can be a dependency.

## Steps

### Step 0: prototype and measure

- [x] A `webscene` node that points at a scene folder, rendered on export by the HyperFrames engine to alpha PNG and composed with the other layers. The node is now built into `@tramme/nodes`; the [step 0 CLI prototype](../bench/web-scenes/README.md) invokes pinned `@hyperframes/engine@0.9.13`, builds a temporary valid `.tramme` document, and renders six distinct composited PNG frames with Tramme's existing CLI. At a transparent scene pixel, the exported picture shows the underlying Tramme rectangle. Frame capture and injection still use a prototype command in `bench/`; ordinary export flow is step 3 work.
- [x] The preview in an iframe seeked to `t` with the same contract. The [step 0 preview page](../bench/web-scenes/preview.html) hosts the scene in a real iframe, exposes `webscenePreview.seek(t)` and a time slider, and calls the scene's `window.__hf.seek(t)`. The comparison harness uses that API for every measured frame. It is a standalone prototype; wiring it into the editor and adding a frame fallback are step 4 work.
- [x] Three scenes (GSAP, SVG and CSS; a custom font; Three.js) compared preview against export with `tramme compare` (PSNR). See [the reproducible prototype](../bench/web-scenes/README.md): six frames at 320×180 and 6 fps per scene, iframe preview against the pinned engine's alpha PNG output. Minimum PSNR: 31.86 dB (GSAP), 33.14 dB (CSS/SVG with Geist), 45.04 dB (Three.js). All 18 export frames changed over time, and each six-frame sequence repeated byte for byte. Headless Chrome 152 (engine) and Chrome 156 (preview) were used on Windows; this is a prototype measurement, not the editor node or its integration test.
- [x] Decision written here (user, 2026-11-06): reuse the pinned low-level `@hyperframes/engine` with documented iframe-preview limits. The engine's seek capture worked for the GSAP, CSS/SVG with custom font and Three.js prototypes, while `hyperframes@0.9.13 render` froze the custom-seek scene at its initial pose. The measured minimum preview/export PSNR was 31.86, 33.14 and 45.04 dB respectively with different Chrome versions. Pin the engine in CLI/desktop integration, keep the iframe preview explicit about pixel differences, and use pre-rendered frames where step 4 finds the gap too large. Do not use the higher-level CLI render path for custom-seek scenes.

### Step 1: format

- [x] Manifest (`scene.json`): duration, size, entry file, parameters. A scene lives at `scenes/<id>/scene.json`; its typed parameters carry defaults. See `SceneSchema` in `packages/project/src/scene.ts`.
- [x] JSON schema, validation, allowed paths in `tramme-project/1`, `.tramme` pack and unpack. `schema/webscene-1.schema.json` is generated from the same schema used by `checkProject`. The project format admits scene HTML, CSS, scripts, fonts and media beneath a valid scene ID; the manifest's entry must be a present HTML file in that folder.
- [x] A scene survives an export then an import of an archive. The project-format test compares its manifest and entry bytes after `packProject` and `unpackProject`, then validates the restored project.

The five seek prototypes now carry `scene.json`. The built-in-layer CLI prototype writes a complete project manifest; `tramme pack` and `tramme unpack` accepted its 12-file CSS/SVG project, including the Geist font's OFL notice. Ordinary scene capture still needs step 3 integration.

### Step 2: contract and adapters

- [x] `window.__hf.seek(t)` and duration; adapters for CSS and WAAPI, GSAP, SVG, Lottie, Three.js. `sceneController` exposes the absolute-time contract; all five browser prototypes produced six distinct frames, and a second capture of each was byte-identical. The [prototype measurements](../bench/web-scenes/README.md) show the remaining iframe preview differences. Ordinary editor and export integration remain in steps 3 and 4.
- [x] A linter that refuses what breaks determinism: free `Date.now`, `Math.random`, `fetch`, `requestAnimationFrame`. The CLI parses local JavaScript and inline HTML scripts without executing them, detects unbound global access and common aliases, and rejects syntax errors. It refuses a script over 1 MiB before parsing. This is a static seekability check, not an isolation boundary; dynamic code and browser behavior still need step 5's boundary and tests.
- [x] `tramme check` reports a scene's errors in readable form. It prints `scenes/<id>/<file>:<line>` and the offending API; `tramme pack` also refuses a scene that fails the linter. The CLI integration test checks both commands.

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

Browser limit (2026-11-07): a visual export containing a `webscene` now stops with a clear message before the editor starts rendering. The Known limits section points to the CLI prototype. Ordinary CLI and desktop capture remain open, so the platform box is still unchecked.

- [ ] CLI and desktop first (Chrome sidecar on desktop).
- [ ] Web editor: export reserved to desktop and CLI, written in Known limits, with a clear message where a web scene is exported from the web editor. Decided (2026-11-05): no rendering service for now, which would be a server to run; one can be added later if wanted.

### Step 10: measure

- [ ] Replay the bench of [taste-finish-roadmap.md](taste-finish-roadmap.md) with web scenes against the `marketing` reference, scored blind.

## Risks

- The preview can differ from the export: the same engine for both is a principle of Tramme, and an iframe is not that engine.
- The HyperFrames engine is a 0.9.x release; its API can change.
- A browser alone has no headless Chrome.
- Steps 5 and 9 delay a public opening, not local use.
