# To validate on a computer

What the roadmap loop could not check in its cloud container (no GPU, no
H.264 in its Chromium, no access to the model hub, no phone), gathered as it
goes. Each line names the box it comes from and how to check it. Nothing here
blocked a box; the loop listed it and went on.

## Before anything

```
git checkout feat/roadmap-loop
npm ci
npm run typecheck && npm test
```

The tests the loop ran passed in the container (with the GTK and WebKit
development libraries installed for the desktop storage test). On a
computer (Windows 11, Chrome, an Intel HD 620, 4 cores), with
`CHROME_PATH` set, all 667 pass; the parallel export's test read
ffmpeg's first progress line (`frame=0` on a slower machine) and now reads
its last.

## Performance

- **Step 1 — reference figures.** Taken on a laptop with a GPU (Intel HD
  620, Chrome 155): the second table of step 1 in
  `docs/performance-roadmap.md`. The readback falls to 27–67 ms a frame;
  `effects` stays at 8.7 s, because an export draws its filters on the
  processor by design (`raster: 'cpu'`). Worth taking again on a machine
  with a dedicated GPU.
- **Step 1 — the 4K cases in H.264.** Done with Chrome: the 4K source of
  `video4k` and `crossfade4k` transcoded to H.264 (High) in its place.
  Waiting for video moves by 1 to 4 ms a frame (5.3 → 6.5, 21 → 25): the
  figures hold. Left: a real phone file (HEVC, variable frame rate).
- **Step 5 — the crossfade in the preview.** Open the `crossfade4k` case
  (`tramme load crossfade4k --frames 1 --out ~/tramme-load`, then the folder
  `~/tramme-load/crossfade4k` in the editor) and play it: it should hold
  30 fps where `develop` stuttered. In the container, waiting for video went
  from 359 to 84 ms a frame on export.
- **Step 5 — one asset per file.** In the editor: import the same video twice
  from the assets panel (a toast says it is already there, one file in the
  project); attach the same picture twice to the assistant; make a new project
  from a folder holding a file and its copy (one asset). A video over 64 MB is
  hashed by slices: check that importing a long video stays quick.

## Editing

The container could not reach the model hub (huggingface.co was refused by
its network policy) and has no GPU: no model was downloaded or run there.

- **Step 1 — the Models section.** Settings → Models, in English and in
  French: five rows (two for the cut-out), each with its default; choose
  another and run its tool (cut-out on a short clip, `detect` or `track`,
  `depth` on a photo, a transcription).
- **Step 1 — the catalogue, model by model.** Done on a computer
  (2026-10-20): every model of `apps/editor/src/models.ts` is `checked`. Each
  file was downloaded from the hub, hashed, and run with the catalogue's
  adapter in Node (onnxruntime-node, transformers.js on the processor, the
  `cpu` dtype), the face landmarker in Chrome on the GPU. What it found:
  - `BritishWerewolf/U-2-Net-Human-Seg` held U²-Netp's file (4.6 MB, the same
    SHA-256 as `BritishWerewolf/U-2-Netp`): the default cut-out of a person
    was the small general network. It now reads `jellybox/u2net-human-seg`
    (Apache-2.0), byte for byte rembg's `u2net_human_seg.onnx` (176 MB), at a
    pinned commit; on a man leaning on a car it keeps the man and not the car,
    where U²-Net and IS-Net keep both.
  - `BritishWerewolf/U-2-Net` and `IS-Net` are rembg's `u2net.onnx` and
    `isnet-general-use.onnx` byte for byte; pinned to their commits, like
    Silero VAD's file. The IS-Net adapter gives clean mattes (hair strands
    kept).
  - `onnx-community/whisper-large-v3-turbo` has no cross attentions in its
    export: transformers.js refuses word timestamps with it, so the editor
    could not use it. The catalogue now reads
    `onnx-community/whisper-large-v3-turbo_timestamped`, which times the
    words; its q8 download is about 1090 MB, not 1600.
  - The Hugging Face Whisper ports' model cards say Apache-2.0 (OpenAI's
    release says MIT): the catalogue follows the cards.
  - Silero VAD (`onnx-community/silero-vad`) is v5: `input`, `state`, `sr`
    in, `output`, `stateN` out, as `sileroVad()` reads it; the speech of
    `jfk.wav` was found phrase by phrase.
  - Detection (YOLOS small, DETR ResNet-50 and 101), depth (v1 small, v2
    base) and Whisper base and tiny answer right on test pictures and
    speech. Sizes in `mb` match the files (the mattes in MiB).
  Not run: the browser's WebGPU path of each pipeline (fp32 on the GPU), and
  Whisper turbo's fp32 encoder (2.5 GB, external data) on WebGPU.
