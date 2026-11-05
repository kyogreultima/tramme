# Sound parity roadmap

Status: step 1 built; 5 boxes done, 24 open. Track effects are next.

What Raylight's Sound page ([raylight.app/sound](https://www.raylight.app/sound)) offers and Tramme does not yet, and the steps that close the gap. Read with [sound-roadmap.md](sound-roadmap.md), which this continues: its steps 1 to 9 are done, and nothing here replaces them.

Source of the comparison: the product's marketing page only. It names no model, no limit and no price, so what follows matches the features it describes, not how they are built.

## Where we stand

Already in Tramme (checked in the code, not assumed):

| Raylight says | Tramme today |
|---|---|
| AI sound effects from a description | `generate-sound` (ElevenLabs) and `sfx`, `synth`, `sound-find` |
| AI music | `generate-sound`, `music_v2_5`, aligned on the `beats` analysis |
| AI voice-over, five voices | `generate-sound`, `voices`: the account's and the shared library's voices |
| Multitrack timeline, cut, move, adjust | tracks, clips, `Mixer.tsx` |
| Faders, pan, bus, master | strips with fader (automatable by playing), pan, mute, solo, buses, master with a loudness target (`apps/editor/src/ui/Mixer.tsx`, `timeline/mixer.ts`) |
| EQ, compressor, reverb, filter | three-band EQ, compressor, reverb, low and high cut, per clip |
| Distortion, delay | only inside the voice looks (telephone, radio, megaphone, echo), not as free effects |
| Volume automation, ducking | keyframed `gain`, `duck` tool from a transcript |
| Export with the mix | one mixer for the preview, the browser exports and the command line |

Tramme goes further on measurement (BS.1770 loudness, true peak, `check`, `mix`) and on sync to the picture (`soundCues`). None of that is in this plan.

## The gaps

1. **No live meters.** The master measures the mix offline after a change; no track shows its level while the film plays. This is what Raylight's "live meters" is, and the first thing a user looks for in a mixer.
2. **Effects are fixed settings, not a chain.** Each clip has one EQ, one compressor, one reverb in a fixed order. Raylight stacks any effect on any track, in any order, and the source stays untouched.
3. **Effects are per clip, not per track.** An effect on a voice track has to be set on each clip.
4. **No free delay or distortion.** They exist only as part of a voice look.
5. **Music is generated from a prompt, then aligned.** Raylight's music is written for the cut's length and tempo. Ours is asked for a duration and then matched to beats it was not written for.
6. **Volume blocks.** Raylight draws volume as blocks; we have keyframes, which are exact but slow to draw by hand for a ducking dip.
7. **Voices need a choice before a first take.** A handful of named voices, one line each, gets a user to a first voice-over faster than a searchable library.

Not in the gaps: the AI tools themselves. Where Raylight and Tramme differ there, ours is the wider one.

## Principles

