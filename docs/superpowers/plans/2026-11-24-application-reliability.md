# Application Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair all seven application regressions from project transfer through publication, rendering and generated audio.

**Architecture:** Make narrow corrections at established boundaries and expose small pure helpers where UI behavior needs direct tests. Reuse existing global job state and keep provider, native storage and sandbox semantics aligned across platforms.

**Tech Stack:** TypeScript, Preact, Astro, Vitest, Rust/Tauri, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-24-application-reliability-design.md`

## Global Constraints

- Work directly on `develop` as explicitly requested.
- No new runtime dependencies.
- Keep project moves copy-verify-delete and never auto-retry a paid audio generation.
- Every production behavior change follows RED-GREEN TDD.

## Review Focus

- A background move fails after navigation: it must remain retryable and must not redirect.
- A menu opened near either viewport edge: it must remain visible and keyboard-scrollable.
- A signed-in desktop account with a local versus cloud project: publication eligibility must be intentional.
- A gallery query containing spaces or accents: it must filter without changing routes.
- A non-voice sound prompt already containing “voice” or “vocals”: the final provider request must still forbid speech without corrupting the requested sound.

---

### Task 1: Desktop version-path parity

**Files:**
- Modify: `apps/desktop/src-tauri/src/format.rs`
- Test: `apps/desktop/src-tauri/src/format.rs`

**Interfaces:**
- Produces: Rust `path_issue()` accepts `versions/index.json` and timestamp snapshots exactly as TypeScript does.

- [ ] Add failing Rust assertions for valid and traversal-invalid version paths.
- [ ] Run the focused Rust test and confirm the valid paths fail.
- [ ] Add `versions` JSON extensions and update the diagnostic location list.
- [ ] Run the focused Rust test and confirm it passes.
- [ ] Commit the task.

### Task 2: Deliberate sandbox reloads and toast deduplication

**Files:**
- Modify: `apps/editor/src/plugins/host.ts`, `apps/editor/src/preview.ts`, `apps/editor/src/state.ts`
- Test: `apps/editor/test/plugin-sandbox.test.ts`, `apps/editor/test/state.test.ts`

**Interfaces:**
- Produces: `PluginHost.dispose(reason?, notify?)` or equivalent explicit failure semantics; `toast()` coalesces identical active notifications.

- [ ] Add failing tests proving deliberate closure is silent and identical active toasts are coalesced.
- [ ] Run them and confirm expected failures.
- [ ] Implement explicit failure notification and deduplication; use silent disposal for module reload.
- [ ] Run focused tests and commit.

### Task 3: Background project moves

**Files:**
- Modify: `apps/editor/src/ui/Home.tsx`, `apps/editor/src/ui/BringDialog.tsx`, `apps/editor/src/bring.ts`
- Test: `apps/editor/test/bring-background.test.ts`, `apps/editor/test/home-move.test.tsx`

**Interfaces:**
- Consumes: existing `bringInBackground()` global state.
- Produces: a background entry point that supports both directions and completion callbacks without route changes.

- [ ] Add failing tests for a card move starting global background work and leaving navigation untouched.
- [ ] Run tests and confirm failure.
- [ ] Generalize/reuse the background runner for account-bound and computer-bound moves; remove the blocking modal path.
- [ ] Run focused tests and commit.

### Task 4: Visible command and mention menus

**Files:**
- Modify: `apps/editor/src/ui/Home.tsx`, `apps/editor/src/screens/home.css`, `apps/editor/src/screens/conversation.css`
- Test: `apps/editor/test/home-commands.test.ts`

**Interfaces:**
- Produces: a stable `.brief-input` anchor and independently scrolling file-chip region.

- [ ] Add a failing DOM test asserting menus live inside the input anchor rather than after file chips.
- [ ] Confirm failure.
- [ ] Move menu views into the anchor and cap the file list height; retain keyboard behavior.
- [ ] Run focused tests and commit.

### Task 5: Publication eligibility and diagnostics

**Files:**
- Modify: `apps/editor/src/ui/TopBar.tsx`, `apps/editor/src/gallery.ts`, `apps/editor/src/ui/GalleryDialog.tsx`, i18n files
- Test: `apps/editor/test/gallery-ui.test.tsx`, `apps/editor/test/gallery.test.ts`

**Interfaces:**
- Produces: `canPublishToGallery(account, project, exportName)` and `myFilms()` that propagates read failures.

- [ ] Add failing tests for signed-in desktop publication, signed-out hiding, non-MP4 hiding and gallery-read failure visibility.
- [ ] Confirm failures.
- [ ] Implement account/project eligibility and stop swallowing `myFilms()` errors; show load errors in the dialog.
- [ ] Run focused tests and commit.

### Task 6: Explore search and environment-safe project links

**Files:**
- Modify: `apps/site/src/pages/[...lang]/explore.astro`, `apps/site/src/lib/gallery.ts`, site i18n/styles as needed
- Test: `apps/site/test/gallery.test.ts`, add `apps/site/test/explore.test.ts`

**Interfaces:**
- Produces: `filterProjects(projects, query)` with accent-insensitive matching and canonical `/p/<id>/` links.

- [ ] Add failing pure filtering tests and rendered-page assertions for an in-page search form.
- [ ] Confirm failures.
- [ ] Implement filtering from `?q=`, preserve locale and avoid route-shaped searches.
- [ ] Run site tests and commit.

### Task 7: Non-voice audio speech guard

**Files:**
- Modify: `packages/api/src/generate.ts`, `apps/editor/src/sound.ts`, `apps/editor/src/music-structure.ts`
- Test: `apps/worker/test/worker.test.ts`, `apps/editor/test/music-structure.test.ts`, `apps/editor/test/sound.test.ts`

**Interfaces:**
- Produces: `nonVoicePrompt(kind, prompt)` and provider payloads that explicitly exclude speech; generated metadata retains original prompt.

- [ ] Add failing payload tests for SFX and music no-speech constraints, including prompts containing vocal terms.
- [ ] Confirm failures.
- [ ] Implement provider-appropriate negative instructions without changing voice requests or user-visible metadata.
- [ ] Run focused audio tests and commit.

### Task 8: Integrated verification

**Files:**
- Modify only if a failing verification exposes a regression, under TDD.

**Interfaces:**
- Consumes: all prior task contracts.

- [ ] Run TypeScript checks, editor/site builds, Rust tests and the full Vitest suite.
- [ ] Fix only reproduced regressions with a failing test first.
- [ ] Run `git diff --check` and inspect the final diff.
- [ ] Commit verification fixes if any.