- **Step 1 — a model hub id.** Settings → Models → Other models: type a
  detection model (`Xenova/detr-resnet-101`, say) and Try and use; it should
  download, answer, and become the row's choice. A wrong id should say why.
- **Step 1 — downloads and the cache.** Settings → Models: Download now on a
  row (the percentage moves, then "In this browser" with its weight); run its
  tool, nothing downloads again; Delete, the row says "Not downloaded"; pick
  another model, the former one shows under "In this browser" with Delete.
  Checked in the container with fake files put in the cache, never with a
  real download.
- **Step 1 — transcription by every path.** With the companion running
  (`npm run tramme -- agent`), choose Whisper base in Settings → Models and
  transcribe a clip: the companion's log should load `Xenova/whisper-base`;
  with `TRAMME_WHISPER_MODEL` set, that one instead. Then, in the desktop app
  or `npm run dev:personal` without a companion and without a server route,
  transcribe again: the progress says "in this browser" and the words come.
- **Step 1 — what made an asset.** After a cut-out, a depth, a track of a
  named object and a transcription, open `document.tramme.json`: each new
  asset has `madeBy` (the cut-out of a person: the matte and the detector).
  Change the model in the settings: the asset and its render stay as they
  were until the tool runs again.
- **Step 2 — a speed ramp, seen.** A video layer with rate keyframes 1 →
  0.3 → 1 over two seconds: the preview slows and speeds up smoothly; an MP4
  export (`tramme render`) shows the same frames (`tramme still` at a few times
  against the preview); a callout made by `track` on that video stays on its
  subject through the ramp; captions with `follow` on the video stay on the
  words. Rate 0 freezes; a negative rate plays backwards and stops at the
  file's first frame.
- **Step 2 — the sound on a ramp.** Play the ramped video with its sound in
  the preview: the voice slows and drops with the picture, without a gap; an
  MP4 export sounds the same. A video at a fixed 0.5 speed now sounds lower in
  the preview as in the export (the browser used to keep its pitch).
- **Step 2 — the speed presets.** Select a video layer, open Curves: the
  Speed row writes each preset around the playhead (checked in the container
  on a layer without a real file); play each one and judge its feel.
- **Step 3 — transitions, on footage.** `CHROME_PATH=… npx vitest run
  packages/cli/test/render-effects.test.ts` renders every kind (it ran in the
  container with Chromium's software GL, and passes on a computer with
  Chrome and its GPU). Then on two real clips that overlap:
  each kind in the preview and an export, and the glitch, whose rows only show
  on a picture with detail.
- **Step 3 — the sound of a transition.** Two clips with speech or music
  joined by a crossfade: the level holds through the window (no dip, no
  bump), the outgoing sound is gone after it; with Sound crossfade off, both
  play as they are.
- **Step 3 — a transition from the timeline.** Two video clips cut end to
  end: the second clip's menu → Transition from the shot before… → Push: the
  clips overlap around the cut, the band shows; drag its edge, the overlap
  follows. A clip that starts at the very beginning of its file, against a
  first one at the very end of its own: the toast says how much is missing.
  (Checked in the container on two shapes, without video files.)
