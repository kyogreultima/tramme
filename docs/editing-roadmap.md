# Editing roadmap

What a video editor is expected to do with footage, done on the user's machine alone: speed curves, transitions between shots, keying, drawn masks, colour from LUTs and curves, stabilisation, proxies, voice effects, a clean voice, cut hesitations, retouched faces, and the heavier jobs (a voice pulled out of its music, upscaling, frame interpolation), then 10-bit exports. tramme already cuts silences, captions word by word, reframes for 9:16, cuts people out and tracks things; what it lacks is the craft of the edit itself.

Status: step 1 done (models in the settings), step 2 done (speed curves), step 3 done (transitions), step 4 done (keying), step 5 done (masks), step 6 done (colour), step 7 done (stabilisation), step 8 done (proxies), step 9 done (voice effects), step 10 done (a clean voice, by RNNoise; DeepFilterNet, the better model where the machine allows, not yet), step 11 done (hesitations: Silero VAD, the energy of the sound when it cannot load; a cut put back by its number, not yet by a button on the proposal), step 12 done (faces: the skin tool and fx.smooth; the landmarker to try on a device), step 13 done but its first box (the long-job runner: estimate, progress, cancel, resume; upscaling and interpolation by the core's own engines, Lanczos and block-matching motion, Real-ESRGAN and RIFE not yet), the voice and music split blocked (Demucs in ONNX: no export of it could be fetched or checked where the loop ran), step 14 done but HDR (10-bit exports from the command line, H.265 Main 10, ProRes and VP9 profile 2 from the half-float frame, and in the browser when it encodes 10 bits; HDR waits, as written, for Canvas 2D above 8 bits); the models other than the defaults are to try on a device. What is left is listed under each step. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

People bring footage. Before the assistant can direct a film made of it, the tool has to hold the edit: a shot that slows into its moment, a cut that dissolves, a presenter on a green screen, a log picture that needs its LUT, a shaky phone take, a voice over traffic. Each of these is ordinary in any editor and missing here, and each sends the user back to another tool before tramme can begin.

None of them needs a provider or a key. Most are code (a curve integrated, a shader, a DSP stage); the rest are small models that run in the browser the way the cut-out, the depth and the detector already do (`apps/editor/src/cutout.ts`, `depth.ts`, `perception.ts`). Keeping them local keeps the personal deployment and the desktop app whole: no account, nothing sent anywhere once a model is downloaded.

## Principles

- **The machine alone.** No provider, no key, no request once a model is in the browser's cache. WebGPU first, the processor without it (slower, never broken), as `onDemand` does today.
- **Models run at authoring time, the render reads files.** A model's output is saved as an asset (a JSON track, a mask video, a cleaned sound, a new video) linked to its source, and the render only reads it — the rule of the cut-out and the depth. Rendering stays a pure function of `t`, the same in the preview, the browser exports and the command line.
- **Code where code does it.** A curve, a shader or a DSP stage is preferred to a model whenever it is as good: it is exact, instant and the same on every machine.
- **One mechanism.** Each feature is a property or an effect the inspector shows from its schema, and, when it computes something, a tool of the editor's vocabulary: the assistant runs it (`use_tool`), the user too (`/` menu). Each gets its `ai` notes (`packages/nodes/src/notes.ts`) so the assistant knows when to reach for it and when not to.
- **Long jobs are honest.** A job that takes minutes says how long before it starts (measured on the machine), shows its progress, can be cancelled, and resumes from what it finished. The desktop app is the recommended place for them, not the only one.
- **Nothing in the bundle.** No model is packed with the editor or the desktop app: each is downloaded the first time its tool runs and kept in the browser's cache (`transformers-cache`, as the cut-out does), so the app weighs the same with or without these features. A user who never runs a tool never downloads its model.
- **A default model, the user's choice beyond it.** Each tool names the model it downloads by default and its size before downloading; the user can download another one for the same task from the settings (step 1), the existing tools included. The defaults are listed in `THIRD_PARTY_NOTICES.md` with their licences and allow commercial use; a model the user picks is under its own licence.

## Steps

### Step 1. Models in the settings

The models already in use are each fixed in their file: the cut-out's U²-Net (`apps/editor/src/cutout.ts`), the detector (`perception.ts`), the depth (`depth.ts`), and Whisper in the companion, changed only by an environment variable (`TRAMME_WHISPER_MODEL`, `packages/cli/src/speech.ts`). The models of the steps below join them in one place.

- [x] A "Models" section in the settings, one row per task (cut-out, detection, depth, transcription, then denoising, hesitations, faces, voice and music apart, upscaling, interpolation as they land): the default model named with its size and licence, and the models the user can download instead.
  `apps/editor/src/ui/ModelsSettings.tsx`, the choice kept per computer in the preferences (`models`). The cut-out has two rows, a person and any subject, as its tool has two models. Sizes are those of the model cards ("about"); the next box measures what is in the cache. To check on a device: the sizes, and every model not marked as tried.
- [x] A catalogue per task of the models known to work, each with an adapter (input size, pre- and post-processing): a model is not swapped by its name alone (a U²-Net and a BiRefNet do not take the same picture or give the same matte, and some exceed WebGPU's limits on modest machines). For the tasks that go through a transformers.js pipeline (detection, depth, transcription), an advanced field also takes any model hub id of that pipeline, checked by a short test run before it is used.
  `apps/editor/src/models.ts`: the matte adapter (square side, mean and deviation, division by the brightest value, probabilities or a range to stretch) covers U²-Net and IS-Net; the pipelines take their precisions in order on the GPU, then the processor. The tools read the choice (`cutout.ts`, `perception.ts`, `depth.ts`). Only the four defaults were tried; the alternatives come from their model cards, marked "not tried" in the settings: the model hub was out of reach where this was built, so their files, sizes and licences are to check on a device (`docs/roadmap-loop/to-validate.md`).
- [x] Downloads under the user's hand: a model is downloaded when its tool first runs or from this section, with its progress; the section lists what is in the cache with its size, and deletes a model to free the space. The choice is per computer, like the preview quality: the cache is the browser's.
  `apps/editor/src/model-cache.ts`: each row says whether its model is in this browser and its weight, with Download now (the progress in bytes, in the precision the tool would take on this machine) or Delete; a last part lists what no row uses (an earlier choice, an older version) with the total. A model loaded in the page stays usable until the page reloads after its deletion.
- [x] Transcription in the same row whichever path it takes: the model the companion runs (the environment variable stays as an override), and Whisper in the browser itself for the desktop app and the personal deployment when no companion runs. The Worker's route (Workers AI) keeps its model, named in the row.
  The editor sends the chosen model to the companion (`model`, a model hub id; `whisperModel` in `packages/cli/src/speech.ts`), which keeps one pipeline per model. With neither a server route nor a companion, the page runs the same model itself (`apps/editor/src/speech.ts`), the progress saying "in this browser". The row names the server's models (Workers AI's Whisper large v3 turbo, OpenAI's whisper-1). To check on a device: a transcription in the desktop app without a companion.
- [x] Each asset a model made records which model and which version made it. Changing the model never changes a render already made: the asset stays as it was, and the tool can be run again with the new model.
  `madeBy` on the asset (an addition to the format: a list, a cut-out of a person running the matte and the detector): `<model id>@<revision>` for the editor's models, the model hub id for the companion, `workers-ai:…` or `openai:whisper-1` for the server. Recorded by the cut-out, remove-bg, the depth, the people analysis, a track started from an object named, and transcripts (in the transcript file too).

### Step 2. Speed curves

- [x] `rate` animatable on video and sound layers (it is `animatable: false` in `RATE_PROP`, `packages/nodes/src/sound.ts`). The file time becomes the integral of the rate from the layer's in point (`mediaTime`, `packages/core/src/track.ts`), computed from the keyframes in closed form where the curve allows it, by fixed-step integration otherwise — deterministic either way.
  A property declares `integral` (`rate`: `rateElapsed`) and the Evaluator adds the integral from the in point when the value moves (`integrate` in `packages/core/src/track.ts`: Simpson's rule, 32 steps between keyframes, exact on held and linear stretches); a held speed keeps the multiplication it had, so documents without a curve render as before. The same clock reaches the video node, the callout and `track()`.
- [x] `mediaMoments` inverts that map (the file time is monotonic while the rate stays positive), so the tracks, the remapped transcripts and the captions follow a ramp.
  Inverted by looks every 1/120 s and bisection, every crossing found (a speed that turns back plays a moment twice); `layerClock` (core) gives the tools a layer's clock both ways (sound placement, track, callout). Captions follow a video or sound layer (`follow`) and keep its file time. Left out: the silence cuts (`cuts.ts`) still lay their clips at the layer's speed as a number; on a ramped layer, cut first, then ramp.
- [x] A rate of 0 holds the frame (freeze frame); the minimum goes from 0.25 to 0. A negative rate plays backwards, with its clock clamped to the file.
  The minimum is -4 (backwards up to four times); the clock stops at the file's start, and the video's last frame holds past its end.
- [x] The mixer follows the curve (`playbackRate` automated the same way live and offline, `packages/render/src/audio.ts`); the pitch follows the speed until step 9 makes it optional.
  The clip carries its curve sampled 50 times a second (`rateCurve`), its file time is the curve's integral (`clipFileTime`), within a millisecond of the picture's clock; the buffer's `playbackRate` follows it (the exports and the preview's sounds), and the preview's video sound, played by a media element, is steered every 40 ms and waits under 1/16 speed. A sound never plays backwards: under 0 it holds, silent. The preview's media elements no longer keep the pitch at another speed, as the exports never did.
- [x] Presets in the curves editor: ramp in, ramp out, hero moment (fast, slow on the hit, fast), bullet.
  With a video or sound layer selected, a Speed row in the curves editor writes its speed curve around the playhead (`apps/editor/src/speed.ts`), the shape moved to stay inside the layer. The assistant writes the same keyframes through its notes on `rate` (no tool of its own).

Done when: a video layer ramps from 1× to 0.3× and back over two seconds, the preview and an MP4 export show the same frames, and a callout tracked on that video stays on its subject through the ramp.

### Step 3. Transitions between shots

- [x] A transition between two overlapping layers: the outgoing and the incoming shot both drawn, mixed by a GL program that receives the two pictures and a `progress` (0 to 1 over the overlap). It references the other layer the way `fx.matte` does (`source: { type: 'layer' }`, `packages/nodes/src/effects.ts`).
  `fx.transition` on the incoming layer: `from` (the outgoing layer), `kind`, `duration` from the layer's in point. Its progress comes from a new uniform every GL effect now gets, `uLayerTime` (the time since its layer's in point). Rendered in Chrome and read back pixel by pixel (`packages/cli/test/transitions.test.ts`, skipped without Chrome).
- [x] The set: crossfade, dip to colour, push and slide (with motion blur along the move), zoom, whip pan, luma wipe (from a grey picture), glitch, and the existing shape wipes of the `transition` recipe kept as they are.
  One program for all eight kinds; push, slide and whip average twelve looks along their move (`blur`), the whip eased harder. To check on a device: the glitch on real footage (flat colours do not show its rows).
- [x] The timeline: drop a transition on a cut, drag its length; the two layers are made to overlap by the needed handles, or the transition says the file has no handle left.
  `apps/editor/src/transitions.ts`: the shot ending at the cut is found, the window centred on the cut and moved to what the files hold (the incoming before its start, the outgoing after its end, a video's length when the preview has it), in whole frames, the incoming shot stacked above. In the timeline, the clip's menu puts one (Transition from the shot before…, then its kind), and a striped band over the start of the incoming clip drags its length, the overlap redone around the same cut as it goes. Left out: dragging a transition from a palette onto a cut; the menu does it.
- [x] The sound crossfades with the picture by default (the gains of the two clips, `gainMoves`).
  `sound` on the transition (on by default): over its window the incoming clip rises and the outgoing one falls, equal power, the outgoing silent after it (`cross` on the clip, `gainAt`, `packages/core/src/audio.ts`); the preview and the exports share it.
- [x] The assistant's notes: one kind of transition per film, cuts by default, a transition where the story changes place or time.

### Step 4. Keying

- [x] `fx.key`, a chroma key: distance to the key colour in YCbCr, tolerance and softness, spill suppression (the key colour taken out of the edges), a choke to shrink the matte, and a matte view to judge it.
  One GL program: the distance to the key on the chroma alone (Cb, Cr, BT.709), so the screen in shade keys like the screen in light; spill takes the part of the colour that goes the key's way out of what stays, its brightness kept; choke takes the least of eight looks around. Rendered and read back in Chrome (`packages/cli/test/render-effects.test.ts`). To check on a device: real green-screen footage, hair and motion blur.
- [x] The key colour picked from the viewport with a dropper.
  Every colour property of the inspector has a dropper (`apps/editor/src/dropper.ts`): the next click on the picture gives the pixel's colour, Escape cancels; an effect's colour is picked with that effect off, so a key picks the screen as filmed. It reads the picture as shown (the composition's look included).
- [x] The assistant's notes: key green or blue screens, never a picture that only happens to have green in it (that is `cutout`).

### Step 5. Drawn masks

- [x] Masks on any layer: a list of paths, each with its mode (add, subtract, intersect), feather, expansion, opacity and invert, the path animatable like a `shape.path`.
  `masks` on the layer (an addition to the format, `MASK_SCHEMA` in `packages/core/src/registry.ts`), evaluated like its effects (`layer.masks.<id>.<prop>`), drawn before its effects (`applyMasks`, `packages/render/src/canvas2d.ts`); a Masks section in the inspector, a new mask a rectangle over the layer. Rendered and read back in Chrome.
- [x] Drawn and edited in the viewport with the path tools already there (vertices with their tangents, Alt+click to add one, Delete to remove it).
  The selected layer's masks show with its own paths (`masks.<id>.path` in `apps/editor/src/ui/Viewport.tsx`); the selected vertex remembers its path, so Delete and the tangents act on the right one.
- [x] A mask path can follow a track (`track()`), so a mask stays on something filmed.
  `track(layer, name, at)` now reads a track at another time too; Follow a track, on a mask in the inspector, keeps the path drawn and moves it by the object's move since the current time (`apps/editor/src/masks.ts`), divided by the layer's scale (its rotation is not counted). Where the object is lost, the mask goes back to where it was drawn.

### Step 6. Colour

- [x] LUTs: a `.cube` file imported as an asset, `fx.lut` applying it with its strength (a 3D texture in the WebGL2 compositor). Log footage gets its conversion LUT the same way.
  A `lut` asset type (an addition to the format; `.cube` allowed in `assets/`, in the desktop store too), read by `parseCube` (`packages/core/src/lut.ts`, 3D tables up to 128³); a GL effect's `lut` asset prop becomes a 3D texture (half floats, which WebGL2 always filters) with its size and domain. Rendered in Chrome. 1D `.cube` files are refused with a message.
- [x] `fx.curves`: master, red, green and blue curves edited as points, read as a 1D texture.
  Each curve a `path` prop of format `curve` (points in 0..1, animatable like a path), joined by a monotone cubic that never overshoots (`curveTable`, `packages/core/src/lut.ts`) into 256 half floats; edited in the inspector on a square (drag a point, click to add, double-click to remove). Rendered in Chrome.
- [x] Colour wheels: lift, gamma and gain, each a hue and an amount, with the master level.
  `fx.wheels`: each wheel a `vec2` of format `wheel` (its angle the hue, its length the amount, a disc to drag in the inspector), each with its level; out = (gain × (c + lift × (1 − c)))^(1/gamma), the wheels' hues made neutral in brightness. Rendered in Chrome.
- [x] Scopes beside the viewport while one of these is selected: waveform and vectorscope, read from the rendered frame.
  In the viewport's corner while the selected layer carries a LUT, curves, wheels, a colour correction or a key (`apps/editor/src/ui/Scopes.tsx`); counted on the frame drawn at 256 px wide (`apps/editor/src/scopes.ts`), a moment after it changes, on a log scale.

### Step 7. Stabilisation

- [x] The `stabilize` tool: points tracked from frame to frame (from the grey frames the tracker already reads, `grayFrame`, `apps/editor/src/tracking.ts`), the camera's path estimated, smoothed (a strength, or locked), and saved as a JSON asset timed like the file.
  `packages/core/src/stabilize.ts`: points with detail in a grid, matched block by block below the pixel, the similarity that carries them (the outliers set aside); a look a frame of the file (30 a second at most) at 320 px (`apps/editor/src/stabilize.ts`). On a still picture shaken by a known path (ffmpeg), the move is read to 0.25 px on average.
- [x] The video node reads it (`stabilize` property): the inverse move applied, and the zoom that keeps the edges out of the frame, computed for the whole clip so it does not breathe.
  The zoom is at most 1.5 (the tool says when it reaches it). Left out: a track or a callout on a stabilised video follows the file as it was filmed, not the picture moved back.
- [x] Shots cut separately: the shots tool's cuts reset the path, so a stabilised edit does not drift across a cut.
  The tool finds the cuts as the shots tool does (the histogram distance over `CUT`) and starts the path again at each.

### Step 8. Proxies

- [x] The `proxy` tool: a video re-encoded locally at a lower size (WebCodecs, as the cut-out writes its mask videos), saved as an asset linked to its source.
  `apps/editor/src/proxy.ts`: 540 lines by default, a keyframe every half second, its sound left in the original; the source names it (`proxy` on the asset, an addition to the format, checked by the validator).
- [x] The preview plays the proxy when there is one and the computer's setting asks for it; exports and the command line always read the original. The setting is per computer, like the preview quality.
  Settings → Preview → Play proxies (on by default); only the preview's renderer is opened with `proxies`, the asset store opening the proxy in place of its source and again when the setting changes.
- [x] Offered on import above a size and a frame rate the machine plays poorly (measured, not guessed).
  A second of the file decoded at its own size, timed: under 1.2 times its frame rate, and over 540 lines, the import asks. Left out: a project made from a video on the home screen is not measured yet; the tool is there for it.

### Step 9. Voice effects

- [x] A pitch shift that keeps the duration, in the mixer, the same live and offline (one AudioWorklet loaded in both contexts). With it, a speed curve can keep the voice at its pitch (`keepPitch` on the layer).
  `packages/render/src/pitch.ts`: two read heads crossfaded through a delay line (60 ms windows), one function run by the tests and, as its source, by the worklet (`tramme-pitch`, its `ratio` a parameter a speed curve automates); loaded before the chains in the preview and in each offline mix. In the preview, a video's sound (a media element) keeps its pitch through the browser instead. Mixed in Chrome: a 440 Hz tone at 12 semitones gives 880 Hz, at twice the speed with `keepPitch` stays at 440. To check on a device: how a voice sounds (the windows' grain on low voices).
- [x] Effects on a sound or video layer: pitch, robot, telephone, radio, megaphone, echo — each a small chain of the stages the mixer already has (filters, delay, convolver) or of the new worklet.
  `voice` and `semitones` on sound and video layers: telephone, radio and megaphone are bands of the voice and a soft clip; the robot a ring modulation at 50 Hz; the echo a delay of 0.28 s fed back.

### Step 10. A clean voice

- [x] The `denoise` tool: background noise taken out of a voice (RNNoise compiled to WebAssembly: small, faster than real time on any processor; DeepFilterNet in ONNX where the machine allows, for a better result). The result is a sound asset linked to its source; the layer plays it with `clean` on, the original kept.
- [x] The strength set by mixing the cleaned and the original sound (a clean voice sounds dead at 100 %).
- [x] The assistant runs it before captions and sound design on a voice recorded outside, and the `check` tool flags a voice whose noise floor is high.

### Step 11. Hesitations

- [x] Find the "uh"s and "um"s that the transcript leaves out: Whisper drops them from the text, so a voice activity detector (Silero VAD, in the browser) marks speech where the transcript has no word, and those spans are the hesitations. A disfluency-aware transcription model (one that writes the hesitations) can be picked instead in the settings; it is never the default unless its licence allows commercial use.
- [x] The `fillers` tool cuts them like `silences` does (`apps/editor/src/cuts.ts`): the layer split, the spans laid back to back, the transcript remapped and the captions reconnected.
- [x] Each cut listed in the proposal with a moment to hear it, so a word cut by mistake is put back in one click.

### Step 12. Faces

- [x] Face landmarks found at authoring time (MediaPipe Face Landmarker, in the browser), saved as a mask video of the skin timed like the file, as the cut-out saves its matte.
- [x] `fx.smooth`: a surface blur that keeps edges, limited to that mask, with its strength; eyes, brows and mouth left sharp.
- [x] The assistant's notes: light, never on by default, never more than asked.

### Step 13. The long jobs

Each of these runs on the machine, at authoring time, and saves a new asset; each is slow on a long file or a modest computer, so each follows the principle on long jobs (estimate, progress, cancel, resume).

- [ ] Voice and music apart: a sound split into voice and accompaniment (Demucs in ONNX, on WebGPU), both saved as assets, so a voice recorded over music can be cleaned, captioned and remixed.
- [x] Upscaling: a picture or a video at twice its size (Real-ESRGAN), for a small source in a large composition.
- [x] Frame interpolation: the frames between two frames made up (RIFE), saved as a new video; a speed curve below 1× on that video slows smoothly instead of repeating frames. The video node can point to the interpolated file for the span of a ramp.

### Step 14. 10-bit exports

- [x] The command line first: ffmpeg writes 10-bit H.265 and ProRes (ProRes 4444 is already written at 10 bits, `packages/cli/src/media.ts`); the frames reach it at more than 8 bits from the compositor's half-float target (`RGBA16F`) instead of an 8-bit canvas.
- [x] The browser where the encoder allows it (HEVC Main 10, VP9 profile 2 or AV1 10-bit, asked to WebCodecs before it is offered), with the export menu saying when the machine cannot.
- [ ] HDR (PQ or HLG) only after the whole pipeline is at more than 8 bits, Canvas2D included; until then exports stay SDR, at 10 bits where possible.
