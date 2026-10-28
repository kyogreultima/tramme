# Video editor (NLE) editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble, cut and publish footage in minutes on a direct, track-based timeline, with every editing function of a real video editor, while the document stays the same JSON.

**Architecture:** The format gains optional fields only: a composition of `kind: "sequence"` holds `tracks`, a layer may sit on a `track` and belong to a `link` group. Every edit (ripple, insert, overwrite, roll, slip, slide, detach audio…) is a pure function in a new `packages/core/src/montage.ts` that returns `Op[]`, like `shiftLayerOps` and `splitLayerOps` today; the timeline's gestures, the keyboard and the assistant's tools all call them. A sequence is an ordinary composition for the engine (nestable, animatable, exportable); the timeline shows tracks when a composition has them and keeps today's layer view otherwise.

**Tech Stack:** TypeScript, Preact + signals, Vitest, the existing render engine, `@tramme/core` ops, `longjob.ts` for long jobs.

**Spec:** none written apart from this conversation (2026-10-28). Its content is the *Scope* below; the audit of task A1 settles which "to verify" lines are already done.

## Scope (every line is implemented; nothing is dropped)

1. Timeline by tracks: several video and audio tracks, lock, hide, mute, solo, rename, height; magnetic main track; ripple delete, ripple trim, roll, slip, slide; insert and overwrite; detach audio; linked clips; copy and paste with attributes; paste of effects; several sequences open in tabs; zoom with shot thumbnails and waveforms; markers and chapters.
2. Media: bins, tags and search; offline media and relinking; sub-clips and a source monitor with in/out; audio sync of clips; multicam.
3. Picture: adjustment layers over a range of tracks (the `adjust` node exists: make it track-aware), colour wheels and shot matching, plus the keying, masks, tracking, stabilisation and speed already done.
4. Sound: mixer per track (volume, pan, automation, buses), voice-over recording in the timeline, loudness target.
5. Output: publishing presets by network and a guided "publish", range export, background render queue, HDR.
6. Left over from `docs/editing-roadmap.md`: voice and music split (Demucs), DeepFilterNet, Real-ESRGAN, RIFE, the cut-by-number button for hesitations.
7. The assistant drives all of it through the same operations.

## Global Constraints

