# Audit of the editing functions (task A1 of the NLE plan)

Read on 2026-10-28 from the code of `develop` (d2ce0d2). `present` means the function exists and needs no task; `partial` means a task finishes it; `absent` means a task builds it.

| Function | State | Evidence | Task |
|---|---|---|---|
| Duplicate layers (Ctrl+D) | present | `duplicateSelection` in `apps/editor/src/ui/LeftPanel.tsx` | reused by B6 |
| Copy and paste of layers, paste of attributes | absent | no clipboard code in `shell.tsx` or `LeftPanel.tsx` | B6, D3 |
| Offline media and relinking | absent | nothing in `media.ts`, `sources.ts`, `files.ts` | E2 |
| Mixer as an interface | absent | the `mix` assistant tool in `mixing.ts` and the offline mixer in `@tramme/render`; no strips | G1 |
| Voice-over recorded in the timeline | absent | `dictation.ts` is speech to text; no `MediaRecorder` anywhere in `apps/editor/src` | G2 |
| Colour wheels (lift, gamma, gain) | present | `fx.wheels` in `packages/nodes/src/effects.ts` | F2 builds only the shot match |
| Range export on the web | absent | `exportInBrowser` renders `duration * fps` frames; the CLI has `--from`/`--to` | H2 |
| Export queue | absent | one export at a time (`ExportPop` in `TopBar.tsx`); `longjob.ts` is for video jobs | H2 |
| Thumbnails | partial | `filmThumb` (`filmstrip.ts`) draws one 64x36 picture per (asset, time); no per-zoom buckets | D6 |
| Waveforms | present | `peaksOf`, `wavePath` in `waveforms.ts` | D6 reuses |
| Adjustment layer | present | `adjust` node, composited in the canvas backend | F1 makes it track-aware |
| Markers | present | `Marker.kind` is a free string | D6 adds `chapter` |
| Chapters in exports | absent | no code mentions chapters | D6 |
