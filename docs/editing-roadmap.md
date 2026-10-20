# Editing roadmap

What a video editor is expected to do with footage, done on the user's machine alone: speed curves, transitions between shots, keying, drawn masks, colour from LUTs and curves, stabilisation, proxies, voice effects, a clean voice, cut hesitations, retouched faces, and the heavier jobs (a voice pulled out of its music, upscaling, frame interpolation), then 10-bit exports. tramme already cuts silences, captions word by word, reframes for 9:16, cuts people out and tracks things; what it lacks is the craft of the edit itself.

Status: nothing done yet. What is left is listed under each step. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

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

- [ ] A "Models" section in the settings, one row per task (cut-out, detection, depth, transcription, then denoising, hesitations, faces, voice and music apart, upscaling, interpolation as they land): the default model named with its size and licence, and the models the user can download instead.
- [ ] A catalogue per task of the models known to work, each with an adapter (input size, pre- and post-processing): a model is not swapped by its name alone (a U²-Net and a BiRefNet do not take the same picture or give the same matte, and some exceed WebGPU's limits on modest machines). For the tasks that go through a transformers.js pipeline (detection, depth, transcription), an advanced field also takes any model hub id of that pipeline, checked by a short test run before it is used.
- [ ] Downloads under the user's hand: a model is downloaded when its tool first runs or from this section, with its progress; the section lists what is in the cache with its size, and deletes a model to free the space. The choice is per computer, like the preview quality: the cache is the browser's.
- [ ] Transcription in the same row whichever path it takes: the model the companion runs (the environment variable stays as an override), and Whisper in the browser itself for the desktop app and the personal deployment when no companion runs. The Worker's route (Workers AI) keeps its model, named in the row.
- [ ] Each asset a model made records which model and which version made it. Changing the model never changes a render already made: the asset stays as it was, and the tool can be run again with the new model.

### Step 2. Speed curves

- [ ] `rate` animatable on video and sound layers (it is `animatable: false` in `RATE_PROP`, `packages/nodes/src/sound.ts`). The file time becomes the integral of the rate from the layer's in point (`mediaTime`, `packages/core/src/track.ts`), computed from the keyframes in closed form where the curve allows it, by fixed-step integration otherwise — deterministic either way.
- [ ] `mediaMoments` inverts that map (the file time is monotonic while the rate stays positive), so the tracks, the remapped transcripts and the captions follow a ramp.
- [ ] A rate of 0 holds the frame (freeze frame); the minimum goes from 0.25 to 0. A negative rate plays backwards, with its clock clamped to the file.
- [ ] The mixer follows the curve (`playbackRate` automated the same way live and offline, `packages/render/src/audio.ts`); the pitch follows the speed until step 9 makes it optional.
- [ ] Presets in the curves editor: ramp in, ramp out, hero moment (fast, slow on the hit, fast), bullet.

Done when: a video layer ramps from 1× to 0.3× and back over two seconds, the preview and an MP4 export show the same frames, and a callout tracked on that video stays on its subject through the ramp.

### Step 3. Transitions between shots

- [ ] A transition between two overlapping layers: the outgoing and the incoming shot both drawn, mixed by a GL program that receives the two pictures and a `progress` (0 to 1 over the overlap). It references the other layer the way `fx.matte` does (`source: { type: 'layer' }`, `packages/nodes/src/effects.ts`).
- [ ] The set: crossfade, dip to colour, push and slide (with motion blur along the move), zoom, whip pan, luma wipe (from a grey picture), glitch, and the existing shape wipes of the `transition` recipe kept as they are.
- [ ] The timeline: drop a transition on a cut, drag its length; the two layers are made to overlap by the needed handles, or the transition says the file has no handle left.
- [ ] The sound crossfades with the picture by default (the gains of the two clips, `gainMoves`).
- [ ] The assistant's notes: one kind of transition per film, cuts by default, a transition where the story changes place or time.

### Step 4. Keying

- [ ] `fx.key`, a chroma key: distance to the key colour in YCbCr, tolerance and softness, spill suppression (the key colour taken out of the edges), a choke to shrink the matte, and a matte view to judge it.
- [ ] The key colour picked from the viewport with a dropper.
- [ ] The assistant's notes: key green or blue screens, never a picture that only happens to have green in it (that is `cutout`).

### Step 5. Drawn masks

- [ ] Masks on any layer: a list of paths, each with its mode (add, subtract, intersect), feather, expansion, opacity and invert, the path animatable like a `shape.path`.
- [ ] Drawn and edited in the viewport with the path tools already there (vertices with their tangents, Alt+click to add one, Delete to remove it).
- [ ] A mask path can follow a track (`track()`), so a mask stays on something filmed.

### Step 6. Colour

- [ ] LUTs: a `.cube` file imported as an asset, `fx.lut` applying it with its strength (a 3D texture in the WebGL2 compositor). Log footage gets its conversion LUT the same way.
- [ ] `fx.curves`: master, red, green and blue curves edited as points, read as a 1D texture.
- [ ] Colour wheels: lift, gamma and gain, each a hue and an amount, with the master level.
- [ ] Scopes beside the viewport while one of these is selected: waveform and vectorscope, read from the rendered frame.

### Step 7. Stabilisation

- [ ] The `stabilize` tool: points tracked from frame to frame (from the grey frames the tracker already reads, `grayFrame`, `apps/editor/src/tracking.ts`), the camera's path estimated, smoothed (a strength, or locked), and saved as a JSON asset timed like the file.
- [ ] The video node reads it (`stabilize` property): the inverse move applied, and the zoom that keeps the edges out of the frame, computed for the whole clip so it does not breathe.
- [ ] Shots cut separately: the shots tool's cuts reset the path, so a stabilised edit does not drift across a cut.

### Step 8. Proxies

- [ ] The `proxy` tool: a video re-encoded locally at a lower size (WebCodecs, as the cut-out writes its mask videos), saved as an asset linked to its source.
- [ ] The preview plays the proxy when there is one and the computer's setting asks for it; exports and the command line always read the original. The setting is per computer, like the preview quality.
- [ ] Offered on import above a size and a frame rate the machine plays poorly (measured, not guessed).

### Step 9. Voice effects

- [ ] A pitch shift that keeps the duration, in the mixer, the same live and offline (one AudioWorklet loaded in both contexts). With it, a speed curve can keep the voice at its pitch (`keepPitch` on the layer).
- [ ] Effects on a sound or video layer: pitch, robot, telephone, radio, megaphone, echo — each a small chain of the stages the mixer already has (filters, delay, convolver) or of the new worklet.

### Step 10. A clean voice

- [ ] The `denoise` tool: background noise taken out of a voice (RNNoise compiled to WebAssembly: small, faster than real time on any processor; DeepFilterNet in ONNX where the machine allows, for a better result). The result is a sound asset linked to its source; the layer plays it with `clean` on, the original kept.
- [ ] The strength set by mixing the cleaned and the original sound (a clean voice sounds dead at 100 %).
- [ ] The assistant runs it before captions and sound design on a voice recorded outside, and the `check` tool flags a voice whose noise floor is high.

### Step 11. Hesitations

- [ ] Find the "uh"s and "um"s that the transcript leaves out: Whisper drops them from the text, so a voice activity detector (Silero VAD, in the browser) marks speech where the transcript has no word, and those spans are the hesitations. A disfluency-aware transcription model (one that writes the hesitations) can be picked instead in the settings; it is never the default unless its licence allows commercial use.
- [ ] The `fillers` tool cuts them like `silences` does (`apps/editor/src/cuts.ts`): the layer split, the spans laid back to back, the transcript remapped and the captions reconnected.
- [ ] Each cut listed in the proposal with a moment to hear it, so a word cut by mistake is put back in one click.

### Step 12. Faces

- [ ] Face landmarks found at authoring time (MediaPipe Face Landmarker, in the browser), saved as a mask video of the skin timed like the file, as the cut-out saves its matte.
- [ ] `fx.smooth`: a surface blur that keeps edges, limited to that mask, with its strength; eyes, brows and mouth left sharp.
- [ ] The assistant's notes: light, never on by default, never more than asked.

### Step 13. The long jobs

Each of these runs on the machine, at authoring time, and saves a new asset; each is slow on a long file or a modest computer, so each follows the principle on long jobs (estimate, progress, cancel, resume).

- [ ] Voice and music apart: a sound split into voice and accompaniment (Demucs in ONNX, on WebGPU), both saved as assets, so a voice recorded over music can be cleaned, captioned and remixed.
- [ ] Upscaling: a picture or a video at twice its size (Real-ESRGAN), for a small source in a large composition.
- [ ] Frame interpolation: the frames between two frames made up (RIFE), saved as a new video; a speed curve below 1× on that video slows smoothly instead of repeating frames. The video node can point to the interpolated file for the span of a ramp.

### Step 14. 10-bit exports

- [ ] The command line first: ffmpeg writes 10-bit H.265 and ProRes (ProRes 4444 is already written at 10 bits, `packages/cli/src/media.ts`); the frames reach it at more than 8 bits from the compositor's half-float target (`RGBA16F`) instead of an 8-bit canvas.
- [ ] The browser where the encoder allows it (HEVC Main 10, VP9 profile 2 or AV1 10-bit, asked to WebCodecs before it is offered), with the export menu saying when the machine cannot.
- [ ] HDR (PQ or HLG) only after the whole pipeline is at more than 8 bits, Canvas2D included; until then exports stay SDR, at 10 bits where possible.
