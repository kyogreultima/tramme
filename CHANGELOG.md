# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until 1.0.0, the document format and the APIs may still change between minor versions.

## [Unreleased]

## [0.12.0] - 2026-10-21

### Added

- **Time displacement**: the `time.shift` node reads a composition later in some places than in others: slit-scan along a side, a time ripple from the centre or the edges, or a liquid time in noise patches. It keeps a ring of past frames as a 3D texture and stays a pure function of time.
- **Faster blurs, shadows and glows**: a layer's Canvas 2D filters now run over its box, grown by what they spread, instead of the whole frame. The `effects` load case renders in 6.8 s a frame instead of 27.4 s on a machine without GPU raster, with the same pixels. An effect can say how far its filter spreads (`canvas2d.reach`); without it, the whole frame is filtered as before.
- **Installed plugins in every project**: an installed plugin's tools, checks, workflows, kits and presets are offered in every project. They run in the project's sandbox, never on the page, and the project's own names win. A project can turn one off (`meta.pluginsOff`). When a layer, an effect or a modifier of one first enters a project, the plugin and its own files are copied into the project's `plugins/` in the same undo step. Its version is recorded in `meta.installedCopies`, so the project opens the same anywhere, and a newer installed version is offered per project, never applied without the user. A project holding such a copy is always drawn through the sandbox. A plugin reaches only what it declared (`meta.permissions`): its network origins and provider routes through the new `ctx.fetch`, and writes under `assets/` and its declared paths. It is stopped for the session after three failures in a row. The assistant's `list_nodes` takes a `query` that finds the installed plugins' nodes and tools, left out of its index, and the system prompt names the installed plugins.
- **Installed plugins**: a Plugins section in the settings installs a plugin once on this device, from a `.js` module or a `.trammeplugin` package (a zip of the module and its own files), picked or dropped. It asks first, before any of the plugin's code runs: what the plugin brings, what it may reach and its API version. An update asks again only when it asks for more. Each plugin can be turned off or removed, and all of them can be exported as one backup and imported back. The plugins are kept in the desktop app's folder, in a folder the user picks (Chrome and Edge, with the File System Access API), in the browser's storage (made persistent where the browser allows), or on the private deployment's server. A plugin's `meta` grows an `id`, a `licence`, an `author`, a `homepage` and its `permissions`; plugins without them stay valid.
- **10-bit exports**: `tramme render --depth 10` reads each frame at 16 bits from the compositor's half-float frame, not rounded to 8, and writes H.265 Main 10 (MP4), ProRes 4444 (MOV), VP9 profile 2 (WebM) or 16-bit PNG; the browser's export offers 10 bits for MP4 and WebM when this browser encodes them (asked to WebCodecs first: H.265 Main 10, AV1 or VP9 profile 2) and says when it cannot. Gradients made by the effects and the finish keep their levels; exports stay SDR.
- **Long jobs that resume**: the video jobs run in chunks saved as they finish, say how long is left, can be cancelled, and pick up where they stopped. Two of them: `upscale` makes a picture or a video twice its size (Lanczos, lightly sharpened), and `interpolate` makes up the frames between a video's frames (2 or 4 times as many, along their motion), saved as a copy linked to it (`interpolated`, a new optional field of an asset): a layer slowed under 1× plays the copy and slows smoothly instead of repeating frames.
- **Smoother skin, when asked**: the `skin` tool finds the faces of a video (MediaPipe's Face Landmarker, in the browser) and saves the skin of each as a mask video, eyes, brows and mouth left out; `fx.smooth`, a surface blur that keeps edges, softens the video through it, lightly by default. The landmarker joins the models of the settings (Faces).
- **Hesitations cut**: the `fillers` tool finds the "uh"s and "um"s a transcript leaves out (where a voice detector, Silero VAD, hears speech and no word is written; the ones a transcription model wrote too) and cuts them as the silences are cut, the transcript of the edit remapped and the captions reconnected. Each cut is listed with its moment, and `restore` puts any back by its number. Silero VAD joins the models of the settings (Where someone speaks).
- **A clean voice**: the `denoise` tool takes the background noise out of a voice (RNNoise, in WebAssembly, loaded when first used, faster than real time) and saves the cleaned voice beside the original, which stays (`clean`, a new optional field of an asset); the layer plays the two mixed by its Clean voice amount, 0.85 by default so the voice keeps its life. The check warns about a voice whose noise floor is high, and the assistant cleans such a voice before captions and sound design.
- **Parallel export**: `tramme render` cuts the film into segments rendered at once by several pages of the same Chrome (as many as the machine's cores and memory allow, `--pages n` to choose, `--pages 1` for one after the other), each encoding its own, then joins them without encoding again; the sound is mixed once over the whole film. The frames are the ones a single page draws, simulations included.
- **Components in the editor**: an instance shows its component's parameters in the inspector like a node's properties (animatable, linkable), its overrides marked and removable, a button to open its component and one to detach it; any property of a composition becomes a parameter from its menu (Expose as a parameter), and the composition lists its parameters and how many instances use it. Components are marked in the compositions list, and kept in the library shared by the projects (`component-keep`, `component-use`).
- **The assistant writes things once**: `define_component` turns layers into a component and an instance in their place, `instantiate` places one or a whole distribution of it, `detach` turns an instance back into layers (the / menu has them too). The assistant's guide asks for a component as soon as something repeats, and a new check, Repeated elements, points at layers written several times nearly the same. The section titles, keywords, lower thirds and end cards are placed as instances of a component of their look, their words as parameters: two keywords share one component.
- **The time field**: the `timeField` modifier reads an animation later for some elements than for others, by rank (the old Offset, which it now runs), along a direction, by distance to a point or a layer, or by noise that can drift: a wave, a ripple, a liquid time, from one animation. A distribution takes one too (`time`), so a hundred instances become one wave. A modifier's amount or seed can be keyframed and slides.
- **Distributions**: a comp layer makes N instances of its component at once (`distribute`), on a grid, a line, a circle, along a path or on another layer's points, as many as asked or one per row of a JSON asset; each parameter is given by a rule (a value, an expression of `index`, `count` and `row`, the palette in order or at random). Each instance has its rank, so the offsets and the noise of the modifiers keep working across instances. Expressions read `index` and `count` everywhere.
- **Components**: a composition that lists `params` (each with its type, the properties it lands on and a default) is a component, and every comp layer holding it an instance with its own values (`params`, fixed or animated) and its own changes to any property inside (`overrides`); changing the component changes every instance. An instance can be detached into plain layers that draw the same. **Styles** are sets of properties defined once at the document's top level and applied to any layer (`styles`); keyframed, a style is an animation played from where it is used. New optional fields of the document.
- **A Models section in the settings**: the model each local tool runs (the cut-out of a person or of any subject, detection, depth, transcription) is named with its size and licence, and another can be chosen for this computer, among models whose input and output tramme knows; detection, depth and transcription also take any model of the hub made for their pipeline, tried on a blank input before it is kept. A model whose licence forbids commercial work says so.
- **The models in this browser, by hand**: the Models section says whether each model is downloaded and how much it weighs, downloads it ahead of its tool with its progress, deletes it, and lists the models no tool uses any more with the space they take.
- **Transcription without a server or a companion**: the desktop app and the personal deployment transcribe in the browser itself when neither the server nor the local companion can, with the model chosen in the settings; the companion runs that model too (`TRAMME_WHISPER_MODEL` still overrides it on its machine).
- **An asset made by a model says which**: the cut-out's masks, the pictures cut out, the depth maps, the people found, the tracks and the transcripts keep the models and versions that made them (`madeBy`, a new optional field of the document); another model chosen later never changes them.
- **Voice effects**: a sound or video layer's voice can be pitched (in semitones, its length kept), or sound like a robot, a telephone, a radio, a megaphone or an echo, the same in the preview and the exports; with Keep the pitch, a voice at another speed or on a speed curve keeps its pitch.
- **Proxies**: the `proxy` tool encodes a lighter copy of a video (540 lines) that the preview plays instead, so a 4K or high frame rate file plays smoothly while editing; the exports keep the original. Importing a video this computer decodes too slowly offers one (measured on a second of it). Settings → Preview → Play proxies.
- **Stabilisation**: the `stabilize` tool takes the camera's shake out of a video, smoothed or locked still, shot by shot, and the video layer zooms just enough for the whole clip to keep its edges out.
- **Scopes**: a waveform and a vectorscope of the frame show beside the picture while a layer with a grading effect (LUT, curves, wheels, colour correction, key) is selected.
- **Colour wheels**: `fx.wheels` pushes the shadows, the mid tones and the highlights toward a colour (lift, gamma, gain, each a wheel to drag in the inspector) and sets their levels.
- **Curves**: `fx.curves` tones a layer by a master curve and one each for red, green and blue, edited as points on a square in the inspector.
- **LUTs**: a `.cube` file imported into the project (a `lut` asset) grades a layer through `fx.lut`, at a strength: a look, or the conversion of log footage.
- **Masks on any layer**: drawn outlines that cut a layer, each added, subtracted or intersected with the ones before it, with its feather, expansion, opacity and invert, its path animatable like a shape's (`masks`, a new optional field of a layer); a Masks section in the inspector; their outlines are edited in the viewport with the path tools (drag a vertex or a tangent, Alt+click adds a vertex, Delete removes it), and a mask can follow a tracked object (Follow a track). Expressions read a track at another time too: `track(layer, name, at)`.
- **Chroma key**: `fx.key` makes a green or blue screen transparent, in light and in shade alike, with its tolerance, its softness, the spill taken out of the edges, a choke, and a matte view to judge it. Its colour, like every colour of the inspector, can be picked in the viewport with a dropper (the effect off while picking).
- **Transitions between shots**: `fx.transition` on the incoming shot mixes it with the outgoing one over their overlap: crossfade, dip to a colour, push, slide, zoom, whip pan (both blurred along their move), a luma wipe from a grey picture, and a glitch. Their sounds cross with the picture (equal power), unless the transition says otherwise. In the timeline, a clip's menu puts a transition on the cut before it, the two shots overlapping from their files' handles (or saying how much is missing), and its band drags its length. The assistant reaches for one kind per film, cuts by default. GL effects also read `uLayerTime`, the time since their layer's in point.
- **Speed curves**: the speed of a video or sound layer can be animated; the file plays at the integral of the speed, so a shot slows into its moment and speeds out of it, the same in the preview and the exports. 0 freezes the frame, a negative speed plays backwards. Tracks, callouts and the sounds placed on what is seen follow the ramp, and captions follow the layer whose speech they show (`follow`). The sound follows the curve too, its pitch with the speed. The curves editor has four speed presets for the selected video or sound: ramp in, ramp out, hero moment and bullet.
- **A file already in the project is not imported twice**: importing it again from the assets panel, attaching it to a message for the assistant, or finding it twice among the sources of a new project gives back the asset that has it, and nothing is written again. Each imported asset keeps a hash of its content (`hash`, a new optional field of the document).
- **An export says where a frame's time goes**: next to the `ms/frame`, `tramme render` prints the time per frame spent evaluating the document, drawing it, waiting for video frames, reading the pixels back from the GPU and waiting for the encoder, so a slow export tells whether the JavaScript, the GPU, the decoding or the transfer holds it back.
- **Load cases to measure the renderer**: `tramme load` renders documents that each push one part of a frame (400 animated layers, blurs and effects with motion blur, a 4K source video, simulations) and prints, per case, the time per frame, its parts and what holds it back; `--json` keeps the figures and `--before` compares a later run with them, figure by figure.

### Changed

- **The Models settings, regrouped**: the tasks on the picture, then those on the sound, one line each with the model chosen, its size, licence and whether it is in this browser, and a single button to download or delete it. A model hub id is entered once, for the task picked beside it.
- **Faster evaluation of many elements**: a frame of 400 instances of a component under a time field is evaluated in about 12 ms instead of 29 (the field read once rather than per instance, the modifiers' settings, the curves and where each property lives found once, the readings at other instants shared within a frame). `tramme load` has an `instances` case.
- **Two layers showing one video at different moments read it at once**: a crossfade between two shots of one take, a split screen or the clips of a cut that overlap each read forward on a decoder of their own (three per file at most) instead of making one decoder seek at every frame. On a crossfade within a 4K file, the time spent waiting for video frames drops by three quarters.

### Fixed

- In the preview, a video played at another speed kept its pitch while the exports changed it: the pitch now goes with the speed everywhere.
- An export of two layers playing the same video at different moments could draw one of them with a frame of the other: the shared decoder dropped the first layer's frame when the second one's came.
- `tramme still` and `tramme render` failed on a project with its own plugins ("unknown node type"): the sandbox was never asked to load them. A frame drawn by the sandbox also came out upside down, in the CLI and in the editor's preview and filmstrip.
- The cut-out of a person ran the small general network (U²-Netp) instead of U²-Net trained on people: the model hub repository it read held the wrong file. It now downloads rembg's human segmentation weights (176 MB), which keep the person and leave the objects they lean on. Whisper large v3 turbo, in the settings, now comes from the export that can time the words; the former one could not transcribe for the editor.

## [0.11.1] - 2026-10-19

### Fixed

- The home screen's format choice (16:9, 9:16, 1:1, 4:5) drew each format's rectangle above its ratio instead of beside it, on a computer as on a phone: since 0.11.0 the label of a segmented control is an element of its own, and the rectangle inside it broke the line.
- On a phone, a project of several shots pushed the name and the export out of the top bar: the composition picker stayed in it. It leaves the bar under 900 px with the format, and the ⋯ menu now shows from that width, so both stay at hand (between 760 and 900 px the format had no way back).
- On a phone, the home screen's brief lines up with the films under it, and its format choice spans the box's width in four equal parts; it sat indented, the formats left-aligned under the other buttons.
- On a phone, the settings' search spans the dialog's width.

## [0.11.0] - 2026-10-19

### Added

- **The editor installs as an app**: PNG icons (192 and 512, a maskable one for Android, Apple's) drawn from `icon.svg` by `scripts/app-icons.ts`, a complete manifest, and an "Install the app" button on the home screen when the browser offers it (Chrome, Edge, Android; on an iPhone, Share → Add to Home Screen).
- **The installed app opens offline** (personal mode): the service worker keeps the editor's own files of each build — the page, its bundles and fonts, the sandbox, the icons — in a cache named after the build, the previous builds' dropped. The projects are in the browser already.
- **Each settings section says what it is for**, under its title, as the Preview's did.

### Changed

- **The editor fits a phone**: the top bar keeps the name, the view, undo, redo and export (as an icon), and moves the format, the frame rate, the versions, the help and the settings to its ⋯ menu, which was never shown; the atelier's tabs are one bar across the bottom, the panels stopping above it; the transport drops the first and last frame buttons and its Timeline and Curves tabs keep their icons; the timeline's names take a share of the screen, not the width remembered on a computer.
- The settings' search shows a whole section when its title matches; its description no longer counts.

### Fixed

- **The preview could stay black, never starting**: the renderer waited for every font of the page, and Chrome sometimes leaves one of the interface's (Geist Mono) loading for good. The page's fonts are now waited for 3 s at most, once; the document's own fonts are still loaded one by one.
- **"plugin … did not load in the sandbox"** on opening a project: a second load asked while the first was under way (a turn resuming as the project opens) found the plugin already asked and failed. A load under way is now waited for, a refusal gives the sandbox's reason once and is tried again when the file changes, one broken plugin no longer keeps the others out, and a sandbox whose worker failed is made again.
- **The providers' settings in personal mode** follow the editor's theme and language: the vault's page read its preferences before the editor's were kept (the production build puts them in a chunk shared with the editor). Its background, its titles and its empty state now match the other panes.
- The labels of the segmented controls (the view switch among them) hide on narrow bars as intended: the label was bare text the rule could not reach.
- On a phone, the studio's picture fills its stage: a rule of the atelier shortened it and left an empty band.
- `npm run dev:personal` works again: `wrangler dev` gave every request the address of the deployment's routes, so the Worker could not tell the editor from the vault. The dev server runs on a copy of the config without them.

## [0.10.0] - 2026-10-18

### Added

- **The command line's renders run in the sandbox**: the runtime page the CLI drives evaluates and draws whole frames in the plugin sandbox when the project has plugins — stills, the assistant's previews and the frame capture included; `?sandbox=0` opts out. Step 4 of [docs/evaluator-sandbox.md](docs/evaluator-sandbox.md).
- **With the sandbox flag on, the plugins' modules no longer load on the page at all**: the registry takes its nodes, effects, modifiers, tours and translations from the sandbox's declarations (schemas and the same sandbox-backed wrappers), and the asset store skips the plugins' files; the flag flips at runtime and the registry is rebuilt from the other source. Step 5 of [docs/evaluator-sandbox.md](docs/evaluator-sandbox.md).
- **The stills and the web exports can run in the sandbox** (the same flag, when the project has plugins): the PNG sequence, GIF, WebM and MP4 ask the sandbox for each frame — videos decoded on the page first, one picture back, read as pixels or blitted for the capture-based MP4 encoder — and the stills (assistant, contact sheets, storyboard) do the same for their JPEGs.
- **The preview can run entirely in the sandbox** (experimental, off by default): a setting makes the viewport blit the sandbox's finished frame — modifiers, Canvas2D effects and simulations evaluated in the worker, video frames still decoded on the page, the checker behind transparency as anywhere. With the flag on, a plugin's code never runs in the page. Step 2 of [docs/evaluator-sandbox.md](docs/evaluator-sandbox.md).
- **The sandbox renders whole frames**: the per-project worker now owns an Evaluator, the built-in registry and the plugins' modules, evaluates a composition at a time — modifiers applied, Canvas2D effects stacked, simulations stepped inside — and returns one finished picture over a transferable. The frame primitive of [docs/evaluator-sandbox.md](docs/evaluator-sandbox.md) (series step 1); the preview's flag comes next.
- A **design note** on moving the evaluator into the sandbox ([docs/evaluator-sandbox.md](docs/evaluator-sandbox.md)): why the last four page-side pieces of plugin code (modifiers, Canvas2D effects, the stepping of simulations, the module's load) are one move and not four patches, the options priced, and the series that ships the whole-frame sandbox behind a flag.
- **3D models join a project like any material**: `.glb` and `.gltf` files are accepted by the home screen, the chat's attachments and the sources import — they become `model` assets, the panel lists them under their own label, "create a layer" places a `model.3d` layer bound to the file, and an attached model tells the assistant where it is and how to place it.
- **The plugins' geometry crosses the sandbox**: a node's outline is built in the sandbox with a recording Path2D and arrives with its picture as SVG path data (clips and the viewport rebuild it), its viewport handles come as plain data, and its vector export (`svg`, `lottie`) is computed in the sandbox and primed before a conversion reads it — none of the plugin's geometry code runs on the page.
- **An archive's plugins are validated in the sandbox**: the import imports them in the per-project worker and validates the document against their declarations — the page never runs their code at import time (an accepted archive used to be imported on the page just to be validated).
- **The sandbox draws the plugins' nodes**: a node that needs no synchronous geometry on the page (no `path`, `handles` or vector `export`) is drawn in the per-project worker — evaluated props, frame numbers, simulation states and the other layers' data cross as plain messages, and one transferred picture comes back per layer over its bounds; the first pass of a frame defers, so stills and exports keep waiting for the exact picture while the preview keeps the last one. Modifiers, Canvas2D effects, simulation stepping and geometry nodes stay on the page, documented (stage 2 of [docs/plugin-isolation.md](docs/plugin-isolation.md)).
- The **editor runs the plugins' tools and checks in the sandbox**: the preview, the stills and the browser exports load plugin modules with their authoring code left out, and the registry carries sandbox-backed entries instead — `use_tool`, the `/` menu and the checks call them the same way, with no page rights on the other side (stage 1 of [docs/plugin-isolation.md](docs/plugin-isolation.md)).
- A **plugin sandbox**: a per-project browser worker where plugin modules can be imported and their tools and checks run with no page rights — the protocol, the worker (its own bundle, its network narrowed to its own origin), the page-side host that bridges files, writes, stills, transcripts and aborts, and the registry wrappers, with end-to-end tests of the pair ([docs/plugin-isolation.md](docs/plugin-isolation.md), stage 1).
- The **code question names what each plugin brings**: the import's inventory reads each plugin module's text (without running it) for its declared exports — nodes, effects, modifiers, tools, workflows, checks, kits, presets, tours — and the dialog lists them per plugin file, so what is accepted is known before it runs.
- A **design note** on isolating untrusted plugins ([docs/plugin-isolation.md](docs/plugin-isolation.md)): the options (the main thread as today, a dedicated worker with OffscreenCanvas, a strict CSP with a reduced API, a Wasm/QuickJS sandbox), their costs, what each takes from the plugin API, and a staged recommendation — the code moves only once the author picks.

### Fixed

- **3D models** come in by every door: the Assets panel imports .glb and .gltf files (they were refused as an unsupported format) and lists them under 3D models, with "Create a layer" placing a `model.3d` sized to the composition; the chat's and the home screen's file pickers offer them too.

## [0.9.0] - 2026-10-18

### Added

- A **compressor** per sound (`compress`, 0 to 1): one DynamicsCompressor between the equaliser and the gain in the one mixer — the loud moments brought down (a voice kept level, a hero that never jumps out), harder as the amount grows, in the preview and every export alike.
- Four **new commands**: `/transcript` (the words of a sound or a video, read with the moments that matter), `/cut-silences` (a new `silences` tool cuts a talking video on the gaps of its transcript — hesitations shortened, the spans laid back to back), `/beats` (the edit lands on the beats and sections), and `/still` (a new `still` tool saves a picture of the composition at a moment as an image asset).
- A **low contrast** check: the free-space analysis now carries each cell's luminance, and the check weighs a text's ink (its colour, its opacity) against what sits under it — a picture through the analysis, or the composition's background — and warns when the contrast ratio falls under 2.5:1.
- **Effect-stack presets**: a preset can now be a stack of effects applied to every selected layer at once (the add menu pushes it). Built-in: cinematic tone, dreamy glow, VHS, and a dark shadow plus halo that keeps type readable over anything.
- **3D models** placed by node matrices load: a node's matrix is read as its translation, rotation and scale (glTF's own Duck, BrainStem and many exports used to be refused).

### Fixed

- A cropped video (fit cover, the default, the one an imported video takes) drew from its layer's centre instead of around it: only a quarter of the picture showed, pushed to the bottom right. The picture is centred on the layer again, around its focal point.
- One clock and one framing for a video everywhere: the tracks, the callouts that follow them, the checks and the sound moments read a video at its start, speed and loop and through its focal point, as the picture is drawn (they assumed normal speed, no loop and a centred crop).

## [0.8.0] - 2026-10-18

### Added

- **Fonts in the style kits**: each built-in kit names its typeface (Newsreader for Editorial, IBM Plex Mono for Hairline, Archivo Black for Punchy, Karla for Calm, Space Grotesk for Neon). Applying a kit fetches its woff2 once, keeps it in the project as a font asset, and the recipes write in it; the project keeps its own font if it has one.
- Six **new recipes**, laid out as ordinary editable layers like the others: a **map journey** (a line travelling stop to stop on a map, revealed in step with the riding dot), a **word-by-word quote** with its author line, a **logo reveal** (iris, wipe or rise) that holds, a **list** that ticks in (tick, number or dash markers), a **timeline** that draws itself across the frame, and a **split screen** of two or three sliding panels.
- A **background removal** tool (`remove-bg`): the U²-Net matte run once on a picture becomes the alpha of a PNG saved as a new image asset, placed as its own layer — titles and graphics pass behind the subject.
- A **free space** tool (`space`): a frame read as a small grid of how busy each cell is (edges, robustly scaled), saved as data with the clear sides and the largest clear rectangle in fractions of the frame — where a title or a caption block fits without covering what matters.

- A **lip sync** tool (`lipsync`): the words of a transcript drive a drawn character's mouth — the nine classic shapes (closed, M/B/P, F/V, A/I, E, O, U/W/Q, L, other) written as keys on a sequence's `drawing`, closed between the words, remappable with a mouths map.

- Three **simulated nodes**: a **rope** (tied to the layer's origin, pulled towards another layer, swinging in the wind), a **cloth** (pinned along its top edge, falling and catching a wind that breathes) and a **flock** (boids that steer together across the frame, deterministic on its seed). Stepped frame by frame from the layer's in point, so exports and previews agree.

- A **3D model** node (`model.3d`) and its `model` tool: a .glb (glTF 2.0) joined to the project is drawn in 3D on the node's own WebGL2 context — rigid animation of its parts, a turntable spin, an animatable explode, studio, sun or flat light — with a lean parser of the format (`packages/nodes/src/gltf.ts`, no skinning: skinned meshes draw at rest). Model files join a message or the sources like any material.

- A **WebGL2 service for node plugins** (`render.gl`): a node gets a context of its own, kept from frame to frame (its compiled programs, its uploaded meshes), sized to its bounds and drawn into the layer; a failure lands in the error bar like any node's.

- **Depth** (`depth` tool): the depth map of a photo or a video, read in the browser (Depth Anything v2 small, WebGPU or the processor), saved as a grey file (bright where near) played by a hidden layer, and wired: `fx.parallax` moves the layer the way the composition camera would, a photo also takes `fx.depthBlur`.
- **Photo in 2.5D** (`photo-2.5d` tool): one pass that reads the depth of a still photo, adds the composition camera with a slow drift and scales the photo past the relief's widest stretch, so nothing shows at its edges.
- Two layer effects behind them: **Depth parallax** (`fx.parallax`, a per-pixel relief from the map, linked to the camera) and **Depth blur** (`fx.depthBlur`, a depth of field with an animatable focus for focus pulls).

- Two light themes, **lin** and **porcelaine**, beside papier: the picker now draws eight of them with their own colours, four to a row (the dark ones above, the light ones and system below), and the window bar and the page's colour-scheme follow.
- A filmstrip along the video clips: the clip shows its film as small thumbs, decoded in the background from the preview's own decoder (one at a time, a thumb every quarter second shared by the clips of a file, nothing while the film plays, a small memory of the recent ones). The thumbs follow the cut and the speed.
- The videos' **Speed** (0.25× to 4×), the pitch of their sound with it, the sound of the exports and of the preview alike; trimming a video's head carries its start at its speed.
- The fades of a video or a sound as two handles at the clip's top corners: drag one, the fade follows, snapped to frames.
- The markers at the keyboard: **M** drops one at the playhead, **1** to **9** jump to the markers in order.
- A **crossfade** with the layer under it, from the clip's menu: opacity keys on both over the time they share. An opacity already animated is never touched.
- **Loop the section to the end**, from the clip's menu of a video or a sound: what plays past the section starts over from the start in the file (the sound loops natively in the mixes; in the preview a looped video's sound is close but not exact — the exports are).
- The **adjustment layer**: it draws nothing of its own — its effects apply to everything under it in the stack (a grade over a scene, one blur for a set). A composition without one pays nothing.
- The project's **versions**: the clock beside the save state keeps instants of the project (the document saved first, so a version says exactly what is on screen), each restorable from a list, each removable.
- The home screen's **search**: from six films on, a field at the right of "Your films" filters the cards by name.
- A **text over detail** check: once the free space tool has read a frame, the checks warn when a text sits on its busy cells (about a third of the text's area or more) and point at the clear rectangle the analysis found, so a title moves where the picture is quiet.

### Changed

- The home screen's cards keep one thumbnail ratio (16/10, the film filling its box cropped): the rows stand as tall as each other whatever the film's format, where a vertical film used to stretch its whole row.
- The lines between the atelier's panels show at rest instead of hiding in the gutters, each says what it does (the chat's: "drag: the chat grows or shrinks"), and the tours' "The tricks" has a step on them.
- The tours' "The tricks" also tells the clips' thumbs and fades, the crossfade and the loop, the videos' speed, the markers at the keyboard and the versions.
- Under the hood: the free space tool reads its video straight at the grid's size instead of decoding a full frame for a handful of cells, glTF meshes are parsed once per node (three reads before), a node's own WebGL canvas is capped at 2048 px (a zoomed node used to ask the GPU for a canvas as big as the frame) and only grows, shared by the type's layers at their own sizes instead of reallocating its buffers every frame, a photo's depth map is saved at 1024 px at most (4096 held no more depth than the model reads), the kits' fonts are pinned to one version so every film gets the same file, the transcript the tools read is picked in one shared helper, and document attachments tell the assistant their size.
- The cloth's **Sway** is a period in seconds, 1.6 by default: the rhythm the wind had before it was read as one.

### Fixed

- Clicking **Export** while an export runs no longer closes its progress, and a finished file is no longer lost by a click beside: it waits in the export popover (a small dot on the button says so) with its save buttons.
- The settings' section descriptions sat unstyled on the cards' top edge, half outside; the theme picker crushed its previews to pills and wrapped eight themes as six plus two.
- The storyboard's play button turned into a bare disc when playing: its pause icon drew nothing (a stroke path forced into a filled button).
- The examples' cards stood upright, their thumb a small centred picture: they are horizontal cards again (thumb beside the text), as designed.
- **Lip sync**: a mouth holds its shape for the word instead of snapping shut between letters (each key now holds until the next), the mouth closes again after the last word, and the transcript's language drives the phonemes, so a French line is no longer mouthed as English.
- The free space analysis measures its grid's border cells too (the frame's edges were read one cell off, held at nothing).
- The recipes' hidden pieces do their work again: the logo reveal's iris and wipe really apply their mask (it was left out of the matte), the map journey's line is revealed by its rectangle, and a kit whose typeface cannot be fetched still applies its colours. The wipes and the timeline line grow from their starting edge, and the journey reveals from where it starts, whatever way it runs.
- The **crossfade** fades the layer that ends first, whichever of the pair it is; it is not offered when one clip holds the other (either would vanish while it plays alone), and it works on a layer without a transform of its own.
- Three of the five kits' fonts (Newsreader, Karla, Space Grotesk) could never be fetched: the font CDN keeps variable fonts under another address.
- The recipes' entrances squeeze before their fade out when time is short (a slow kit, a one-second piece): their keys used to come out of order and the whole piece was refused.
- **Depth**: a depth video follows its source's trim and speed (it played the file from its start, ignoring the clip's start and rate), the layers the tool adds copy the source's playback settings, and photo 2.5D no longer grows the photo a little more every time it runs. A photo's depth of field reads the hidden map layer (it named the map's file, which the document refused, so it never drew), its parallax survives the depth of field joining it, and its framing is its own scale times the margin, once, whichever tool runs first (an inset stays an inset).
- A **looped section** sounds and previews as it should: the mixes wrap what plays past the section back into it (the raw offset used to run on into the file's remainder), and the preview seeks inside the section at the clip's speed. A section that starts past its file's end no longer fails the mix.
- The tools that pick a media by default (logo reveal, split screen, background removal, 3D model) no longer take an asset a tool made beside it (a depth map, a cut-out) in its place, and they take the selected layer's own media, a 3D model's included. The depth tools no longer skip a layer of yours whose name holds "-depth".
- The timeline's filmstrip no longer hangs the tab on a clip narrower than one thumb (it asked for thousands of canvas slots), and it reads a video layer's static start instead of breaking on it. It no longer decodes forever when the clips on screen ask for more thumbs than its memory holds, and the last thumbs of a batch show without waiting for another repaint.
- The free space's clear margins measure inward from each edge (they counted cells along it), and the text-over-subject and text-over-detail checks read a video at its speed and its loop.
- Running **background removal** again refreshes the cut-out it placed instead of adding a second one.
- The **versions**: restoring one no longer meets the "unsaved changes" guard on reload, and a version pushed out by the thirty kept is deleted from the project instead of piling up unseen.
- **3D models**: meshes without index buffers load (their vertices are read in order), the whole model's bounds follow each part's transform, so a rotated, scaled or offset part no longer falls outside the frame, the turntable spin turns the model about its own centre (one authored away from the origin used to orbit instead of spinning in place), and a replaced model file is read again.
- The **simulated nodes**: the rope reaches its target from wherever its own layer sits (the target was read in the composition while the rope lives in its layer) and `length 0` keeps the distance it starts with instead of tracking the target's every move; the cloth's wind breathes at the period the field promises (it played as a frequency, too fast at the default).
- **Background removal** places the cut-out over its source picture, with its position, scale, rotation, crop and span, instead of centred in the frame.
- The keyboard: **M** and **1** to **9** answer only when no modifier is held, so the browser's own shortcuts keep working in the atelier.
- Map-journey stops written "0.2, 0.3" (spaces after the commas) parse as pairs instead of being dropped, and the recipes no longer crash naming a layer whose asset has gone missing.

## [0.7.1] - 2026-10-18

### Changed

- The studio's notes panel is resized like the atelier's panels: a handle between the film and the panel, from 330 to 640 px, remembered from one session to the next.
- The studio's note box grows to four lines, then scrolls; the film keeps the room of the box at its tallest, so writing neither shrinks it nor covers it.

### Fixed

- The model menu in the studio's notes panel was crushed to nothing: it keeps its room, its name shortens first, and on a narrow panel the route label (Companion) gives way instead of the buttons, the new conversation's included, being pushed out of the panel.

## [0.7.0] - 2026-10-18

### Added

- The studio, the default view of a project: the film in front, directed by notes. A note is written in the box under the picture, pinned to a moment or a place of the frame if needed, and the assistant answers with a take shown on the picture, kept or set aside. The storyboard below shows the scenes with their frames, the sound and the notes at their moment; a click on a scene puts the notes on it. The Direction panel holds the brief (subject, tone, rules), the look and the material of the film. The former layout stays as the atelier, one switch away in the top bar and the settings.
- The Transcribe button: on a sound or a video joined to a message, on the material of the film, in the assets, in a new "Speech" section of the inspector of sound and video layers, and in their menus. It reads the same state everywhere: to transcribe, under way, transcribed.
- The timeline's own menus on the right click. On a clip or its name: split at the playhead, trim the start or the end to the playhead, bring it to the playhead, then the layer's menu (the same as in the layer list). On an empty place or the ruler: the playhead or a marker there, end the composition there or at its content, add a layer, select all, the whole timeline in view. On a marker: go there, delete it. On a keyframe: go there, its curve.
- Guided tours "The tricks" (atelier: timeline zoom and lasso, snapping edges, cutting a video, the right click, scrubbing and arithmetic in fields, expressions and modifiers, the keyboard, export) and "Speech and transcription" (both views: where to transcribe, what the assistant does with the words). The editor tour's timeline step tells the new menus.
- The interface is bundled with its fonts (Geist and Geist Mono, OFL-1.1): it looks the same on every machine, offline included.
- A theme of previews in the settings: each of the five themes (studio, obsidienne, carbone, crépuscule, papier) is picked on a small picture drawn with its own colours, and "système" follows the computer's light or dark setting; papier joins the site's light palette.
- The lists of choices (a project's format, the frame rate, a property's choices) open the editor's own menu: a line of detail can sit under a choice, the chosen one carries a check, and the keyboard works through them (arrows, Enter, Escape, first letter). On a touchscreen the native list stays.
- A take announces itself with a clapperboard: a `clap` icon on its pill and its card, "Prise N" in the theme's accent.

### Changed

- The landing page follows the app: the studio first ("Motion design, directed in words", a new Studio section with its notes, takes and direction), then the atelier with its timeline menus; new pictures of both views in the paper and studio themes; the site's colours are the editor's paper and studio tokens; its words are a motion designer's (keyframes, curves, wiggle and loop, a style named once; the JSON and the terminal are links for the curious, no longer the pitch); sections are surfaces on the ground with gutters instead of hairlines, the top bar a floating pill, and the glows are gone. What the page loads is unchanged but for the studio's picture, lazy.
- Nothing is transcribed on its own any more: not a project made from a video or from sources, not a file joined to a message. The user starts it with the Transcribe button; when the assistant needs the words of a media not transcribed yet, it asks first in the conversation (a turn left alone never asks, and works without them). The project's first greetings say so.
- Dragging the left edge of a sound or a composition cuts its head off like a video's: what follows stays in place (its start in the file carried, at its rate or speed).
- The browser's menu no longer opens on the timeline, the transport, the curves or the storyboard (it stays in text fields), and a right press on the ruler no longer moves the playhead.
- One art direction for the whole application, built only on the theme's tokens (the reference board is `docs/design/board.html`): Geist everywhere (13 px base, Geist Mono for timecodes and values), text buttons as pills, icon buttons as 8 px rounded squares, fields without borders that take a 2 px accent ring on focus, panels and cards as 14 px surfaces set on the background and separated by 8 px gutters instead of seams, dialogs at 20 px over a blurred scrim. No colour is written outside the theme files any more; the playhead, the selection and the focus are the accent's, never a red of their own.
- The studio is dressed like the rest: the violet of the assistant, its gradients, halos and sparks are gone. Tramme at work is its mark breathing and a 2 px accent ring around the picture; the notes' numbers, the pins and the stage tags are the theme's accent; the storyboard's sounds are drawn (music neutral, voice accented, effects as ticks, heroes warm); the playhead is the same line in the studio, the storyboard and the timeline.
- The atelier is panels on a background: the left panel, the viewport, the bottom and the inspector are rounded surfaces in gutters, and the resizers hide in the gutters (an accent line while dragged). The viewport's toolbar and banners float as pills over the picture; the transport reads its time in mono; the timeline's clips keep their layer's colour and the chosen one takes an accent ring; the curves sit on a soft surface with their presets in a floating pill. On a phone, the tabs float in a pill above the safe area.
- The assistant speaks in one thread in both views: the notes with their number, the work as stages (its steps one click away) and the takes as cards, in the studio's side panel and in the atelier's assistant alike — the bubbles are gone.
- The settings' rows are grouped in cards, one section at a time under its title; the navigation reads as rounded lines. The guided tours follow the new shapes, and every `data-tour` marker stands where it was.
- The home screen's cards show each film at its own aspect ratio on the picture's stage colour: a vertical film no longer leaves empty bands beside its preview, and the examples follow.

### Fixed

- A field focused by the keyboard showed a doubled outline: the global focus ring painted on the field's inner input as well as on the field itself. Text controls now answer with their container's ring alone, and sliders and colour swatches keep a thin one.
- The projects' thumbnails left see-through bands (a checkerboard) beside vertical films: the thumb now takes the film's aspect from its manifest.

## [0.6.0] - 2026-10-11

### Added

- Markdown documents (`.md`, `.markdown`) come in with the sources now: dropped on the home screen, chosen with "From sources (files)" or a whole repository folder, or joined to a message. The assistant reads them whole with the sources tool (a long one continues with `read_file`), the way it reads a PDF page by page; a folder's `README.md` alone is enough to open a project from its sources.

### Changed

- The local companion runs the Antigravity CLI (`agy`, a Google login) in place of the Gemini CLI, which Google retired for personal accounts on June 18, 2026. The model menu offers it as "Antigravity", with the models it lists for the login (`agy models`: Gemini 3.1 Pro, Gemini Flash, Claude…), apart from the Gemini models of an API key; its default model takes an effort level. It runs with a home of its own under `~/.tramme/engines/antigravity`, so the user's plugins, skills and MCP servers stay out; it gets tramme's tools, and of its own only the reading of the images joined to the message. A model chosen for the Gemini CLI becomes Antigravity's default.

## [0.5.0] - 2026-10-11

### Added

- Importing a `.tramme` project that carries code — plugins, or expressions — now asks first, listing what it would run (the plugins with their file and size, the expressions with where they are). Nothing runs before the yes, and a refusal writes nothing. The shipped examples skip the question.
- With a finger, a long press opens the same menus as a right click: a keyframe's curve and delete, the layers, the compositions, the assets, the tokens and the project cards. A press held still never moves a key or a layer.
- Dragging over the timeline's tracks or the curve editor's background draws a lasso that selects the keyframes it covers, across layers and properties. Shift adds to the selection, Ctrl/Cmd flips it, and a selected group moves in one undo entry. With a finger the drag still scrolls.
- A path's vertices and tangents are manipulable in the viewport, for any node that declares a `path` property: drag a vertex (its tangents follow), drag a tangent with Shift held to keep the two mirrored, Alt+click the stroke to add a vertex, Delete to remove the selected one. An animated path gets a keyframe at the current time. The anchor cross drags too: the layer stays put on screen (the position compensates), Alt moves the anchor alone, and an animated or driven transform refuses with an explanation.
- An onion skin for drawn animation: with a sequence layer selected, the toolbar's onion button shows the previous drawing in red and the next in green over the picture, following the playhead at rest (hidden while playing or dragging). Never part of the document or the exports.
- Shorts: the title of each short lands with its first sentence (not at a fixed 0.2 s), each passage of the plan takes a strong word (keyword) that pops on screen the moment it is said — a word never said comes back in the answer — and a project with a brand (the plate and ink tokens) gets its progress bar and end card, the card lengthening the short. The build answers with a contact sheet of the shorts, a one-line check summary per short, and the export panel offers all the shorts at once, exported one by one, named after their titles and kept in renders/.
- A three-band equaliser on every sound (Sound layers and the sound of videos): `eqLow` (shelf at 120 Hz), `eqMid` (bell around `eqMidFreq`, 200 Hz to 8 kHz) and `eqHigh` (shelf at 8 kHz), in dB. A band left at 0 builds no filter, so an untouched mix sounds exactly as before.

### Changed

- The home screen's header is one door: a single New project button opens every way to start — blank project, a video, sources from files or from a folder, a `.tramme` or Lottie file. Dropping a file on the page opens it as before.

### Fixed

- The curve editor drew no curves: the path was built with a `W` where an `L` was meant, so keys and handles were there but the line between them never appeared. The background's click and lasso also stop being eaten by the grid and the curves themselves.

## [0.4.0] - 2026-10-10

### Added

- Sound that follows the picture: cues read from the animation's own timing (cuts, moves at their fastest, landings, appearances, about one hero in four seconds), placed on with `on: heroes, cuts, moves, lands, appears`; a hero stacked from several sounds (`sound: "a+b"`) with the music stopping before it and thinning out into it; `sound-find` brings CC0 recordings from Freesound (through Openverse), judged automatically, into your library with their credit; `mix` balances each effect against the music and voice band by band; `credits` writes where each sound comes from. The sounds placed go in a `Sound` group.
- Every export is mastered: a composition's `sound` settings bring it to a loudness (-14 LUFS by default, BS.1770) with its true peak under -1 dBTP, and give its effects one shared room. Audio layers say their `role` (effect, music, voice, ambience), `weight` (support, hero) and what they underline. The preview plays the same master.
- The check measures the mix: the master's loudness and peak, each effect on its cue and heard over the bed, the music under the voice, unplanned dips and silences; it shows a picture of the mix and lists moments to check by ear.
- ElevenLabs voice-overs with Eleven v4 by default, and v4 Turbo, v3, Multilingual v2 or Flash in the Sound settings; the style of a voice-over (an accent included) becomes an audio tag on v4 and v3. Music with `music_v2_5`. A voice picker in the Sound settings and a `voices` tool list the account's voices and the shared library's, filtered by language and accent.
- Fold or unfold every group at once (layers and timeline, one state for both; Alt+click folds a whole branch), and find a layer by its name.
- Several clips selected in the timeline (Ctrl+click, Shift+click, a band drawn in an empty part, Ctrl+A) move together; moved edges snap to the playhead, the markers and the other clips (Shift held: free).
- Waveforms in the sound clips of the timeline, and a solo button that plays one sound alone in the preview.

### Changed

- When the assistant applies its changes by itself, it no longer stops on a question: paid generations count against an allowance per turn (Sound settings), and it decides what a sensible choice answers instead of asking. A question asked during a turn shows in the conversation, and the user is told when away.

### Fixed

- The eye of a hidden layer and the clip badge keep their columns in the layer tree.

## [0.3.0] - 2026-10-10

### Added

- "From sources" takes a whole folder, chosen or dropped, its subfolders walked through. A kit among the files (a `brief.json` of kind `tramme-kit`, as an agent writes it from a project's repository) sets the project up: its name, its colours and curves as tokens, the fonts it names as font assets, its brief; the whole kit stays at `assets/sources/kit.json`, its paths pointing at the files as imported, and the assistant reads it first.

### Fixed

- An SVG with a viewBox and no size of its own (most logos) no longer stops the preview and the renders: it is drawn in its viewBox's proportions, 2048 px on its longest side.

## [0.2.0] - 2026-10-09

### Added

- The local companion runs Codex (a ChatGPT login) and the Gemini CLI (a Google login) besides Claude Code: it finds them on the computer, the model menu offers them ("ChatGPT (Codex)", "Gemini CLI"), and they reach tramme's tools as an MCP server held for the turn, with no shell, files or web of their own. Each keeps its session for the next message; switching agents midway hands the conversation over as text.
- The assistant's access puts the AI accounts first: with nothing connected, its panel offers to connect Claude, ChatGPT (OpenAI) or Gemini, and the local companion folds under it (never offered on a phone). When the chosen model cannot be reached but another AI is connected, its strongest model is taken and the user is told. The settings list the providers before the model and the companion.
- Projects from sources: "From sources" on the home screen (or several files dropped on it) brings documents (PDF), pictures, videos and sounds into a new project (`assets/sources/`). The `sources` tool lists them on a contact sheet and reads each one (a document's pages as text and pictures, a video's frames with what is said); the `/analyze` workflow reads them all, writes what it learned in the brief (`about`, `sources`) and proposes directions for the video before building. PDF documents join the project format and can be attached to a message. Tool contexts gain `files()` and `fileUrl(path)`.
- Personal mode, a public deployment without accounts (`npm run deploy:personal`, docs/deploy.md section 8): projects stay in each visitor's browser (IndexedDB, served by a service worker with the same routes as the Worker), keys in a key vault of another origin that the editor and the plugins cannot read, and the browser calls the providers itself (a relay that keeps nothing for those that refuse calls from a page). The server keeps nothing.
- `@tramme/api`: the storage and provider routes shared by the Worker, the service worker and the key vault, with a storage contract every bucket passes (R2, IndexedDB, memory).
- Example projects "Launch film" (45 s on the beat, nested compositions, a 2.5D camera, sound-reactive motion, music written as code) and "Showreel" (made by the assistant). "Hello", "Night sky" and "Road trip" leave the examples; the first two stay as test fixtures.

- Plugin tools: a project plugin can export `tools` that the assistant runs with `use_tool` (analyses, layouts, generators). A tool answers with text and images and may propose changes, which join the assistant's proposal.
- Notes for the assistant (`ai: { when, avoid, example }`) on nodes, effects, modifiers and tools; `list_nodes` and `tramme nodes` now list modifiers and tools too.
- Chat commands: typing `/` lists the tools and workflows (`/captions`, `/title`, `/keyword`, `/lower-third`, `/dress`, `/review`, and those of the project's plugins). A tool with its form filled runs at once, without a model; words after the command hand it to the assistant.
- Plugin workflows: a project plugin can export `prompts`, instructions for the assistant picked from the `/` menu.
- Quality checks: text too small, too brief or past the safe zone, overlapping text, text crossing an element, crowded entrances, still stretches. The `check` tool (assistant and `/check`) runs them and shows a contact sheet of the key moments; `motion` shows a strip of frames to judge a movement. Plugins add their own `checks`.
- Recipes: `kinetic-title`, `bar-chart`, `stat` and `transition` lay out whole animated pieces as editable layers; style kits (editorial, punchy, calm, neon) set the colours, curves and pace they follow. Plugins add their own `kits`.
- Perception tools: `beats` analyses music (tempo, beats, bars, sections, loudness per band), `shots` finds the cuts of a video, `subjects` finds the people in a video or an image (a small model run in the browser), `palette` turns the colours of a picture into tokens.
- Following the music: the `react` modifier and `audio()` in expressions make any property move with the beats, bars, hits or loudness of an analysed sound.
- Check `text-over-subject`: warns when text covers a face, once the people are known.
- Text behind the subject: the `cutout` tool (assistant and `/cutout`) cuts the person, or the main subject, out of a video layer with a small model run in the browser, saves the matte as a mask video timed like the file, and adds the same footage through that mask above the video. Titles placed between the two pass behind the person, in the preview and in every export.
- GPU effects: plugins write layer and finishing effects in GLSL; new built-in effects `fx.matte` (track matte from another layer), `fx.displace` (displacement map), `look.chromatic` (chromatic aberration), `look.grade` (colour grade in linear light). New property type `layer`.
- In the preview, a layer or effect that fails is drawn as a red frame and named in the error bar instead of blanking the whole picture.
- 2.5D camera: a composition can have a camera (pan, zoom, perspective, focus, depth blur) and layers a depth, for parallax and depth of field.
- Viewport handles declared by nodes (the rectangle's corner radius, plugin nodes' own points).
- Presets in the add menu: neon title, frosted card, light leak, spotlight; plugins add their own `presets`.
- Plugin nodes can say how they export to SVG and Lottie (`export.svg`, `export.lottie`).
- Plugin manifest (`meta` with the plugin API version, checked at load) and the `@tramme/plugin` package (types, `definePlugin()`).
- Plugin library shared by the projects: keep a project's plugin there and use it in another (`/library-add`, `/library-use`).
- Simulations: a node can carry a state from frame to frame (`simulate`), stepped deterministically with checkpoints; nodes read other layers with `host.layer()`. New `follow` node: a dot following a layer on a spring, with a trail.
- The assistant knows when each built-in node, effect and modifier fits (notes in `list_nodes`).
- Example project "Night sky": a project plugin with a node, a tool and a workflow.
- Plugins roadmap: `docs/plugins-roadmap.md`.
- Sound roadmap: `docs/sound-roadmap.md` (sound effects, ambiences and music made by the assistant in the editor).
- Sound library: 421 recorded sounds (Kenney's packs, CC0: impacts, interface, digital, jingles, sci-fi) measured and described in `sounds/catalog.json`, and 13 sounds written as code (whoosh, riser, sub boom, cinematic impact, glitch, sparkle…); your own sounds in a library shared by the projects (`/api/sounds`).
- Sound tools for the assistant and the `/` menu: `sfx` searches the library and places a sound on the moments the document names (entrances, exits, markers, cuts, beats, bars), its hit on the frame, its variants alternating; `synth` makes a sound from Web Audio code and answers with its waveform and measures; `duck` lowers music under a voice; `sound-keep` keeps a sound in the library; `generate-sound` has a provider make a sound effect, a music bed (ElevenLabs) or a voice-over (ElevenLabs, OpenAI, Gemini). The `/sound-design` workflow, and the assistant's guide for sound.
- The `generate-image` tool (assistant and `/generate-image`): a provider (OpenAI, Gemini, Z.AI) draws a picture the project lacks — a background a title reads over, a texture, an illustration, a prop — from its prompt, in the proportions of the composition; the file and what made it (`assets/images/<name>.image.json`: prompt, provider, model, proportions) join the project, the picture is proposed as an image layer (filling the frame or whole, over the whole composition or from a time, in the background on demand), and the tool answers with the picture so the assistant judges what was made. The keys stay in the Worker (`/api/generate-image`, `/api/config` lists the providers that draw); nothing is sent without the user's yes (the same setting as the paid sounds). The assistant's guide says when to have a picture made and why words never go in one (text layers say them).
- Generation roadmap: `docs/generation-roadmap.md` (pictures made by a provider, then takes, image to image, moving pictures, and what checks read in a picture).
- Motion figures: what the numbers of an animated property say (`packages/core/src/motion.ts`), sampled from the same evaluation the render uses — how far it travels, peak speed and when, evenness of the speed (1 is the linear tell), direction changes, how far it overshoots its end value, and when it settles. The `motion` tool answers with the figures of the span's biggest travels beside its strip of frames, so the assistant judges a movement with its numbers, not only the spacing. New checks that read them: `linear-travel` (a position or scale at constant speed for 0.3 s or more: ease it; a spring, a wiggle or any turn stays silent), `spring-settle` (a spring still moving when its layer leaves: more damping or more time; or overshooting its mark by more than 30%: one bounce is lively, more is nervous) and `twin-motion` (two layers whose positions follow the same series: offset, stagger or vary one). Motion roadmap: `docs/motion-roadmap.md`.
- Motion taste: the craft's rules, distilled from the public references of the field (the Animator's Survival Kit, Disney's twelve principles, the Material, Carbon and Apple motion systems, kinetic typography) and encoded where the engine acts on them. A "Motion" section in the assistant's guide: space before time (an even speed is the missing ease), entrances of 200 to 400 ms eased out and exits faster, one moving subject at a time with an uneven stagger, anticipation, arcs on the long travels, settles instead of hard stops, springs for what lands and curves for what intends, the reading time of text, and curves defined once as ease tokens (out, in, standard, emphasized, also named in `docs/document.md`). Three checks that read the figures: `abrupt-entrance` (the first move after a layer appears runs at full speed: ease it in), `straight-travel` (a big diagonal travel that keeps to its straight line: bend the move) and `uniform-stagger` (a group entering with even offsets: vary the gaps). The `/polish` workflow runs the whole loop on a composition: check and motion tools, the fixes the guide asks for, check again. The `bar-chart` recipe's fades now ease with the kit's curve. Taste roadmap and sources: `docs/taste-roadmap.md`.
- Motion sense everywhere the model looks: the notes per node family carry what each thing's movement should be (text moves as a block or word by word, a counter rolls with an ease out, a bar draws along its x, a path draws itself over 0.4 to 0.8 s, a callout follows without lag, captions pop on the spoken word, a group staggers its children, footage drifts or zooms slowly and never both); the style kits expose the four curves as tokens, `standard` and `emphasized` beside `enter` and `exit`, flavored per kit; and the `motion` tool reads the pixels of its frames (optical flow by block matching between two stills): it says when the whole frame moves and how fast in px/s, and points at the blocks that move against the rest — a background that should hold, something crossing the move.
- Themes: the interface colours become a list of themes, one palette chosen in the settings and kept in the browser: Studio (the former look), Obsidian (near-black, the chrome recedes into the room), Carbon (pure graphite, no blue in it), Dusk (a warm dark for the long sessions), Paper (the former light grey), and System (follows the computer). The meaning of colours stays across themes (selection, keyframes, expressions, links); the picker shows three swatches per theme, and an old preference migrates.
- Display modes: the same interface, laid out differently (top bar's expand button, or the settings). The editor stays the default; Cinema gives the film the whole window — the panels become floating glass cards summoned from the edges (layers, properties, the transport and the timeline as a bottom drawer); Conversation makes the assistant thread the main column, with the film beside it and the layers one edge away. A display change re-measures the stage.
- The `shorts` tool (assistant and `/shorts`): a long video as shorts, in two calls. First the candidates: the transcript grouped on pauses and sentence ends into passages that stand alone (15 to 45 s by default), each with its times and what is said. Then a plan of passages built into one composition per short: the video filling the asked format (vertical 1080×1920, square, horizontal) and starting at the passage's `start`, the transcript remapped to the short, saved as its own asset and captioned (the `captions` template), the title with its bar (the `title` template). Each short is an ordinary composition: editable, checked and exported like any other. The frame follows the speaker: `focus` on the video layer (the point of the picture kept at the centre of the frame, as the image layer had; animated, it follows the subject in a cropped frame), which the build animates across each short from the subjects analysis of the video when there is one — the biggest person of each analysed frame, held when nobody is found, drifts under 4 % of the picture ignored. The `/shorts` workflow, and the assistant's guide for shorts (a short stands alone, hooks in its first sentence, ends on a point). `transcriptIdOf` moved to `@tramme/core` with the rest of the transcript domain. Shorts roadmap: `docs/shorts-roadmap.md`.
- Sound layers: volume animatable (fades, ducking), `fadeIn`, `fadeOut`, `lowCut`, `highCut`, `reverb`, and `rate` (speed and pitch) on audio layers; the same but `rate` on the sound of videos.
- The `check` tool reads the mix: clipping, a mix far too loud or quiet, two sounds starting together.
- Sound settings (Settings, Sound): the preview's volume and mute (the exports keep the mix), the level of effects and music beds the tools place, how much a music drops under a voice, varying repeated sounds, asking before a paid sound (a dialog; nothing is sent to the provider without a yes), the provider and voice for voice-overs, and your sound library (listen, delete).
- Guided tour "Give the video its sound" (help menu): the library, asking the assistant, the `/` sound tools, sound layers and their properties, checking the mix, exporting with the sound.
- Assistant effort levels, chosen for each model next to the model menu and in the settings: Claude Opus and Sonnet (low to max, `high` by default, where Opus 5.5 alone would run at `medium`), and the reasoning models of the other providers (OpenAI o-series and GPT-5, Gemini 2.5 and later, OpenRouter models that reason, gpt-oss on a local server: low, medium, high, or the model's own default). A model that refuses its level runs at its own.
- The assistant tells you when it is done (Settings, Assistant): a notification from the system when the editor is in the background, a message in the editor after a long task.
- Automatic application of the assistant's changes (Settings, Assistant), turned on after a confirmation: a proposal is applied as soon as the turn is over, still checked first, shown in the conversation and undone with Ctrl+Z.
- Event lists: a JSON asset of timed events (`{ id, t, label, detail?, values, set? }`) that keep running totals: changes that add up (money in any currency, laughs, points, kilometres) or values an event sets (a weight, a temperature). Written by the `events` tool (assistant and `/events`) from lines such as `3.1 Petrol cash -18 | full tank` or `9 Weigh-in weight =72.5`, and totals written as they should look: `Cash: £23.67`, `0,00 €`, `Days: 0 day|0 days`, `Time: 0:00`. Expressions read it with `events()` (`.total()`, `.text()`, `.since()`, `.pulse()`, `.last()`…). `event-counter` puts the running totals in a corner, counters that roll at each change; `event-tags` a tag at each event (`PETROL −£18.00`, or the total it leaves; new `events.tag` node); `event-receipt` every event on a receipt typed line by line, then its totals (new `events.receipt` node). Every one of these layers reads the list as it renders: save the list again and they all follow. Example project "Road trip".
- Counters: `direction`, `down` rolls the digits back, for a value that goes down.
- Tracked callouts: the `track` tool (assistant and `/track`) follows something filmed through a video, framed by a rectangle drawn over it, a region of the picture or its name (person, car, dog… found by the detector), and saves where it is over time (`track-<video>-<name>`); a cut ends the track. The `callout` tool puts brackets and a label on it (new `callout` node) that stay on it, even when the video layer is moved or retimed. Expressions read where it is with `track(layer, name?)`.

### Changed

- The project format (still `tramme-project/1`) admits PDF documents under `assets/`. Every project of 0.1.0 opens as before; a project holding a PDF (made from sources, or with a document attached to the assistant) does not open in 0.1.0.
- Tool contexts gain `files()` and `fileUrl(path)`: plugin tools may use them; a host that builds tool contexts itself must provide them.
- Switched project license from MIT to Apache-2.0.
- Provider keys are connected in the editor, under Settings, Providers: Connect, Change key, Disconnect for Anthropic, OpenAI, Gemini, OpenRouter, Z.AI and ElevenLabs. The Worker keeps them in R2 and never sends them back; Cloudflare secrets still work, a key connected in the settings comes first.
- Custom providers: any service of the OpenAI chat format (DeepSeek, Groq, Mistral…) added by name, base URL and key; its models show in the model menu (`custom:<id>:model`).
- Settings in sections: a menu on the left (Editor: Appearance, Preview, Guided tours; Assistant: Model, Providers, Behavior, Connection) with a search that finds a setting whatever its section, the chosen section on the right; on a phone, the sections as tabs.
- The assistant's conversation with Claude is append-only: nothing already sent is rewritten, so the prompt cache stays warm and Claude's thinking stays valid. Old tool results are cleared by the API (context editing) once the conversation grows; the system prompt is cached for an hour.
- Lighter tool answers: `list_nodes` gives an index (properties as `name:type=default`, notes, tool inputs) and the full entries on demand (`types`), about 60% fewer tokens; `get_document` reads one part with `path`; `read_file` reads long files in parts (`offset`).
- Longer answers (64k tokens) on the server path; a request Claude declines goes to another model on the server (`fallbacks`), and the user is told when it is declined anyway.
- One mixer for the preview, the browser exports and the command line (`@tramme/render`): the command line mixes in its page and hands ffmpeg the finished track, instead of its own ffmpeg filter graphs.

### Fixed

- Expressions that read an analysis (`audio()`) or an event list (`events()`) now have their values in the inspector, the curves, the viewport's boxes and the assistant's `evaluate`, instead of neutral ones.
- On phones, the assistant's message box no longer slips under the tab bar when the conversation is long.
- Counters: separators and units (`,` `%` `€`) take their own width instead of a digit's.
- MP4 export: the H.264 configuration (avcC) is written from the stream itself. The one some encoders give (Media Foundation under Windows) was malformed, so Windows, QuickTime and phones refused the file ("format not supported") while Chrome and VLC played it.
- Assistant, server path: stopping during several tool calls no longer breaks the next message; a tool call whose input is invalid or cut off is no longer run with an empty input (the model is told and calls again); inputs are checked against each tool's schema on every path.
- Assistant, server path: a request part the API refuses (thinking display, context editing, effort…) is dropped on its own instead of turning off the thinking summary; retries wait as long as the server asks (`retry-after`).
- Assistant: a server that does not answer, or an answer whose stream breaks before anything was shown, is tried again by itself (twice) instead of ending the turn.
- 2.5D camera: a nested composition is drawn through its own camera (parallax and depth of field); it was ignored everywhere but in the root composition.
- Check `stillness`: a nested composition counts as playing, as a video does, instead of making its parent look frozen; its own still stretches are found when it is checked.
- Counters: digits share one cell again, as wide as the widest digit (the test looked for the letter "d", so each digit took its own width and the number shifted as it rolled); the `stat` and `bar-chart` recipes measure them the same way.
- `tramme pack` and `tramme unpack` check a project with its own plugins loaded, as the editor's import does; a project using plugin nodes (the night-sky example) was refused with "unknown node type".

## [0.1.0] - 2026-10-02

First public release.

### Engine

- JSON document as the source of truth: nested compositions, layers, groups, assets, design tokens, markers and sound. Format `tramme/1`, described in `docs/document.md`, with a JSON schema in `schema/tramme-1.schema.json`.
- Deterministic rendering: every frame is a pure function of time.
- Every property can be static, keyframed, an expression or a link, with an optional modifier stack (wiggle, loop, spring, offset, variation, smoothing).
- Open vocabulary: each layer type is a node that declares its property schema. The inspector and the validator are generated from it.
- Native nodes: shapes, path, image, text, counter, group, composition, particles, GLSL shader, code, sound, image sequence, video, captions.
- Layer effects: blur, shadow, glow, color, tint.
- Canvas2D layer renderer and WebGL2 compositor (motion blur, linear color, finishing).
- Project plugins: projects can add their own nodes, effects and modifiers as JS modules.

### Projects

- Project format `tramme-project/1` (manifest, allowed paths, checks), exchanged as `.tramme` archives. Projects created under the former names ("trame", "emotion") are still read.

### Editor

- Projects home: recent projects with thumbnails, new project (formats, frame rate, duration), project from a video, opening a `.tramme` file or a Lottie animation, examples.
- Viewport with zoom, pan, safe zones, grid, and direct manipulation (move, scale, rotate).
- Timeline (layer bars, keyframes, markers), Bézier curve editor, inspector generated from the schemas.
- Undo and redo for every change, autosave with conflict detection across tabs.
- Hand-drawn animation: image sequences held on twos or driven by an exposure sheet.
- Video layers decoded frame by frame with WebCodecs, speech transcription to timed captions.
- In-browser export: MP4 (H.264), WebM (VP9 with alpha), GIF, PNG sequence, Lottie, SVG still, WAV.
- Guided tours, settings (theme, preview quality), English and French interface.
- Mobile and touch support: tabbed panels under 760 px, a compact header with a "more" menu, pinch to zoom and two-finger pan in the viewport, larger touch targets, installable as a web app.

### Assistant

- AI assistant that edits the document through the same operations as the editor: proposals are previewed, then applied or rejected, and can be undone.
- Claude through a local companion (`tramme agent`, Claude Agent SDK) or through the server with an API key.
- Other providers: OpenAI, Gemini and OpenRouter through the server, local models (Ollama, LM Studio) from the browser.
- Image, sound and video attachments; video dressing (cuts, captions, templates).

### Command line

- `tramme` CLI: validate, still frames, offline rendering (MP4, MOV ProRes 4444, WebM with alpha, GIF, PNG, WAV) with headless Chrome and ffmpeg, Lottie and SVG export, Lottie import, pack and unpack, comparisons and benchmarks.

### Deployment

- Cloudflare Worker serving the editor and the API, projects stored in R2, access protected by Cloudflare Access.

[Unreleased]: ../../compare/v0.12.0...HEAD
[0.12.0]: ../../compare/v0.11.1...v0.12.0
[0.11.1]: ../../compare/v0.11.0...v0.11.1
[0.11.0]: ../../compare/v0.10.0...v0.11.0
[0.10.0]: ../../compare/v0.9.0...v0.10.0
[0.9.0]: ../../compare/v0.8.0...v0.9.0
[0.8.0]: ../../compare/v0.7.1...v0.8.0
[0.7.1]: ../../compare/v0.7.0...v0.7.1
[0.7.0]: ../../compare/v0.6.0...v0.7.0
[0.6.0]: ../../compare/v0.5.0...v0.6.0
[0.5.0]: ../../compare/v0.4.0...v0.5.0
[0.4.0]: ../../compare/v0.3.0...v0.4.0
[0.3.0]: ../../compare/v0.2.0...v0.3.0
[0.2.0]: ../../compare/v0.1.0...v0.2.0
[0.1.0]: ../../releases/tag/v0.1.0