- Format stays `tramme/1`. New fields are optional; a document without them validates and renders the same frames (test: the three `examples/` validate and their stills are unchanged, `tramme compare` PSNR = ∞).
- Edits are `Op[]` sent through `commit()` / `draft()` (`apps/editor/src/state.ts`), one commit per gesture so one undo undoes it. No code writes `S.doc` directly.
- Time is rounded the way `shiftLayerOps` does (`Math.round(x * 1e6) / 1e6`) and snapped to frames by `snap(t, fps)` from `apps/editor/src/model.ts`.
- One implementation: `shiftLayerOps`, `splitLayerOps`, `trimInOps`, `carriedStart`, `crossfadeOps`, `transitionPlan` stay the only code for those jobs; new operations call them. Move them to `packages/core/src/montage.ts` only if core needs them (task B1), re-exporting from `model.ts` so nothing else changes.
- A transition (`fx.transition`, `apps/editor/src/transitions.ts`) overlaps the incoming clip with the outgoing one by its length, centred on the cut. On a track, that overlap is the cut and never counts as a collision.
- UI: theme tokens only (`apps/editor/src/theme/tokens.css`), no eyebrow labels, step numbers, connector dashes, gradients or glow. Every string goes through `t()` / `m()` with its French entry in `apps/editor/src/i18n/fr.json`; `node apps/editor/test/i18n-keys.ts` must pass.
- Models are never bundled: downloaded on first run, kept in the cache, sizes shown before download (editing-roadmap principle). Jobs over a few seconds go through `apps/editor/src/longjob.ts`.
- Rendering stays a pure function of `t`; a model's output is saved as an asset the render reads.
- Browser checks run on port 8790 with a repo-local state, never the user's dev on 8787.
- Commits: conventional style as in `git log`, no attribution trailer (the user's rule overrides the harness default).
- Commands: `npx vitest run <file>` for one test file, `npm test` and `npm run typecheck` before each commit, `npm run schema` after a type change.

## Review Focus

Each line has its test in the task named in brackets.

1. A ripple over a clip carrying a transition, or inside a group: neighbours stay joined, no accidental overlap, the group's children move together. [B3, B4]
2. A clip with keyframes: they move with the clip (keyframes are in composition time). [B3]
3. A video whose `start` is animated or an expression (`carriedStart` returns null): trimming and slipping still work on the edges and say the source is not carried; nothing throws. [B5]
4. A locked track, or a link group with one locked member: the operation changes nothing and says why; it never moves half a group. [B2, B6]
5. A project saved by this version opened by the previous one, and a project with no tracks opened here: unknown fields are ignored, validation passes. [C1, C2]
6. One undo restores the whole gesture, including `order` and every moved keyframe. [D3]

## File Structure

- `packages/core/src/montage.ts` (new): tracks, footprints, every edit operation. One responsibility: turn an editing intent into `Op[]`.
- `packages/core/src/types.ts`, `validate.ts`, `schema/tramme-1.schema.json`: the optional fields and their rules.
- `apps/editor/src/ui/timeline/` (new folder): `Tracks.tsx` (lanes and headers), `clipDrag.ts` (gestures calling core), `shortcuts.ts`, `Tabs.tsx`. `Timeline.tsx` keeps the transport, the ruler and the layer view, and delegates when the composition has tracks.
- `apps/editor/src/bins.ts`, `subclips.ts`, `relink.ts`, `sync.ts`, `multicam.ts`, `voiceover.ts`, `publish.ts`: one file per feature; UI in `apps/editor/src/ui/`.
- Tests: `packages/core/test/montage.test.ts`; `apps/editor/test/<feature>.test.ts`.

## Task template

Every task follows five steps; a task lists only what differs.

- [ ] **1.** Write the failing tests named in the task, with the assertions given.
- [ ] **2.** Run them: expect FAIL ("not a function" / assertion).
- [ ] **3.** Implement the signatures named in the task.
- [ ] **4.** Run the task's tests, then `npm test` and `npm run typecheck`: expect PASS.
- [ ] **5.** Commit with the message given.

---

## Phase A. Audit

### Task A1: Settle the "to verify" lines

**Files:** Create `docs/montage-audit.md`.

**Produces:** a table, one row per line below, with `present | partial | absent` and the file that proves it. Later tasks marked *(skip if present)* use it.

Lines to check, each by reading the code and running the editor on port 8790: copy/paste of layers with attributes and of effects; offline media and relinking; the mixer as an interface (not only the `mix` assistant tool in `mixing.ts`); voice-over recording (`dictation.ts` is speech to text, not a recording into the timeline); colour wheels; range export; render queue; thumbnails and waveforms at every zoom; `adjust` layer behaviour in a track (it exists in `packages/nodes/src/adjust.ts`); markers as chapters.

- [ ] Fill the table. Commit `docs: audit of the editing functions already present`.

---

## Phase B. Editing operations in core

### Task B1: Types, footprints and track lookups

**Files:** Modify `packages/core/src/types.ts`, `packages/core/src/index.ts`. Create `packages/core/src/montage.ts`, `packages/core/test/montage.test.ts`.

**Interfaces — Produces:**
```ts
export interface Track { id: string; name?: string; kind: 'video' | 'audio'; locked?: boolean; hidden?: boolean; muted?: boolean; solo?: boolean; magnetic?: boolean; height?: number }
// Composition: kind?: 'sequence'; tracks?: Track[]  (bottom to top)
// Layer: track?: string; link?: string
export interface Footprint { id: string; in: number; out: number }
export function trackClips(c: Composition, trackId: string): Footprint[]     // sorted by in, out defaults to c.duration
export function cutsOf(c: Composition, trackId: string): { left: string; right: string; at: number }[]  // adjacent clips; overlap of a transition counts as the cut at its centre
export function isLocked(c: Composition, id: string): boolean               // its track locked, or any member of its link group on a locked track
export function linkedIds(c: Composition, id: string): string[]             // the link group including id
```

Tests: `trackClips returns clips sorted with out defaulting to duration`; `cutsOf finds the centre of a transition overlap` (clips 0–5 and 4–9, the second carrying an `fx.transition` of length 1 → one cut at 4.5, the centre of the overlap); `isLocked is true for a clip whose linked audio sits on a locked track`; `linkedIds of an unlinked clip is [id]`.

Commit `feat(core): tracks and footprints for a sequence`.

### Task B2: Ripple delete and gap closing

**Interfaces — Produces:**
```ts
export function closeGapOps(doc: TrammeDoc, compId: string, trackId: string, at: number): Op[]
export function rippleDeleteOps(doc: TrammeDoc, compId: string, ids: string[]): Op[]
```
`rippleDeleteOps` removes the clips (and their link group) and shifts every later clip of the same tracks left by the removed length through `shiftLayerOps`; later clips on tracks that are not rippled are untouched. Returns `[]` when `isLocked` says so.

Tests: `rippleDelete removes the clip and shifts the next two left by its length`; `rippleDelete moves keyframes of the shifted clip` (Review Focus 2); `rippleDelete of a linked pair removes both and shifts both tracks`; `rippleDelete on a locked track returns []` (Review Focus 4); `closeGap shifts the clips after a gap so the first starts at the gap start`; `rippleDelete keeps a transition's overlap intact on the shifted neighbours` (Review Focus 1).

Commit `feat(core): ripple delete and gap closing`.

### Task B3: Insert and overwrite

**Interfaces — Produces:**
```ts
export function insertOps(doc: TrammeDoc, compId: string, id: string, layer: Layer, trackId: string, at: number): Op[]
export function overwriteOps(doc: TrammeDoc, compId: string, id: string, layer: Layer, trackId: string, at: number): Op[]
```
`insertOps`: if `at` falls inside a clip, split it with `splitLayerOps`, shift everything from `at` right by the new clip's length, add the clip with `track`, then `syncOrderOps`. `overwriteOps`: clip occupies `[at, at+len)`; clips fully under it are removed, partial ones trimmed (`trimInOps` for the head, `out` for the tail), a clip it falls inside is split.

Also here: `export function syncOrderOps(doc: TrammeDoc, compId: string): Op[]` sets `order` from track order then `in`, so the draw order matches the tracks (video tracks bottom to top; audio tracks do not draw).

Tests: `insert in the middle of a clip splits it and shifts the tail`; `insert at a cut shifts the later clips only`; `overwrite fully covering a clip removes it`; `overwrite over a clip's tail trims its out`; `overwrite over a clip's head trims its in and carries a video's start`; `overwrite inside one clip splits it in three`; `insert adds ops that sync order so the new clip is above lower tracks`.

Commit `feat(core): insert and overwrite on a track`.

### Task B4: Ripple trim, roll

**Interfaces — Produces:**
```ts
export function rippleTrimOps(doc: TrammeDoc, compId: string, id: string, edge: 'in' | 'out', to: number): Op[]
export function rollOps(doc: TrammeDoc, compId: string, left: string, right: string, to: number): Op[]
```
`rippleTrimOps` trims the edge (`trimInOps` for `in`) and shifts the following clips by the change in length. `rollOps` moves the shared edge of two adjacent clips, clamped to the handles of both files (`carriedStart`, file length through a `fileLength(asset)` argument defaulting to unknown, as `transitionPlan` does).

Tests: `ripple trim of the out edge by -1 s shifts the following clips left 1 s`; `ripple trim of the in edge keeps the clip's start position and carries the source`; `roll moves the cut and changes the two clips by equal and opposite amounts`; `roll is clamped when the right file has no head left` ; `ripple trim next to a transition keeps the overlap length`.

Commit `feat(core): ripple trim and roll`.

### Task B5: Slip and slide

**Interfaces — Produces:**
```ts
export function slipOps(doc: TrammeDoc, compId: string, id: string, d: number): Op[]
export function slideOps(doc: TrammeDoc, compId: string, id: string, d: number): Op[]
```
`slipOps`: the clip stays in place, its source start moves by `d` (`props.start`), clamped to file bounds; `[]` and a reason when `carriedStart` is null (Review Focus 3). `slideOps`: the clip moves by `d`, its two neighbours' facing edges follow so the track length does not change.

Tests: `slip by 1 s changes start by 1/rate and leaves in/out`; `slip returns [] for a clip whose start is an expression`; `slide moves a clip and trims left out and right in by d`; `slide beyond a neighbour's length is clamped`.

Commit `feat(core): slip and slide`.

### Task B6: Links, detached audio, paste

**Interfaces — Produces:**
```ts
export function linkOps(doc: TrammeDoc, compId: string, ids: string[]): Op[]      // one fresh link id on all
export function unlinkOps(doc: TrammeDoc, compId: string, ids: string[]): Op[]
export function detachAudioOps(doc: TrammeDoc, compId: string, id: string, audioTrack: string): { ops: Op[]; id: string } | null
export function pasteOps(doc: TrammeDoc, compId: string, clips: Layer[], trackId: string, at: number, mode: 'insert' | 'overwrite'): Op[]
export function pasteAttributesOps(doc: TrammeDoc, compId: string, from: string, to: string[], only: ('transform' | 'effects' | 'masks' | 'blend' | 'speed')[]): Op[]
```
`detachAudioOps` creates an `audio` layer on `audioTrack` pointing at the video's asset, same `in/out/start/rate`, linked to the video, and mutes the video's own sound (the prop the video node uses; read `packages/nodes/src/video.ts`). Null for a video without sound.

Tests: `moving a linked pair keeps their relative offset` (through `shiftLayerOps` on both); `detach creates a linked audio layer with the same start and rate and mutes the video`; `detach of a muted-source video returns null`; `pasteAttributes copies effects but not in/out`; `paste in overwrite mode matches overwriteOps`.

Commit `feat(core): links, detached audio and paste`.

---

## Phase C. Format and validation

### Task C1: Validation, schema, migration

**Files:** Modify `packages/core/src/validate.ts`, `packages/core/src/checks.ts`; regenerate `schema/tramme-1.schema.json` (`npm run schema`); modify `docs/document.md`.

Rules: a layer's `track` names a track of its composition (error); `tracks` ids unique (error); an audio layer on a video track or the reverse (warning); two clips overlapping on one track by more than a transition's length (warning); `link` ids with a single member (warning). Document the fields in `docs/document.md` ("Sequences and tracks").

Tests (in `packages/core/test/validate.test.ts`): `unknown track is an error`; `overlap of a transition is not a warning`; `the three examples still validate with no new finding`; `a document without tracks validates unchanged` (Review Focus 5).

Commit `feat(format): sequence compositions, tracks and links`.

### Task C2: Make a sequence from layers

**Files:** Modify `packages/core/src/montage.ts`, `packages/core/test/montage.test.ts`.

**Produces:** `export function toSequenceOps(doc: TrammeDoc, compId: string): Op[]` — turns a composition into a sequence: video/image clips become `V1`, audio clips `A1`, other layers stay free (no `track`). Idempotent. `fromSequence` is not needed: removing `kind` and `tracks` is a plain op.

Tests: `toSequence assigns media clips to V1 and A1 and leaves text free`; `applying it twice gives the same document`.

Commit `feat(core): turn a composition into a sequence`.

---

## Phase D. Timeline by tracks

### Task D1: Lanes and track headers

**Files:** Create `apps/editor/src/ui/timeline/Tracks.tsx`; modify `apps/editor/src/ui/Timeline.tsx` (delegate when `comp.value.tracks`), `apps/editor/src/screens/atelier.css`.

Lanes by track, bottom track at the bottom for video; headers with name (rename inline), lock, hide, mute, solo, height. Header actions send ops on `tracks` through `commit`. Studio keeps its storyboard; the atelier shows the lanes.

Tests (`apps/editor/test/tracks-ui.test.ts`, logic only, as the other editor tests): `trackHeaderOps lock sets tracks/<i>/locked`; `solo hides nothing in the document but is carried by a preview-only signal` (solo and hidden-by-solo are view state in the preview, the exported film uses `muted`/`hidden` from the document; state which in `docs/document.md`).

Verify in the browser (8790): add a track, lock it, drag a clip on it: refused. Commit `feat(editor): timeline by tracks`.

### Task D2: Magnetic main track

**Files:** Create `apps/editor/src/ui/timeline/clipDrag.ts`.

On a track with `magnetic: true`, dropping or trimming a clip closes gaps (`closeGapOps`) and a drag reorders clips (move = `rippleDeleteOps`-style close at the source, `insertOps` at the drop). Free tracks keep today's placement with snapping.

Tests: `reorderOps moves the third clip between the first and second and closes the gap`; `drag on a free track never shifts others`.

Commit `feat(editor): magnetic track`.

### Task D3: Gestures and keyboard

**Files:** Create `apps/editor/src/ui/timeline/shortcuts.ts`; modify `apps/editor/src/ui/shell.tsx` (the keydown handler at lines 27-55).

Keys (all remappable later; the table lives in one object): `Ctrl+B` split at playhead on selected clips (or all unlocked clips under the playhead when none), `Q` / `W` ripple-trim the in/out to the playhead, `Delete` ripple delete on a magnetic track and plain delete elsewhere, `Shift+Delete` always ripple, `,` insert and `.` overwrite the source selection at the playhead, `Ctrl+C`/`Ctrl+V` clips, `Ctrl+Alt+V` paste attributes, `L` link, `Ctrl+Shift+L` unlink, `Shift+click` on a trim edge = roll, `Alt+drag` on a clip body = slip, `Ctrl+Alt+drag` = slide. Each is one `commit`.

Tests: `keymap resolves Ctrl+B to splitAtPlayhead`; `splitAtPlayhead with no selection splits every unlocked clip under the playhead in one commit`; `undo after splitAtPlayhead restores order and every layer in one step` (Review Focus 6).

Commit `feat(editor): editing keys and gestures`.

### Task D4: Drop footage on the timeline

**Files:** Modify `apps/editor/src/dropper.ts`, `apps/editor/src/ui/LeftPanel.tsx` (asset drag), `apps/editor/src/ui/timeline/clipDrag.ts`.

Dragging an asset over a lane shows the drop point and mode (insert by default on a magnetic track, overwrite elsewhere, Alt flips); dropping calls `insertOps` / `overwriteOps` with a clip built by the existing asset-to-layer code (`apps/editor/test/asset-layer.test.ts` covers it; reuse, no second builder). A video with sound drops as a linked pair V + A.

Tests: `dropping a video with sound yields a linked V and A clip at the playhead`; `dropping on a magnetic track at a clip's middle splits it`.

Commit `feat(editor): drop media into tracks`.

### Task D5: Several sequences in tabs

**Files:** Create `apps/editor/src/ui/timeline/Tabs.tsx`; modify `apps/editor/src/state.ts` (open compositions list).

Tabs above the timeline for open compositions; "new sequence" from selected assets (`toSequenceOps` + `insertOps`); a sequence dragged into another one nests it (a `comp` layer).

Tests: `closing the active tab selects the neighbour`; `new sequence from three clips lays them end to end on V1`.

Commit `feat(editor): sequences in tabs`.

### Task D6: Zoom, thumbnails, waveforms, chapters

*(skip the parts the audit marks present)*

**Files:** Modify `apps/editor/src/filmstrip.ts`, `apps/editor/src/waveforms.ts`, `apps/editor/src/ui/timeline/Tracks.tsx`.

Clip thumbnails at every zoom level (cached per asset and zoom bucket, computed lazily, never on the render path), waveforms on audio and video clips, a fit-all key (`Shift+Z`), and markers of kind `chapter` listed and exported to the formats that carry them (mp4 chapters through the exporter in `packages/render`).

Tests: `thumbnailTimes returns evenly spaced source times for a clip width and zoom`; `chapter markers are written in the mp4 chapter list`.

Commit `feat(editor): thumbnails, waveforms and chapters on tracks`.

---

## Phase E. Media

### Task E1: Bins, tags, search

**Files:** Create `apps/editor/src/bins.ts`; modify `apps/editor/src/ui/LeftPanel.tsx`; modify `docs/document.md`.

Optional `assets.<id>.bin?: string` and `tags?: string[]` (same rule as `madeBy`: optional, ignored by the engine). Panel: bin tree, tag filter, search by name and tag; the transcript of a clip is searched when it has one (`core/transcript.ts`).

Tests: `filterAssets by bin, tag and text`; `searching a spoken word finds the clip whose transcript has it`.

Commit `feat(editor): bins, tags and search`.

### Task E2: Offline media and relinking

*(skip if present)* **Files:** Create `apps/editor/src/relink.ts`.

An asset whose file is missing is shown offline (clips draw a placeholder, never an exception); `relinkOps(doc, assetId, newSrc)` replaces `src` and keeps `hash`; a folder relink matches by name and size, then by `hash`.

Tests: `matchRelink picks the file with the same hash first`; `a clip on an offline asset renders the placeholder and the export refuses with a list of the missing files`.

Commit `feat(editor): offline media and relink`.

### Task E3: Sub-clips and the source monitor

**Files:** Create `apps/editor/src/subclips.ts`, `apps/editor/src/ui/Source.tsx`.

A source monitor plays an asset alone with `I` / `O` marks; "to the timeline" calls `insertOps` / `overwriteOps` with a layer whose `props.start` and length come from the marks; a sub-clip is saved as `assets.<id>` with optional `range: [in, out]` and named; dragging it is the same as dragging the range. No second copy of the file.

Tests: `clipFromRange builds a video layer with start = in and out - in length`; `a sub-clip dragged to the timeline carries the range`.

Commit `feat(editor): source monitor and sub-clips`.

### Task E4: Audio sync of clips

**Files:** Create `apps/editor/src/sync.ts`; core helper `packages/core/src/syncoffset.ts`.

**Produces:** `export function syncOffset(a: Float32Array, b: Float32Array, rate: number, maxSeconds: number): { offset: number; confidence: number }` by cross-correlation of the envelopes (FFT-based); the editor applies it as `shiftLayerOps` on the second clip.

Tests: `syncOffset finds a 0.8 s shift of the same signal with confidence > 0.9`; `syncOffset on unrelated noise reports confidence < 0.3 and the editor applies nothing`.

Commit `feat(editor): sync clips by audio`.

### Task E5: Multicam

**Files:** Create `apps/editor/src/multicam.ts`, `apps/editor/src/ui/Multicam.tsx`.

A multicam clip = a composition holding the angles synced (E4) on tracks; the "angle" switch is a track-level `hidden` flip recorded as cuts by `splitLayerOps` at the playhead while playing; the result is plain clips, so export needs nothing new.

Tests: `switchAngleOps at t splits the active angle at t and shows the other from t`; `three switches produce four contiguous segments with no gap`.

Commit `feat(editor): multicam`.

---

## Phase F. Picture

### Task F1: Adjustment layers over tracks

**Files:** Modify `packages/nodes/src/adjust.ts` (notes only), `apps/editor/src/ui/timeline/Tracks.tsx`; core `montage.ts`.

`adjust` exists and applies to everything under it in the stack. In a sequence, an adjustment clip placed on a video track affects the tracks below it, over its range only; confirm with a render test that `in/out` bound it. Add `addAdjustmentOps(doc, compId, trackId, at, len)` and a menu entry.

Tests: `addAdjustmentOps places an adjust layer on the track with the range`; render test in `packages/render/test`: a frame outside the range is bit-identical to the frame without the layer.

Commit `feat(editor): adjustment clips on tracks`.

### Task F2: Colour wheels and shot match

*(wheels skip if present)* **Files:** Modify `packages/nodes/src/effects.ts` (a `color.wheels` effect: lift/gamma/gain as vec3 plus saturation, in linear light), `apps/editor/src/scopes.ts`; Create `packages/core/src/colormatch.ts`.

**Produces:** `export function matchGrade(ref: Stats, src: Stats): { lift: number[]; gamma: number[]; gain: number[] }` from the mean and standard deviation per channel of two frames; a tool `match_look` applies it as the wheels' values (visible and editable, never baked).

Tests: `matchGrade of identical stats is the identity`; `matchGrade moves the source mean onto the reference mean within 0.01`; render test: wheels at defaults leave a frame bit-identical.

Commit `feat: colour wheels and shot matching`.

---

## Phase G. Sound

### Task G1: Mixer per track

*(skip what the audit marks present)* **Files:** Create `apps/editor/src/ui/Mixer.tsx`; modify `apps/editor/src/mixing.ts`; optional `Track.volume`, `Track.pan`, `Track.bus` in `types.ts`.

One strip per audio track: volume (dB), pan, mute, solo, bus choice; automation is a keyframed `volume` on the track, recorded while dragging the fader during playback (`draft` then one `commit`); buses are tracks of kind `audio` with `bus: true`. The loudness target of the composition (`sound.loudness`) shows as a meter. The mixer and the `mix` assistant tool share one function in `mixing.ts`.

Tests: `trackGain applies volume, pan, mute and solo across tracks the way the offline mixer does` (same numbers in preview and export); `recording a fader move writes keyframes on the track's volume in one commit`.

Commit `feat(editor): mixer by track`.

### Task G2: Voice-over recording

*(skip if present)* **Files:** Create `apps/editor/src/voiceover.ts`; modify `apps/editor/src/ui/Transport` area.

Record from the microphone at the playhead onto a chosen audio track while the film plays (with a count-in); the take is stored as an asset (`MediaRecorder`, kept as the format the platform gives, converted to wav by the existing audio path) and placed with `overwriteOps`; the previous content is kept as a take, not deleted.

Tests: `placeTake overwrites from the playhead and keeps the covered clip's asset available`; `a cancelled recording writes nothing`.

Commit `feat(editor): voice-over recording`.

---

## Phase H. Output

### Task H1: Publishing presets and the guided publish

**Files:** Create `apps/editor/src/publish.ts`; modify `apps/editor/src/ui/TopBar.tsx` (the `ExportPop`), `apps/editor/src/formats.ts`.

**Produces:**
```ts
export interface PublishPreset { id: string; label: string; width: number; height: number; fps: number; maxSeconds?: number; format: 'mp4' | 'webm'; videoKbps: number; audioKbps: number; loudness: number }
export const PUBLISH_PRESETS: PublishPreset[]
export function presetIssues(c: Composition, p: PublishPreset): string[]   // duration over limit, aspect mismatch, loudness off
```
Presets: vertical short, square, landscape web, 4K master, GIF. "Publish" shows the issues, offers the fixes (reframe 9:16 tool, loudness target), then renders and offers the file. No account posting; the file is the deliverable.

Tests: `presetIssues flags a 90 s film for a 60 s preset`; `presetIssues reports an aspect mismatch with the reframe tool as the fix`.

Commit `feat(editor): publishing presets`.

### Task H2: Range export and background queue

*(skip what the audit marks present)* **Files:** Modify `apps/editor/src/ui/TopBar.tsx`, `apps/editor/src/longjob.ts`, `apps/editor/src/ui/QueueList.tsx`.

Export the span between two marks (the CLI already has `--from`/`--to`); several exports queued and run in order with progress, cancel and resume; the editor stays usable.

Tests: `exportRange passes from/to to the web exporter in seconds snapped to frames`; `the queue runs exports one at a time and a cancelled one does not block the next`.

Commit `feat(editor): range export and export queue`.

---

## Phase I. The roadmap's leftovers

Each keeps the editing-roadmap rules: default model named with size and licence, downloaded on first use, output saved as an asset linked to its source, and a gate: if the model cannot be fetched and checked where the work runs, the task stops at the gate, records why in `docs/editing-roadmap.md` and the next task goes on.

### Task I1: Voice and music split (Demucs)

**Gate:** an ONNX export of a Demucs model (or an equivalent licensed for commercial use) that loads in `onnxruntime-web` and passes the check below. **Files:** Create `apps/editor/src/stems.ts`; modify `ModelsSettings.tsx`, `THIRD_PARTY_NOTICES.md`.

**Produces:** `export async function splitStems(audio: Float32Array[], rate: number, onProgress: (p: number) => void, signal: AbortSignal): Promise<{ voice: Float32Array[]; rest: Float32Array[] }>` run through `longjob.ts`.

Tests: `voice + rest reconstructs the input within -40 dB` on a fixed 10 s fixture; `a cancelled job leaves no asset`.

Commit `feat(editor): voice and music split`.

### Task I2: Better models where the machine allows

DeepFilterNet (denoise), Real-ESRGAN (upscale), RIFE (interpolation) as extra rows in the models settings, each with its adapter in `apps/editor/src/models.ts`, the core engines (RNNoise, Lanczos, block matching) staying the defaults and the fallback.

Tests per model: `adapter output shape for a fixture`; `with the model unavailable the default engine runs and says so`.

Commit `feat(editor): DeepFilterNet, Real-ESRGAN and RIFE as choices`.

### Task I3: Hesitation cuts by a button

**Files:** Modify `apps/editor/src/fillers.ts`, `apps/editor/src/ui/Transcribe.tsx`.

Each proposed cut gets a button applying `rippleDeleteOps` on that span (a span inside a sequence, per track). Test: `apply cut number 2 removes only that span and shifts the rest`.

Commit `feat(editor): apply a hesitation cut from the proposal`.

### Task I4: HDR

**Gate:** Canvas 2D above 8 bits in the target browsers (`apps/editor/src/avc.ts` capability check); otherwise the task ends with the check written and the gate recorded. **Files:** `packages/render`, `apps/editor/src/ui/TopBar.tsx`. Test: `hdrCapability reports false on a context limited to 8 bits and the export offers 10-bit SDR only`.

Commit `feat(render): HDR export where the canvas allows`.

---

## Phase J. The assistant and the documentation

### Task J1: Editing tools for the assistant

**Files:** Modify `packages/assistant/src` (tools), `packages/nodes/src/notes.ts` (`ai` notes).

Tools mapped one to one on the B-phase functions: `ripple_delete`, `insert_clip`, `overwrite_clip`, `ripple_trim`, `roll`, `slip`, `slide`, `detach_audio`, `link`, `sync_clips`, `add_adjustment`, `match_look`, `publish`. Each tool's `ai.when` says when to use it and when not. Tools take ids and times, never raw ops.

Tests (`apps/editor/test/assistant-tools.test.ts` style): `ripple_delete tool on two ids yields the same ops as rippleDeleteOps`; `a tool refused by a locked track returns the reason as its result`.

Commit `feat(assistant): the editing operations as tools`.

### Task J2: Tours, docs, changelog

**Files:** `apps/editor/src/tours/` (a tour of tracks and the editing keys, per `docs/tours.md`), `docs/document.md`, `README.md` (the Editor section), `CHANGELOG.md`, `apps/site` docs list.

Tests: `node apps/editor/test/i18n-keys.ts` passes; the tour's steps all resolve their `data-tour` targets (the existing tours test).

Commit `docs: tracks, editing keys and publishing`.

---

## Order and delivery

Each phase leaves the editor working and is merged on its own branch from `develop`: A, B and C first (no UI change, safe), then D (the visible change), then E to H in any order, I last because of its gates, J2 closing each phase and J1 growing with them. Phase D is the first the user feels; B + D1 to D4 are enough for "assemble, cut, publish in minutes" with H1.

## Self-review

- Coverage: every line of *Scope* has a task (1: B, D; 2: E; 3: F; 4: G; 5: H; 6: I; 7: J1). Nothing is dropped; I1 and I4 carry a gate because their dependency could not be checked in the earlier roadmap loop.
- Types used across tasks (`Track`, `Footprint`, `trackClips`, `cutsOf`, `isLocked`, `linkedIds`, `syncOrderOps`, `toSequenceOps`) are defined in B1, B3 and C2 before their users.
- Known approximations: the exact export hook for chapters (D6) and the muted-video prop (B6) are decided when the files are read in those tasks.
