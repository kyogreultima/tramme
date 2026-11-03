# Motion production, grounded in measurable direction

The user approved the research recommendations on 2026-11-03 and asked for continuous implementation. Improve the existing TypeScript engine and assistant; keep the Tramme document as the source of truth. Work in the clean existing `develop` checkout so changes remain directly reviewable in the shared workspace.

## Outcomes

1. A film plan can specify timed motion beats for each scene (subject, action, start/end, easing, settling and optional sound cue). Old plans remain valid. Scene builders and the critic receive the complete motion brief for their scene. Invalid times are reported before a plan is saved.
2. Review samples the whole film as well as cuts, entrances and directed beats, within the existing image budget. Long films retain coverage of the beginning, middle and end. Time labels describe the actual frames. The critic respects the brief, including flat graphics, static holds, rich palettes, intentional hard cuts, silent films and loops. Aesthetic heuristics are advice; missing media, placeholders and measured readability failures still prevent completion.
3. The local CLI checks rendered video after encoding (decoded frame count, dimensions, frame rate and duration against the requested span), offers a standalone JSON-capable export check, and reports unsupported formats explicitly. Use the existing bundled FFmpeg without adding Python or a second project format.
4. Provide deterministic, editable motion loops as a native plugin, with palette and period controls, plus a reproducible six-second product-film fixture. Verify determinism out of order and loop continuity; render and inspect the fixture and exported file.

## Integration choices

- Extend existing film-plan, review, plugin and CLI surfaces; no new UI workflow is required.
- Keep the critic image budget bounded; include both overview and event detail and disclose what samples cannot establish, especially audio and unsampled frames.
- Reuse methods from Florence's Motion Lab, ffmpeg-skill and Scenario Motion Loops. Implement focused native code; preserve attribution where code is copied. Do not install their entire ecosystems.
- Scenario's paid generation integration remains a later provider task, as recommended in the research. This change prepares locally stored assets and reusable loops, without requiring credentials or remote generation for validation.
- Measure technical behavior locally. Do not claim an artistic before/after win from a hand-authored fixture or passing tests; that needs actual assistant runs and human judgment.

## Validation

Use regression tests for motion-plan round trips and invalid timing, bounded review sampling with full timeline coverage, style-independent completion, and real encoded media validation including wrong expectations. Run type checks, editor build and the full test suite. Render the six-second fixture to stills and MP4 and inspect both. Record any baseline failures and remaining subjective evaluation separately.
