# Proofs roadmap

Each major feature shown working on real footage that does not already show the result, before and after, on the site's features page (the Before and after section, `apps/site/src/components/Proofs.astro`, fed by `apps/site/src/lib/proofs.ts`). A proof is what a visitor can check with their own eyes; a sentence on a page is a claim.

Status: colour grading done (an ungraded Apple Log clip from Pexels, 2026-11-13). Step 0 not started; the 16 proofs below wait for it, but the next one or two can be added to the current section before it.

## Why

The first grading test was run on a clip that was already clean: the difference did not show, and the user did not believe it. The same test on flat log footage showed it at once, and it also found a real defect (out-of-gamut colours turning cyan) that a clean clip would never have shown. So a proof does two jobs: it convinces, and it tests the feature on the material it exists for.

## Principles

- **A source that has the problem.** Flat log for grading, a shaking hand for stabilisation, a noisy room for voice cleanup, a horizontal shot for a vertical reframe. Never footage that already looks done.
- **Untouched, and free to show.** Downloaded as published, its licence read on the day and recorded with the author and the page. Accepted when the licence allows modification and website use: Pexels, Pixabay, Unsplash (photos), CC0, CC BY and CC BY-SA (the derived clip is then published under CC BY-SA, said under it), public domain (NASA, the Prelinger Archives on the Internet Archive, LibriVox for voices), the Blender open films (CC BY). Each licence is re-read before use: they change.
- **Everything in Tramme.** No step outside the app: no hand retouch, no other grader, no re-encode with filters. The settings used are saved with the proof and shown under it, so anyone can redo it.
- **The same frame, the same time.** Before and after compared at the same instant, at the same size, encoded the same way.
- **Representative, not picked.** The proof uses the default or a stated setting; the clip is chosen for its problem, not for where the tool happens to shine. A feature that fails its proof is fixed first, as the grading was.
- **A measure where there is one.** Stabilisation: the residual motion in pixels per frame. Voice cleanup: the noise floor in dB. Silences: the seconds taken out. Upscaling: a crop at 200 %. Written beside the proof.
- **People shown with respect.** Pexels and Pixabay forbid showing identifiable people in a bad light: a retouch proof shows a subtle change on a neutral portrait and says it is retouched. No proof alters what a real person says (no lip sync, no dubbing of identifiable people).
- **Light.** Per proof: stills at most 800 KB each, a clip at most 4 MB (WebM VP9 first, MP4 fallback, a WebP poster), no sound unless the proof is about sound. Nothing of a proof loads before the visitor picks it.

## How the section scales

Today each proof is laid out in full, one under the other: a slider beside its text, then the clip across the page, about one and a half screens each. That holds two or three proofs; at fifteen it is a twenty-screen scroll.

The section becomes one stage of fixed height, whatever the number of proofs:

- a row of the features' names above it (scrolling sideways on a phone), the chosen one shown, the others loaded only when picked;
- in the stage, one frame with a switch: **Picture** (the slider) or **Video** (the clip), instead of a second block below;
- beside it (under it on a phone), the text, where the tool is, the settings, the measure and the credit;
- a link per proof (`/features/#proof-<id>`), so a page or a post can point at one;
- three kinds of comparison: a picture (the slider), a video (the clip with its line sweeping, or two clips side by side in sync, for a reframe or a slow motion), a sound (one player, a Before / After switch at the same position, its waveform drawn).

The landing page gets a strip of three proofs, each a poster that opens its proof on the features page.

## Step 0. The pipeline and the stage

