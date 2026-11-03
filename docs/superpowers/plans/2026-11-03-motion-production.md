# Motion Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make direction, criticism and local delivery more precise while preserving native editable projects.

**Architecture:** Extend film-plan with optional timed beats, use a bounded overview-plus-detail review, separate measured defects from artistic recommendations, validate encoded local output with the bundled FFmpeg, and ship a native looping plugin and six-second fixture.

**Tech Stack:** TypeScript, native plugin JavaScript, Vitest, headless Chrome and bundled FFmpeg.

**Spec:** `docs/superpowers/specs/2026-11-03-motion-production-design.md`

## Global Constraints

- Existing plans and projects must remain valid.
- Keep the Tramme document as the source of truth.
- No new runtime dependency or provider credential is required.
- Work in the current clean develop checkout; leave changes reviewable and uncommitted.

## Review Focus

- A one-shot six-second loop must not be forced into several picture kinds or given a marketing ending.
- A long film must not spend its entire visual review budget on its earliest cuts.
- Directed motion must reach the scene builder without being clipped by the global plan summary.
- Decode failures and mismatched expectations must produce a failing delivery verdict, not a successful render message.
- Loop motion must be reproducible when frames are requested out of order and at the period boundary.

### Task 1: Timed direction and style-independent review

**Files:** `apps/editor/src/filmplan.ts`, scene-builder prompt integration, `apps/editor/src/critic/{evidence,done,tool}.ts`, `packages/assistant/src/{index,critic}.ts`, associated tests.

**Interfaces:** Optional scene motion beats; a dedicated per-scene motion text formatter and bounded timeline sample helper. Existing callers without motion remain valid.

- [x] Add failing regressions for saved/reloaded beats, invalid timing, one-shot plans, long timeline sampling and intentional style choices.
- [x] Implement plan schema and validation, propagate full scene direction, gather overview plus detail, make only technical defects mandatory, and request timestamped critic fixes.
- [x] Run targeted tests and type checking.

### Task 2: Encoded delivery checks

**Files:** new local CLI media verification module, render/CLI integration and CLI tests.

**Interfaces:** Structured verification result with expected and actual properties, JSON output and nonzero exit on failure; reuse bundled FFmpeg with a bounded timeout.

- [x] Add failing tests using tiny real encoded fixtures and mismatched expectations.
- [x] Implement checks and connect them to sequential and parallel render delivery and standalone CLI.
- [x] Verify valid media, truncated media and unsupported formats.

### Task 3: Native loops and end-to-end fixture

**Files:** native plugin, pack catalogue registration, tests, six-second project generation and documentation.

**Interfaces:** Deterministic drawing from time, native color/period controls, regular project/render CLI.

- [x] Add failing determinism and boundary tests.
- [x] Implement loops and the fixture using existing registry and plugin conventions; document external inspiration.
- [x] Render stills and MP4, inspect images, and run delivery verification.

### Task 4: Verification and review

- [x] Run full tests, type checking and editor build, inspect diff and request a fresh review.
- [x] Fix actionable review findings and record evidence and limitations in the progress report.

Final evidence (2026-11-03): 217 test files / 1958 tests pass, root and Worker TypeScript checks pass, editor builds, catalogue is synchronized. Full suite uses two thread workers and a 15000 ms per-test timeout after the unchanged local HTTP cache fixture timed out at 5000 ms under load (its isolated repeat passed). The final MP4, decoded contact sheet, portable archive and delivery JSON are in `out/product-loop/`. A real-browser regression verifies moving pixels in plugin-project exports. Independent review found no unresolved actionable issues. Autonomous artistic improvement and the Scenario generation provider are not claimed by this change.
