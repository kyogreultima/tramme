# Contributing to Tramme

Thank you for your interest. Bug reports, ideas, documentation and code are all welcome.

By taking part, you agree to the [code of conduct](CODE_OF_CONDUCT.md). For a security problem, follow [SECURITY.md](SECURITY.md) rather than opening an issue.

## Before you start

- **Bugs:** open an issue with the steps to reproduce, what you expected, what happened, and your browser and OS. A small `.tramme` project that shows the problem helps a lot.
- **Features and larger changes:** open an issue first to discuss the idea. It avoids work that would not fit the project's direction.
- **Small fixes** (typos, obvious bugs): a pull request directly is fine.

## Setup

Node 24 or newer. Chrome is needed for command-line renders. Rust is needed for the desktop storage test: without `cargo` on the PATH those tests are skipped, and CI (which has Rust) makes sure they still run somewhere.

```sh
npm install
npm test            # unit tests (Vitest)
npm run typecheck
npm run dev         # the editor on http://localhost:8787/
```

`npm run dev` runs the Worker locally with simulated storage in `.wrangler/state`. Model keys for the assistant go in `apps/worker/.dev.vars` (copy `apps/worker/.dev.vars.example`), which git ignores. More in [docs/deploy.md](docs/deploy.md).

## Where things are

| Folder | Content |
|---|---|
| `packages/core` | Document, properties, keyframes, expressions, modifiers, evaluation, operations, validation |
| `packages/nodes` | Native nodes and effects |
| `packages/render` | Canvas2D renderer, WebGL2 compositor, assets |
| `packages/interop` | Lottie and SVG export, Lottie import |
| `packages/project` | Project format and `.tramme` archives |
| `packages/assistant` | The assistant's models, prompt and tools |
| `packages/plugin` | The types of a plugin (nodes, effects, tools…) and `definePlugin()`, for completion and checks while writing one |
| `packages/api` | The `/api` routes wherever they run: storage over any bucket (R2, IndexedDB), providers reached with the user's keys |
| `packages/cli` | Command line: offline rendering, exports, local companion |
| `apps/editor` | The web editor (Preact) |
| `apps/worker` | The Cloudflare Worker: serves the editor, projects in R2, assistant relay |
| `apps/desktop` | The native app (Tauri 2): one window on the editor, the `/api` storage answered from the local folders in Rust |
| `apps/site` | The project's site (Astro, static): the landing page and the docs under `/docs/` (Starlight, made from `docs/` and the README: `src/lib/docs.ts`) |

The document format is described in [docs/document.md](docs/document.md), the project format in [docs/project.md](docs/project.md).

## Guidelines

- **The engine stays generic.** `packages/` must not depend on a particular brand, product or project. Project-specific behavior belongs in project plugins or in `examples/`.
- **Rendering stays deterministic.** Every frame must be a pure function of time: no `Math.random()` without a seed, no wall clock, no state carried between frames.
- **The editor and the assistant share one API.** Every change to the document goes through operations, so it can be undone and the assistant can make it too.
- **Interface text is translated.** The editor is written in English: every visible text goes through `t()` with a key defined in `apps/editor/src/i18n/en.json` and `fr.json`. A test checks it. See [docs/i18n.md](docs/i18n.md).
- **The interface works on small screens and touch.** Check layouts down to 360 px wide.
- **Match the surrounding code:** naming, comment density, formatting. Add tests for engine and format changes.

## Branches

| Branch | Role |
|---|---|
| `develop` | Where the work comes together, and the base of every pull request. Its checks always pass. |
| `main` | What is released: a new version that reaches it is published by itself (see [Releases](#releases)). Only releases and urgent fixes go into it. |
| `feat/…`, `fix/…`, `docs/…`, `refactor/…`, `test/…`, `chore/…` | One change each, made from `develop`, deleted once merged. A short name for what it does: `feat/timeline-snapping`, `fix/export-black-frame`. |
| `release/X.Y.Z` | A version bump, made by a maintainer. |

Nobody pushes to `develop` or `main` directly: everything goes through a pull request whose checks pass.

## Pull requests

1. Fork the repository (or, with write access, work in the repository itself) and create a branch from `develop`: `git switch -c feat/timeline-snapping origin/develop`.
2. Keep each pull request focused on one change. Open it as a draft for early feedback.
3. Make sure `npm test` and `npm run typecheck` pass.
4. Open the pull request against `develop`. Its title follows [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, the type among `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`, `style`, `revert`, the scope optional (`editor`, `core`, `render`, `cli`, `worker`, `desktop`, `site`…). A check enforces it: pull requests are squashed, so the title becomes the commit on `develop`. The branch's own commits can say anything.
5. Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) when the change is visible to users.
6. Describe what changed and why, and how you tested it. Add a screenshot for interface changes.
7. When `develop` has moved and the branch conflicts with it, rebase it (`git fetch origin && git rebase origin/develop`) or merge `develop` into it.

Every pull request runs the CI ([.github/workflows/ci.yml](.github/workflows/ci.yml): typecheck, tests, site build) and the title check ([.github/workflows/pr-title.yml](.github/workflows/pr-title.yml)). A maintainer reviews it and merges it once both pass.

## Releases

Maintainers release what `develop` holds:

1. On a branch `release/0.12.0` made from `develop`, `node scripts/version.ts 0.12.0` sets the version of every package and of the desktop app and dates the changelog's `Unreleased` section as `0.12.0`. Commit it as `chore(release): 0.12.0` and merge it into `develop`.
2. Open a pull request from `develop` into `main` and merge it with **Create a merge commit**, never a squash: `main` must keep `develop`'s commits, or the next release conflicts.

The desktop workflow ([.github/workflows/desktop.yml](.github/workflows/desktop.yml)) then finds a version on `main` without a tag: it builds the app on Windows, macOS and Linux, publishes the GitHub release `v0.12.0` with that changelog section as its notes, and deploys the site again. No tag to push by hand: the workflow makes it.

An urgent fix to the released version starts from `main` instead: a `fix/…` branch with the fix and a patch version (`node scripts/version.ts 0.11.2`), merged into `main`, which releases it the same way. A pull request from `main` into `develop` (a merge commit too) then brings it back; in the changelog, keep both sides.

## License and sign-off

Tramme is under the [Functional Source License 1.1, ALv2 Future License](LICENSE) (FSL-1.1-ALv2). By contributing, you agree that:

- your contribution is licensed under that licence, and under any later licence that the project's author chooses for the project, the same one on the same terms or another, a commercial one included;
- you wrote it, or you have the right to submit it under those terms, as the [Developer Certificate of Origin](https://developercertificate.org/) says.

Show it by signing off every commit: `git commit -s` adds a `Signed-off-by: Your Name <you@example.com>` line. Contributions made before this change, up to version 0.16.0, were made under the Apache License 2.0 and keep it: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