Same as [sound-roadmap.md](sound-roadmap.md#principles), restated for what is new:

- **One mixer.** A new effect is written once in `packages/render/src/audio.ts` and sounds the same in the preview, the exports and the command line.
- **A sound is a file; an effect is a setting.** The source file is never changed. A chain is data in the document, so the assistant can read it, set it and check it.
- **Tokens only, no decoration.** Meters and strips use the theme tokens only; no gradient, no glow.
- **The assistant gets everything the user gets.** Each new control is also an operation or a tool the assistant can call.

## Steps

### Step 1. Live meters

The smallest step, and the most visible.

- [x] A level per strip while playing: peak and RMS from an `AnalyserNode` on each track's output in the preview, read on `requestAnimationFrame`, with a peak hold.
  - Stereo channels are measured separately, including opposite phases; buses sum their tracks. The `meters` tool reads the same levels and resets the same clipping latch.
- [x] A master meter: peak, short-term loudness (3 s), true peak, with the composition's target drawn on it. The offline measure stays for a stopped film.
  - The master is tapped after the loudness gain and limiter, before the personal preview volume. Its bounded three-second window uses the same BS.1770 and 4× true-peak measurement as `check`; repeated animation frames add no duplicate samples, and a gap beyond the analyser's history starts a fresh window. The `meters` tool returns these readings under `$master`. A steady stereo 1 kHz sine agrees with the offline check within 0.5 LU in Chrome. To check on a device: master levels during playback in WebView2 and WKWebView.
  - The live limiter's automatic makeup gain is compensated. A real preview with a -23 LUFS target measures -23.0 LUFS and -23.0 dBTP even with the personal listening volume at zero.
- [x] A clip indicator that stays lit until clicked, and a number in dB under each meter.
  - Every strip, including the master, keeps its clipping latch across stopping playback and closing the mixer. Starting another project clears it.
- [x] No cost when the mixer is closed: the analysers exist only while the panel is shown.
- [x] Test: a known sine through a track reads the expected level within 0.5 dB; a silent track reads the floor.
  - Chrome reads a mono and opposite-phase stereo 1 kHz sine at -6.02 dBFS peak and -9.04 dBFS RMS; silence reads -80 dBFS. Lifecycle, clipping across stop/close, and assistant access have regression tests. To check on a device: live playback and panel lifecycle in WebView2 and WKWebView.

Done when: playing a film moves every strip's meter, and the master agrees with `check` within 0.5 LU.

### Step 2. Effects on the track

- [ ] An `effects` list on a sound track (`packages/core`): each entry a `kind`, its parameters and a `bypass`. The schema (`schema/tramme-1.schema.json`) and `docs/document.md` follow.
- [ ] The existing per-clip fields (`eqLow`, `eqMid`, `eqHigh`, `compress`, `reverb`, `lowCut`, `highCut`) keep working; a track's chain runs after the clips are summed, so a voice track is treated once.
- [ ] The mixer builds the chain in order, one node per effect, in the preview and every export (`playClip`, `mixComposition`).
- [ ] Operations to add, remove, reorder, bypass and set an effect (`timeline/mixer.ts`), each undoable as one entry.
- [ ] A chain on a bus applies to every track it collects.

Done when: a compressor then an EQ on a voice track sounds the same in the preview, the MP4 and the command line, and reordering them changes the sound.

### Step 3. Delay and distortion

- [ ] `delay`: time (milliseconds, or a note value that follows the composition's tempo), feedback, wet, with the feedback capped so it cannot run away.
- [ ] `distortion`: drive, tone, wet, on the `WaveShaperNode` the voice looks already use; the voice looks become presets of the same effects instead of their own code.
- [ ] Both bypassable, both in the chain of step 2.

Done when: the voice looks (telephone, radio, megaphone, echo) are written as chains and sound the same as before; a regression test compares their rendered output.

### Step 4. The chain in the interface

- [ ] A strip shows its chain as a row of small slots; a click opens an effect's controls, a drag reorders, a toggle bypasses.
- [ ] A start from presets: voice cleanup (low cut, compressor, de-ess EQ), music under voice, telephone, big room.
- [ ] The `/` menu and the assistant reach the same operations (`use_tool`), and the assistant's proposal shows the chain it would add before applying it.
- [ ] Keyboard use and focus order checked; every control has a label in both languages.

Done when: a user builds "clean voice" in four clicks, and the assistant does the same from one sentence and shows what it did.

### Step 5. Music written for the cut

The one step that changes how a sound is made.

- [ ] Read the cut before asking for music: the composition's length, its cuts (`momentsOf`: `cuts`, `markers`), its hero cues (`soundCues`) and a tempo chosen so most cuts land on a beat.
- [ ] Ask the provider for the structure, not only a mood: sections whose lengths follow the picture (a calm opening, a rise before the reveal, the hit on the end card), with the tempo and the duration in the request.
- [ ] After generation, measure how many cuts land within a frame of a beat (`beats` analysis); when too few, retime by whole bars, or stretch within a small limit, before the user hears it.
- [ ] Keep the prompt, the tempo and the section plan beside the file, as the other generated sounds do.
- [ ] Fall back to the current path (a bed, then alignment) when the provider cannot take a structure.

Done when: on a film with six cuts, at least five land on a beat without the user moving anything, and the check reports it.

### Step 6. Drawn ducking and volume blocks

- [ ] Drag a range on a track to draw a dip: the editor writes the keyframes (down ramp, hold, up ramp) from a depth and a slope, and the range stays editable as one object.
- [ ] A voice track can be marked as the one to duck under: the music's dip follows its clips without a transcript.
- [ ] The existing `duck` tool and these blocks write the same keyframes, so both can be edited by hand afterwards.

Done when: a ducking drawn in two drags is identical, keyframe for keyframe, to what `duck` writes for the same range.

### Step 7. A fast first voice-over

- [ ] A short list of voices in the voice-over panel, chosen to differ (a warm one, a deep narrator, a lively one, a soft one, a clear one), each with a play button on a fixed sentence in the film's language.
- [ ] The full searchable library stays one click away, with the filters it already has.
- [ ] The first take goes on a new voice track at the playhead, with the music ducked and the voice chain of step 4 applied when the user accepts it.
- [ ] Which voices are offered is data (a small list in the Sound settings), not code, so it follows what the providers offer.

Done when: a user with no voice chosen goes from an empty film to a voice-over on the timeline in under a minute.

## Order and size

Steps 1 and 3 are small and independent. Step 2 comes before 3 and 4, which build on its chain. Step 5 depends on nothing else and is the largest risk: it relies on what the provider accepts. Steps 6 and 7 are small and can come at any time.

Suggested order: 1, 2, 3, 4, 7, 6, 5.

## Out of scope

- Real-time recording and live monitoring through the effects chain.
- Plugin hosting (VST, AU), or any effect that cannot be written on Web Audio nodes and rendered offline.
- Recording or editing the waveform sample by sample.
- Matching Raylight's pricing or voice names.

## What is not known

- Which models and limits Raylight uses, and how its music is "written for the cut". Step 5 is our reading of that sentence, to be tried against the providers, not a copy of a known method.
- Whether a provider accepts a section plan. This costs money to test on each try (as step 8 of the sound roadmap notes), so the first try should use the shortest film.