- **Step 4 — the key on real footage.** A green-screen clip with
  `fx.key`: the screen gone in the matte view with the default tolerance or a
  little more; hair keeps its strands, spill takes the green off them; choke
  for a hard edge. Its rendered test ran in the container on drawn shapes.
- **Step 4 — the dropper.** On a keyed clip, the target button beside Key
  colour, then a click on the screen in the viewport: the colour is the
  screen's (the key is off while picking); Escape cancels. Try it on a
  phone too (a tap).
- **Step 5 — masks.** Inspector → Masks → + on a video layer: a rectangle
  over it; change mode, feather, expansion, invert, add a second one in
  subtract, and see the picture follow; an export shows the same.
- **Step 5 — masks in the viewport.** Select a masked layer: its masks'
  vertices show; drag one, Alt+click the outline to add one, Delete removes
  the selected one; with two masks, Delete takes from the one clicked.
- **History.** Commit `f466b6a` alone does not typecheck (a label declared
  twice); `ef9f34f`, right after it, fixes it. Every other commit passed the
  checks before it was pushed.
- **Step 5 — a mask on a tracked object.** Track a moving object (track
  tool), draw a mask around it at a moment it shows, then Follow a track on
  the mask: it stays on the object as it moves. A rotated layer drifts (only
  its scale is counted).
- **Step 6 — a real LUT.** Import a camera's log-to-Rec.709 `.cube` (33³ or
  65³) and a look LUT; `fx.lut` on log footage at strength 1: the picture
  looks like the camera's own conversion. In the desktop app too (`.cube`
  added to its store's allowed files).
- **Step 6 — curves.** An adjustment layer with `fx.curves`: drag the
  master curve's points (a contrast S), add one, double-click to remove it;
  pull the blue curve down for a warm cast. On a phone, the square takes a
  finger (its points are small).
- **Step 6 — wheels.** An adjustment layer with `fx.wheels`: the gain toward
  orange warms the highlights, the lift toward teal cools the shadows (the
  classic look); double-click a wheel to reset it. Judge the strength of the
  wheels against a colourist's tool (lift ×0.25, gamma and gain ×0.5 per unit).
