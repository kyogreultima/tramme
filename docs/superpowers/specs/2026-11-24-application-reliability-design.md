# Application Reliability Corrections

## Intent

Correct the seven regressions documented in the application review: blocking project moves, hidden command/mention menus, an inaccessible gallery publication path, gallery 404s, spoken prompts in non-voice audio, desktop version snapshots being rejected, and false plugin-sandbox failures.

## Goals

- Project moves continue in background without blocking or hijacking navigation.
- `/` and `@` menus remain visible when many files are attached.
- Gallery publication has one explicit, reachable action for a signed-in account after MP4 export.
- Explore supports an in-page search and project links resolve against the same environment as the listing.
- `sfx` and `music` requests explicitly forbid intelligible speech and can be checked before insertion.
- Desktop and TypeScript project-path validators accept the same `versions/*.json` files.
- Deliberate sandbox reloads are silent; real failures produce one deduplicated notification.

## Non-goals

- Persisting background transfers after the application process exits.
- Adding new audio providers or automatically spending credits on retries.
- Redesigning the whole export interface or gallery information architecture.

## Constraints

- Reuse the existing transfer, gallery, project-format, plugin-host and audio-generation boundaries.
- Preserve the current copy-verify-delete safety of project moves.
- Do not introduce new runtime dependencies.
- Treat the current `develop` branch as the deployment source for both web and desktop.

## Approaches

The selected approach is incremental repair at each existing boundary. It reuses `bringInBackground`, anchors menus to the brief input area, derives publication eligibility from account/project state rather than deployment mode, adds query filtering to Explore while keeping project links canonical, centralizes non-voice prompt guards in the audio API, aligns the Rust path table with TypeScript, and gives sandbox closure an explicit deliberate/failure distinction.

A broad state-management rewrite was rejected because the application already has the required global transfer and notification mechanisms. A UI-only patch was rejected because it would leave the native validator, environment routing and audio/provider boundaries inconsistent.

## Acceptance

- Each regression has an automated test that fails without its correction.
- Existing targeted suites and the repository-wide test suite pass.
- A production build and TypeScript checks pass.
- Desktop Rust tests cover version paths.