- [ ] A proof's manifest, `proofs/<id>.json`: the source's page, its file's address, its licence and its page, its author, its SHA-256, the part used (in and out), the Tramme document used for the after (with its settings), the measure, and the texts.
- [ ] `node scripts/proofs.ts <id>`: downloads the source into `out/proofs/<id>/` (never committed; the hash checked), renders before and after with the command line (`tramme still`, `tramme render`), measures, and writes the stills to `apps/site/src/assets/proofs/` and the clip to `apps/site/src/videos/` at the site's sizes. Run again, it gives the same files.
- [ ] `lib/proofs.ts` reads the manifests instead of holding the texts (the texts in both languages stay in the manifest).
- [ ] The stage described above, with the picture, video and sound kinds; checked on a phone and a computer, light and dark, keyboard alone.
- [ ] The grading proof moved to the manifest and the stage, its files unchanged.
- [ ] The strip of three proofs on the landing page, nothing loaded before it comes near (the landing's performance rule).

## Step 1. Pictures

| Proof | Tool, where in the app | Source with the problem | Where to look | Shown as | Measure |
|---|---|---|---|---|---|
| Keying | Chroma key (`fx.key`: Effects, +, Effects), its matte view | A green-screen plate with hair and motion | The Blender film *Tears of Steel*, its green-screen plates (CC BY); Pexels "green screen" | Picture: the plate, then keyed over a background; the matte | — |
| Cut-out without a green screen | the `cutout` tool, text behind the person | A person walking in front of a busy background | Pexels, Pixabay | Video | — |
| Background removed from photos | `remove-bg` | Product photos on a cluttered table | Unsplash, Pexels | Picture over a checkerboard | — |
| A photo in 2.5D | the `depth` tool, `fx.parallax` | A landscape or a street photo with clear depth | Unsplash, Pexels | Video: the still photo, then the camera moving in it | — |
| Matching two shots | Match the look of the first clip (clip menu) | Two shots of one scene from two cameras, different white balance | Pexels (same author, same place), the *Tears of Steel* plates | Picture: the two shots side by side, before and after | The mean colour difference (ΔE) between them |
| Skin retouch | the `skin` tool, `fx.smooth` | A neutral close-up portrait, natural skin | Pexels, Pixabay (a portrait, shown with respect) | Picture, a crop at 100 %, labelled retouched | — |

- [x] Keying (a Pexels green-screen take; it led to the colour-difference matte)
- [ ] Cut-out without a green screen
- [ ] Background removed from photos
- [ ] A photo in 2.5D
- [ ] Matching two shots
- [ ] Skin retouch

## Step 2. Motion

| Proof | Tool, where in the app | Source with the problem | Where to look | Shown as | Measure |
|---|---|---|---|---|---|
| Stabilisation | the `stabilize` tool (the video's Stabilisation) | A handheld walk, clearly shaking | Pexels, Pixabay ("handheld", "walking POV") | Video, side by side in sync | Residual motion, px per frame, before and after |
| Tracking | `track`, then `callout` | A car, a bike or a runner crossing the frame | Pexels street footage | Video: a label that follows | Drift of the label, px |
| Vertical reframe | the `shorts` reframe, focus following the subject | A horizontal shot whose subject moves sideways | Pexels, Pixabay | Video: the 16:9 source beside its 9:16 | — |
| Slow motion | the long jobs' frame interpolation | A fast action at 25 or 30 fps (a jump, water) | Pexels, Pixabay | Video, side by side: frames repeated against frames made | — |
| Upscaling | the long jobs' upscaling (the engine in use is named) | Low-resolution archive film | The Prelinger Archives (public domain) | Picture, a crop at 200 % | — |

- [ ] Stabilisation
- [ ] Tracking
- [ ] Vertical reframe
- [ ] Slow motion (said honestly: block-matching motion until RIFE runs)
- [ ] Upscaling (said honestly: Lanczos until Real-ESRGAN runs)

## Step 3. Speech and sound

| Proof | Tool, where in the app | Source with the problem | Where to look | Shown as | Measure |
|---|---|---|---|---|---|
| Captions, word by word | Transcribe, then captions | A person speaking, clear sound | NASA (public domain), Wikimedia Commons (CC BY, CC BY-SA) | Video with sound, captions in time | Words timed within 100 ms, on a sample |
| Silences and hesitations cut | `silences`, `fillers` | A talk with pauses, "um"s and restarts | NASA briefings, Commons interviews | Video with sound, the raw take beside the cut one | Seconds removed, cuts made |
| A clean voice | `denoise` | A voice recorded in a noisy place (street, wind, hum) | Freesound (CC0, CC BY), Commons, LibriVox (some readings are noisy) | Sound: the Before / After player | Noise floor, dB |

- [ ] Captions, word by word
- [ ] Silences and hesitations cut
- [ ] A clean voice

## Step 4. Whole edits

These run the assistant, so they cost the user's quota: each waits for the user's go, and its cost is written with it.

| Proof | What runs | Source | Shown as |
|---|---|---|---|
| A talking video, edited | The assistant on a raw take: cuts, captions, inserts that show what is said, a grade | A public-domain or CC talk (NASA, Commons), 1 to 2 minutes | Video: the raw take beside the finished film, the same 30 s |
| Shorts from a long video | `shorts` on a talk | A CC talk of 10 minutes or more | Three vertical shorts beside the long video's timeline |

- [ ] A talking video, edited (the user's go)
- [ ] Shorts from a long video (the user's go)

## Not proven here

- **Lip sync and dubbing**: they change what a real person says; no proof on someone who has not agreed to it.
- **Voice and music apart**: blocked (`docs/editing-roadmap.md`, no usable Demucs export).
- **HDR export**: waits for a canvas above 8 bits.
- **Features without a before and after** (transitions, packs, the studio's notes): shown by the examples and the showreel, not here.

## Decisions

1. Sources are never committed: the manifest holds their address and hash, `out/proofs/` holds the files.
2. A proof that would need a step outside Tramme is not published; the missing step becomes work on the feature.
3. The texts say what was done and what was not, in plain words, and name the engine when a better one is planned (interpolation, upscaling).