- **Step 6 — scopes.** Select a layer with a grading effect: the waveform and
  the vectorscope show in the viewport's corner and follow the grade and the
  time; on a phone they shrink. Compare with a known colour chart (skin tones
  on the vectorscope's skin line, between red and yellow).
- **Step 7 — stabilisation on real footage.** A handheld phone clip: run
  `stabilize` (the / menu or the assistant), then play it: the shake gone, a
  pan kept, no breathing zoom; `lock` on a tripod-like shot; a clip with a
  cut in it does not drift across the cut. Measured in the container on a
  synthetic shake only.
## Editing, steps 7 to 9

- **Step 8 — proxies.** Import a 4K or 60 fps phone video in the assets
  panel on a modest computer: the question comes (and not for a 1080p file
  on a fast one); make the proxy, the preview plays smoothly; Settings →
  Preview → Play proxies off: the original plays again; an export uses the
  original (its size and sharpness).
- **Step 9 — voices, heard.** A voice-over with each voice (pitch ±5
  semitones, robot, telephone, radio, megaphone, echo) in the preview and in
  an MP4 export: the same sound; a speech clip at 0.7× with Keep the pitch:
  slow but at its pitch. Listen for the shifter's grain on deep voices.

## Components, step 1

- **Instances in the editor.** Open a project with a component (a
  composition with `params`) held by a few comp layers with different
  `params` and `overrides` (written by hand or by the assistant): the
  preview, a still and an MP4 export show each instance with its values;
  change the component (its plate colour, a layer's keyframes): every
  instance follows, except what one overrides. The inspector has no
  parameter fields yet (step 5); it shows the comp node's own props.
- **Detach.** Only in `@tramme/core` for now (`detachPlan`; the tool and the
  button come with steps 4 and 5). Rendered identical to the instance in
  Chrome at four times, within 2 levels; check on a device's GPU path too.
- **Styles.** A document with `styles` (a look, a keyframed entrance) applied
  to layers with `at`: they animate from `at`. The inspector shows the
  layer's own values, not the style's (step 5 marks them).

## Components, step 2

- **A distribution in the editor.** A comp layer with `distribute` (a grid
  of 40 cards, the palette in order, a title from `index`): the preview
  plays it smoothly enough on a laptop (each instance is a composition read
  per frame; the Evaluator for many instances is Performance step 3), the
  selection box takes all the instances, an export matches the preview.
- **Rows of data.** A JSON asset of rows (an array of objects) imported, a
  distribution with `rows` and `row.name` in a rule: one card per row.
- **Not yet:** detaching a distribution (refused, `distributed`), editing
  the layout in the inspector (step 5).

## Components, step 3

- **The time field, seen.** On a grid of 40 cards (a distribution with
  `time: { mode: 'distance', amount: 0.8 }`): a ripple from the centre in the
  preview and an export; `noise` with `speed` 0.3 looks liquid, not
  jittery; animate the seed in the inspector (the parameter shows
  Animated): no frame jumps. Judge the amounts the assistant notes (0.3 to
  1.2 s across the field) on real briefs.
- **The modifier block in the inspector.** Add Time field to a property:
  the By segments (Rank, Direction, Distance, Noise), the Loop toggle and
  the Centre fields show in EN and FR.

## Components, step 4

- **The bench brief.** Ask the assistant for "a grid of forty product cards
  in the palette entering as a wave from the centre": it should write one
  card, `define_component`, then one `instantiate` with a grid, a palette
  rule and a time field. Compare the tokens written with a run before this
  branch (the roadmap's done-when); the bench needs a model key, not run
  here.
- **The / menu.** Make a component, Place a component, Detach an instance:
  their forms (JSON fields for parameters, rules and the time field are
  plain text there), in EN and FR.
- **Dressings as instances.** apply_template "keyword" twice, "title",
  "lower-third": the timeline shows one comp layer each, the look in a
  `tpl-…` composition; the keyword's wiggle now runs in the instance's own
  time (its phase differs from before, by design). A keyword cannot be
  detached (its wiggle reads the time); a lower third can.
- **The Repeated elements check** on an old project with copied cards.

## Components, step 5

- **The inspector.** Select an instance: Instance of …, its parameters as
  properties (keyframe one, link one), its overrides listed (remove one);
  the open and detach buttons. In a composition, a property's ⋯ menu →
  Expose as a parameter; the composition's Parameters section lists them
  with their instances' count. Seen in screenshots here (EN and FR); try
  it by hand on a phone (the menu on a long press).
- **The library.** Compositions list → a component's menu → Keep in the
  library (desktop app, CLI server and personal deployment each store it as
  `component-<name>.js` beside the plugins); in another project,
  `/component-use` lists and brings it in. Not run against a real library
  server here (the tools are unit-tested on packing and unpacking only).
- **Not done:** the volume view (the roadmap's "later").

## Performance, step 3

- **The frame budget on a real machine.** `tramme load instances` on a
  laptop with a GPU: here (software GL) the frame is 349 ms, of which
  readback 252 ms (the software GPU), draw 38 ms (the 400 nested
  evaluations, about 12 ms, and the Canvas 2D of 1200 shapes). The
  done-when is the editor's preview: open a project with a 400-instance
  distribution and a time field (the `instances` case's document, written by
  `tramme load --out`), play it, read the frame time in the preview's
  stats; it should hold 30 fps on a laptop.
- `node bench/evaluate-instances.ts` prints the evaluation alone (12 ms
  here, 29 before; 12.8 ms on a laptop's i5-7300U). On that laptop's GPU the
  `instances` case exports at 132 ms a frame, of which draw 33 and the
  evaluation on the page 1.4: the preview's 30 fps is what is left to see.

## Performance, step 2

- **On a laptop with a GPU** (2 cores, 4 threads): the showreel (15 s,
  450 frames) takes 132 s with one page and 117 s with the default 2
  (1.13×), two cores being the limit. The MP4 decodes through with its 450
  frames and no error, 54 dB PSNR against the single page's; a MOV and a
  WebM made with 2 pages decode through too (120 frames each). Left: a
  player's eye on the joins (VLC, QuickTime), and the speed-up below.
- **The speed-up on a real machine.** Here (4 cores, a software GPU shared
  by the pages) a 2 s case renders 1.2× faster with 2 pages: the readback
  through the software GPU is the limit. On a computer with a GPU and 8+
  cores: `tramme render <a long film> --pages 1` then without `--pages`
  (the default takes half the cores): the time should fall by close to the
  number of pages on the load cases (`tramme load --out` writes them).
  Check the MP4 plays through its joins (no stutter at a segment's start)
  in a few players (VLC, QuickTime, a browser), and a MOV and a WebM too.
- Identity was checked here: PNG frames byte for byte (the simulations
  case), MP4 decoded at 53 dB PSNR against the single-page MP4 (only the
  encoder's keyframes differ).

## Editing, step 10

- **A real noisy voice.** A phone video recorded in the street or by a
  fan: `/denoise` on it (or ask the assistant): the progress line, the
  cleaned voice in the assets (`clean-…`), the layer's Clean voice at 0.85;
  play it: the noise gone between the words, the voice alive; slide Clean
  voice to 1 then 0; an MP4 export sounds as the preview. Measured here on a
  synthetic voice only (the floor down by more than 20 dB, in step to the
  sample).
- **The check.** `/check` on the noisy project: "The voice stands only N dB
  over its noise…"; after denoise, gone.
- **The desktop app and the phone**: RNNoise loads (a 1.9 MB chunk, fetched
  the first time); a long file (10 min) takes about a minute on a laptop.
- **Not done:** DeepFilterNet (ONNX), the better model "where the machine
  allows": it needs its own feature extraction around the ONNX graph; the
  tool's engine is RNNoise only for now.

## Editing, step 11

- **Silero VAD** was run on a computer with `sileroVad()`'s own loop: its
  inputs are the v5 ones the code reads, and it is `checked`. Left to see in
  the editor: Settings → Models → Where someone speaks → download it; then
  `/fillers` on a talking video with its transcript, and the tool's text
  says "speech found by silero-vad@e71cae9…" (and not "the energy of the
  sound").
- **The cuts.** Listen at each moment the tool lists; `fillers` with
  `restore: [n]` puts one back (the layers joined again, the captions
  following). The roadmap's "one click" is a re-run with a number for now:
  a button on each listed cut in the proposal card is not done.
- **A disfluency-aware transcription model** (one that writes "uh"s) can be
  named in Settings → Models → Transcription (a hub id); the tool then cuts
  the words it wrote as well. None is in the catalogue: the ones known
  (CrisperWhisper) are not for commercial use and not in transformers.js'
  format.
- The tool was run in unit tests only (its pure parts); the browser path
  (decoding, the layers laid back to back) is to try on a real file.

## Editing, step 12

- **The face landmarker** was run on a computer in Chrome, its runtime from
  jsDelivr (1.1.1) and its model from storage.googleapis.com: the GPU
  delegate opens, 478 landmarks on a face seen from the front and on one in
  profile; it is `checked`. Left to see in the editor: an interview
  close-up, `/skin` on it: progress "Finding the faces", then a hidden layer
  "Skin · …" and fx.smooth on the video. Check the mask (make the hidden
  layer visible): white skin, black eyes, brows, lips, hair and background;
  it follows the face as it turns; a second person gets a mask too.
- **fx.smooth's look** at 0.2–0.4 on real skin (pores soften, the eyes and
  edges stay sharp); at 1 it must look plastic, the reason for the light
  default. Tested here on stripes and a hard edge only.
- The runtime's URL is pinned to @mediapipe/tasks-vision@1.1.1 on jsDelivr:
  the desktop app offline cannot run it until it was fetched once (check
  the service worker keeps it), or the wasm files could be served from the
  app itself.

## Editing, step 13

- **Interpolation on real footage.** A 25/30 fps clip with a speed ramp to
  0.4×: `/interpolate` (factor 4): the progress says the time left after
  the first chunk; cancel it halfway, run it again: it resumes (the tool's
  text says how many chunks were done before). Then play the ramp: smooth
  where it stuttered. Look for smears on fast or chaotic motion (the
  engine is block matching, not RIFE). Tested here on a moving square only.
- **Upscaling**: a 720p clip in a 4K composition, `/upscale`: the layer
  now shows the ×2 asset, sharper than the stretched original; a still
  image too. A 1080p video takes a while (about a second a frame in
  JavaScript): check the estimate is honest.
- **Not done:** Real-ESRGAN and RIFE (ONNX models, better on texture and
  hard motion): their exports could not be fetched or checked here; the
  engines are model-free for now. **Blocked:** the voice/music split
  (Demucs in ONNX), same reason; it needs an ONNX export whose inputs are
  known, then the same long-job runner.
- The jobs' chunks stay in the project under `assets/jobs/` after the job:
  delete the folder by hand when the result is kept (there is no file
  delete for tools yet).

## Editing, step 14

- **10 bits on a real machine.** Checked on a computer with
  `tramme render <film> --depth 10`: the MP4 is H.265 Main 10
  (yuv420p10le, tagged hvc1) and decodes through, the MOV ProRes 4444
  (yuva444p12le), the WebM VP9 profile 2 (yuv420p10le), the PNGs 16 bits
  RGBA. Left, by eye: a slow dark gradient with a vignette or a grade shows
  no banding where the 8-bit export does (on a 10-bit display), and the MP4
  plays in QuickTime and Safari.
- **The browser's export**: Export → 10 bits appears with the codec this
  browser encodes (here, headless Chromium: VP9 profile 2 only; Chrome on
  Windows/macOS with a GPU may offer H.265 Main 10 or AV1); "cannot encode"
  shows otherwise. The MP4 format row still reads "H.264" when 10 bits
  are on (the result is then VP9, AV1 or H.265): say so in the label if it
  confuses. A project with plugins (drawn by the sandbox) exports at 8 bits
  with a warning.
- **Not done (by design):** HDR (PQ, HLG) waits for Canvas 2D above 8 bits.

## Installed plugins, steps 1 and 2

- **Settings → Plugins**: drop a `.js` plugin, read the install question,
  then install it. Check that it is listed with its version and what it
  brings. Turn it off and on, then remove it. Checked here only in headless
  Chromium with the browser's storage.
- **A real folder (Chrome or Edge on a computer)**: Use a folder, then pick
  an empty folder. Install a plugin and check that `<name>.js` appears in the
  folder (a hidden `.tramme/` folder holds its etags). Copy another plugin's
  `.js` into the folder by hand, come back to the window, and check that it is
  listed. Reload the page: the folder is remembered, and Chrome may ask for
  access again ("Allow again").
- **The desktop app**: Plugins says "the app's folder"; "Open the folder"
  opens `<home>/library/plugins` in Finder, Explorer or the file manager
  (the Rust compiles; it was not run here).
- **Safari or iOS**: the warning that the browser may clear the plugins shows
  when persistence is not granted. Export all, then import the backup back.
- **The private deployment**: the plugins are on the server's library
  (`/api/library`), the same shelf `library-add` writes to.
- **A `.trammeplugin`** (a zip with `plugin.js` and, for example, `fonts/x.woff2`):
  it installs and shows "1 file"; the file is kept beside it as
  `<name>--files.js`.
- **Not done:** the system's share sheet and the installed web app's share
  target; a plugin shared from another app does not land here yet.

## Installed plugins, steps 3 to 7

- **In a project**: install a plugin with a node, a tool and a kit (the
  sample in `docs/document.md`, or `plugins/charts.js` from this repo), then
  open a project. Check that its tool is in the `/` menu and its kit in the
  kit tool. Add a layer of its node from the add menu: a toast says it was
  copied, `plugins/<file>.js` is in the project's files, and one undo removes
  the layer and the copy. Checked here headless (a dot node, a tool, a kit,
  then undo).
- **Per project**: Settings, Plugins with a project open: the "this project"
  switch turns it off for this project only (`meta.pluginsOff`).
- **A newer version**: install 1.1 of a plugin a project copied at 1.0. The
  project's row offers "Use 1.1 here"; other projects keep 1.0.
- **The sandbox for copies.** A project with a copied plugin draws through
  the sandbox even with the experimental flag off. The "eyes" scene of the
  Evening Breeze example that came out dark blue in the filmstrip once drawn
  by the sandbox (pink on the page) was most likely the frame upside down:
  the sandbox hands back an ImageBitmap, which WebGL uploads without the
  compositor's flip. Fixed (the bitmap is drawn on a canvas first) and
  tested on the CLI with the `night-sky` fixture, the same as the page's
  picture. Left: that scene in the editor, flag on (Settings, Preview,
  sandbox), against the page. The worker's CSP now allows
  `eval` (expressions such as `frame + 1` failed in the sandbox without it).
- **Permissions**: a plugin that declares `permissions.network:
  ['https://api.example.com']` gets `ctx.fetch` to that origin only from its
  tools; another origin is refused with its name. Provider routes
  (`providers: ['generate']`) go through the user's keys. Checked here in
  unit tests only, with no real network.
- **Three failures**: a tool that throws three times in a row stops the plugin
  for the session (a toast, and "stopped this session" in Settings, Plugins);
  reopening the editor brings it back.
- **The assistant**: with a plugin installed, ask for something only it does.
  The assistant should search with `list_nodes { query }` and use it. The
  system prompt lists the installed plugins in one line each.
- **A `.trammeplugin` with a font**: the font is copied next to the module
  in `plugins/` when a layer first uses the plugin; check that the plugin
  finds it (`new URL('fonts/x.woff2', import.meta.url)`). An installed plugin
  that is not copied yet runs from a blob URL, where that relative URL does
  not resolve.
- **Not done:** a hanging tool is not timed out (tools may run long);
  step 8, the marketplace, is blocked until Tramme has its API.

## Performance, step 4

- **The filters over a layer's box**: measured on a laptop with a GPU,
  27.2 s → 6.1 s a frame on `effects` (−78 %, as in the container: exports
  draw their filters on the processor). In that Chrome a filter on the GPU
  raster (the preview's) is about ten times cheaper, and the box still
  divides it by three: the preview's gain is to be seen in the editor.
- **Same pixels on real films**: 16 stills of the three examples are
  identical before and after (`tramme compare --threshold 0`, PSNR ∞).
  Left: your own projects with blurs, shadows and glows (text with a glow,
  a stroked shape with a shadow, a rotated or scaled layer). If a stroke or
  glyph is cut at an edge, a node's `bounds` is smaller than what it draws
  by more than the margin (48 px plus 5 %).
- **Not done (by the measures):** WebGL2 blurs and Rust. Nothing measured
  here calls for them; take `tramme load --json` on a GPU machine to decide.

## Components, step 6

- **Slit-scan on footage**: put a video in a composition, add a Time
  displacement layer (add menu, Time) reading it, map `left`, delay 0.5 s. Check
  that it plays in the preview, that scrubbing backwards gives the same frames,
  and that an export matches the preview. Checked here on a moving shape only
  (CLI): a frame drawn alone and after the previous one are identical.
- **A video source**: each slice decodes the video at another moment (24
  slices are 24 positions in the file a frame). Watch the preview's speed on
  a 1080p clip and the memory on a phone; lower the slices if it stutters.
- **Memory**: the ring is kept per layer until the node's canvas is lost; two
  4K layers at 48 slices take about 384 MB of GPU memory.
- **Not done:** a delay map read from a layer (a gradient or a picture).
