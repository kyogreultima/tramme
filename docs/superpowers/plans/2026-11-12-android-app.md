# Tramme on Android Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Tauri app of `apps/desktop` also builds as a signed Android app (`.aab` for the Play Store, `.apk` to test), on GitHub CI only, running the same editor in local mode with native import, export, save and share.

**Architecture:** One Tauri crate for desktop and Android, desktop-only code behind `#[cfg(desktop)]`. Our Kotlin lives in a small Tauri plugin crate (`apps/desktop/plugin-device`) whose `android/` library Tauri merges into the app, so the generated Android project is never committed: CI runs `tauri android init --ci`, builds, then signs the produced files. The editor learns it is on Android in `apps/editor/src/tauri.ts` and adapts saving, exporting, purchases and the back button in one module, `apps/editor/src/device.ts`.

**Tech Stack:** Tauri 2 (mobile), Rust, Kotlin (Android library of a Tauri plugin), Preact + TypeScript (editor), mediabunny `StreamTarget`, vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-12-android-app-design.md`

## Global Constraints

- Application id `app.tramme` (permanent), name Tramme, set in `apps/desktop/src-tauri/tauri.android.conf.json` only; the desktop keeps `app.tramme.desktop`.
- Minimum Android 8 (API 26); target API level: what Tauri's template sets, at least what Play requires.
- Nothing Android is built or installed on the owner's machine. Local checks: `npm test`, `npm run typecheck`, `cargo test` and `cargo clippy` in `apps/desktop/src-tauri` (desktop target). The Android compile is proven by the CI job only.
- Commit on `develop`, never push, no co-author trailer.
- Upload key certificate: `CN=Tramme, O=Qualris`. Keystore and passwords only in GitHub secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- Android artifacts are never part of the public GitHub release nor of the site.
- No purchase entry point (plans, checkout, subscription management) visible on Android.
- Permissions only when used: `RECORD_AUDIO` (dictation, voice-over); `WRITE_EXTERNAL_STORAGE` with `android:maxSdkVersion="28"` (saving on Android 8 and 9 only). Nothing else beyond `INTERNET`.
- New UI: theme tokens only, existing components, every string in `apps/editor/src/i18n/en.json` and `fr.json`; no raw technical error shown (`plainRenderMessage`).
- DRY: one platform helper (`platform` of `tauri.ts`), no scattered `navigator.userAgent` checks.

## Review Focus

1. A long export (60 s and more, 1080×1920) on a mid-range phone: memory must stay flat → the MP4 goes to a file through positioned writes, never a whole `ArrayBuffer` (Task 3 test `write_at_patches_in_place`, Task 5 test of `deviceTarget` offsets).
2. An export name with spaces, accents or `../` → saved under a safe name, never outside the exports folder (Task 3 test).
3. Back button with a menu open on top of a project page → closes the menu, does not leave the project (Task 6 test of `backAction`).
4. App killed and reopened → provider keys and account session still there (Task 2: secrets in the Keystore-backed store, the Rust side asks Kotlin each time; checked by the owner on a phone).
5. The CI without the signing secrets (before the keystore exists) → still green, with an unsigned debug `.apk` and a notice (Task 7).

---

### Task 1: The crate builds for Android (platform gating, roots, identity)

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml` (target-specific deps)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (gating, mobile entry point, window setup)
- Modify: `apps/desktop/src-tauri/src/store.rs:30-52` (roots)
- Create: `apps/desktop/src-tauri/tauri.android.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/mobile.json`; Modify: `capabilities/default.json` (add `"platforms": ["windows", "macOS", "linux"]`)
- Modify: `.gitignore` (`apps/desktop/src-tauri/gen/android/`)

**Interfaces:**
- Produces: `store::set_roots(home: PathBuf, settings: PathBuf)`. Once called, `home()` returns `home` (unless `TRAMME_HOME` is set) and `settings_path()` returns `Some(settings)`. Set once from `setup` on mobile with `app.path().app_data_dir()?.join("Tramme")` and `app.path().app_config_dir()?.join("desktop.json")`.
- Produces: `pub fn run()` annotated `#[cfg_attr(mobile, tauri::mobile_entry_point)]`.

- [ ] **Step 1: Write the failing test** in `store.rs` tests: `roots_set_by_the_app_win` calls `set_roots(tmp/"h", tmp/"s.json")`, then asserts `home() == tmp/"h"` and `settings_path() == Some(tmp/"s.json")`. The roots are a process-wide `OnceLock`, so this is the only test that sets them; the tests that read `home()` must not depend on it (run `cargo test` to make sure none does).
- [ ] **Step 2: Run** `cargo test roots_set_by_the_app_win` in `apps/desktop/src-tauri`. Expected: FAIL, `set_roots` not found.
- [ ] **Step 3: Implement** `set_roots` with a `static ROOTS: OnceLock<(PathBuf, PathBuf)>`, consulted in `home()` after `TRAMME_HOME` and before `configured_home()`, and first in `settings_path()`.
- [ ] **Step 4: Gate the desktop-only code.** In `Cargo.toml`, move `tauri-plugin-single-instance` and `keyring` under `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`. In `lib.rs`, put behind `#[cfg(desktop)]`: the single-instance plugin, `take_open_path`/`PENDING` and the pending commands, the quick bubble commands and window events, `decorations`, `inner_size`, `min_inner_size`, `disable_drag_drop_handler`, the CDP port, `desktop_pick_home`/`desktop_set_home`, `desktop_open_plugins`. Keep one `generate_handler!` per cfg (two `invoke_handler` calls behind `#[cfg(desktop)]` / `#[cfg(mobile)]`). In `keys.rs`, `Keychain` and its `impl` are `#[cfg(desktop)]`. On mobile, `keychain()` returns a `#[cfg(mobile)] struct NoSecrets` (get → `None`, set and delete → an `HttpError` 501 "not yet on this device"); Task 2 replaces it with the real device secrets.
- [ ] **Step 5: Identity and capabilities.** `tauri.android.conf.json`: `{"identifier": "app.tramme", "bundle": {"android": {"minSdkVersion": 26}}}`. `capabilities/mobile.json`: identifier `mobile`, `"platforms": ["android", "iOS"]`, windows `["main"]`, permissions `core:default`, `notification:default`, `tramme-device:default` (Task 2).
- [ ] **Step 6: Verify the desktop is unchanged:** `cargo test` and `cargo clippy --all-targets -- -D warnings` in `apps/desktop/src-tauri`, then `npm test`. Expected: all pass, no new warning.
- [ ] **Step 7: Commit** `feat(android): the app's crate builds for Android too`.

### Task 2: The device plugin (Kotlin) and the secrets on Android

**Files:**
- Create: `apps/desktop/plugin-device/Cargo.toml` (crate `tauri-plugin-tramme-device`, `links = "tauri-plugin-tramme-device"`), `build.rs`, `src/lib.rs`, `permissions/default.toml`
- Create: `apps/desktop/plugin-device/android/build.gradle.kts`, `settings.gradle`, `src/main/AndroidManifest.xml`, `src/main/res/xml/tramme_files.xml`, `src/main/java/app/tramme/device/DevicePlugin.kt`
- Modify: `apps/desktop/src-tauri/Cargo.toml` (path dependency), `src/lib.rs` (register, store the handle), `src/keys.rs` (`keychain()` on mobile)
- Create: `apps/desktop/src-tauri/src/device_secrets.rs` (`#[cfg(mobile)]`)

**Interfaces:**
- Produces (plugin crate, Rust): `pub fn init<R: Runtime>() -> TauriPlugin<R>`; `pub struct Device<R: Runtime>(PluginHandle<R>)` (Clone), managed state, with
  - `secret_get(&self, slot: &str) -> Option<String>`, `secret_set(&self, slot: &str, value: &str) -> Result<(), String>`, `secret_delete(&self, slot: &str) -> Result<(), String>`
  - `save(&self, path: &Path, name: &str, mime: &str) -> Result<(), String>` (MediaStore: `Movies/Tramme` for `video/*`, `Pictures/Tramme` for `image/*`, `Downloads` otherwise)
  - `share(&self, path: &Path, name: &str, mime: &str) -> Result<(), String>`
  - `keep_awake(&self, on: bool)`, `exit(&self)`
  - On desktop the plugin compiles with every method returning `Err("android only")` / no-op, so the desktop build does not change.
- Produces (Kotlin, `DevicePlugin`): commands `getSecret {slot} → {value?}`, `setSecret {slot, value}`, `deleteSecret {slot}`, `save {path, name, mime}`, `share {path, name, mime}`, `keepAwake {on}`, `exit`; event `back` (triggered by an `OnBackPressedCallback` registered in `load`).
- Produces (app): `device_secrets::DeviceSecrets` implementing `keys::Secrets`, holding `OnceLock<tauri_plugin_tramme_device::Device<tauri::Wry>>` filled in `setup`; `keys::keychain()` returns it on mobile.

- [ ] **Step 1: Plugin crate.** Follow Tauri 2's mobile plugin layout: `build.rs` = `tauri_plugin::Builder::new(&[]).android_path("android").build()` (no JS commands: the app calls it from Rust; `registerListener` for the `back` event is allowed by `permissions/default.toml`). `init()` registers `app.tramme.device` / `DevicePlugin` with `api.register_android_plugin` under `#[cfg(target_os = "android")]` and manages `Device`.
- [ ] **Step 2: Kotlin.** Secrets: an AES-GCM key in the `AndroidKeyStore` (alias `tramme-secrets`), values encrypted into a private `SharedPreferences` file `tramme-secrets` (IV + ciphertext, base64); no `androidx.security.crypto` (deprecated). `save`: `MediaStore` insert with `RELATIVE_PATH` on API 29+, and on 26–28 a copy into the public folder after asking `WRITE_EXTERNAL_STORAGE` at that moment. `share`: `FileProvider` (authority `${applicationId}.tramme.files`, paths in `tramme_files.xml` covering the app's cache `exports/`), `ACTION_SEND` with `FLAG_GRANT_READ_URI_PERMISSION`, chooser. `keepAwake`: `FLAG_KEEP_SCREEN_ON` on the UI thread. Manifest: `RECORD_AUDIO`, `WRITE_EXTERNAL_STORAGE` with `maxSdkVersion="28"`, the provider.
- [ ] **Step 3: Wire the app.** `.plugin(tauri_plugin_tramme_device::init())` on all platforms; in `setup` on mobile, `device_secrets::install(app.state::<Device<Wry>>().inner().clone())`.
- [ ] **Step 4: Desktop unchanged:** `cargo test`, `cargo clippy --all-targets -- -D warnings` in `apps/desktop/src-tauri`; `cargo clippy` in `apps/desktop/plugin-device`. Expected: pass. The Kotlin compiles only in CI (Task 7).
- [ ] **Step 5: Commit** `feat(android): the device plugin, secrets in the Android Keystore`.

### Task 3: The exports folder (Rust)

**Files:**
- Create: `apps/desktop/src-tauri/src/exports.rs`
- Modify: `apps/desktop/src-tauri/src/api.rs` (route, `#[cfg(mobile)]`), `src/lib.rs` (commands, init at setup)

**Interfaces:**
- Produces: `exports::init(dir: PathBuf)`; `exports::safe_name(name: &str) -> String` (keeps letters with accents, digits, `-_. `; anything else → `_`; no leading dot; at most 120 chars; empty → `export`); `exports::write_at(dir: &Path, name: &str, at: u64, data: &[u8]) -> Res<()>` (creates the file, writes at `at`, never truncates); `exports::path_of(dir: &Path, name: &str) -> PathBuf` (inside `dir`, through `safe_name`); `exports::remove(dir, name) -> Res<()>`; `exports::sweep(dir: &Path, older_than: Duration)`.
- Produces (HTTP, mobile): `PUT /api/device/exports/<name>?at=<n>` body = bytes → 204; `GET /api/device/exports/<name>` with byte ranges (reuse `store::parse_range`) → the file; `DELETE /api/device/exports/<name>` → 204.
- Produces (commands, mobile): `device_save(name: String, mime: String)`, `device_share(name: String, mime: String)`, `device_keep_awake(on: bool)`, `device_exit()`; they resolve `path_of` and call `Device`. Folder: `app_cache_dir()/exports`, swept of files older than 24 h at setup.

- [ ] **Step 1: Write the failing tests** in `exports.rs`: `safe_name_keeps_accents_and_drops_paths` (`safe_name("Mon film été.mp4") == "Mon film été.mp4"`; for `"../../x.mp4"`, `"a\\b.mp4"`, `".hidden"` and `""`: the result is non-empty, has no `/` nor `\`, does not start with `.`, and `path_of(dir, name).parent() == Some(dir)`); `write_at_patches_in_place` (write `b"aaaa"` at 0, `b"bbbb"` at 4, `b"XX"` at 1 → file is `b"aXXabbbb"`); `sweep_removes_only_old_files`.
- [ ] **Step 2: Run** `cargo test exports`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `exports.rs` (std `File` + `seek`), the route and the commands.
- [ ] **Step 4: Run** `cargo test` and clippy. Expected: PASS.
- [ ] **Step 5: Commit** `feat(android): an exports folder written in place`.

### Task 4: The editor knows Android, hides purchases and desktop-only settings

**Files:**
- Modify: `apps/editor/src/tauri.ts` (`platform`, `frame`)
- Modify: `apps/editor/src/accounts.ts` (`sellsHere`)
- Modify: `apps/editor/src/ui/Space.tsx:67-100` (offers and subscription block)
- Modify: the settings' Storage section, the companion settings, the update notice and `ui/WindowControls.tsx` callers: hidden when `platform === 'android'`
- Test: `apps/editor/test/device-platform.test.ts`

**Interfaces:**
- Produces: `export const platform: 'android' | 'desktop' | undefined` in `tauri.ts` (`'android'` when `tauri` is defined and `/Android/i.test(navigator.userAgent)`); `frame` is `undefined` on Android. A pure `platformOf(hasTauri: boolean, ua: string)` behind it, for the tests.
- Produces: `export const sellsHere = (): boolean => platform !== 'android'` in `accounts.ts`.

- [ ] **Step 1: Write the failing tests:** `platformOf(false, 'Android') === undefined`; `platformOf(true, 'Mozilla/5.0 (Linux; Android 14; Pixel 8) ... Chrome/130 Mobile') === 'android'`; `platformOf(true, 'Windows NT 10.0') === 'desktop'`.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/device-platform.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then hide in `Space.tsx` the plan offers, the period choice, the choose and manage-subscription buttons when `!sellsHere()` (the current plan and credits stay visible). Hide the Storage section (projects folder), the companion setup, the desktop update notice and the window controls on Android.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(android): the editor knows it is on a phone, sells nothing there`.

### Task 5: Saving, exporting and sharing on the phone

**Files:**
- Create: `apps/editor/src/device.ts`, `apps/editor/src/ui/DeviceSaveSheet.tsx`
- Modify: `apps/editor/src/download.ts` (`saveBlob` on Android), `apps/editor/src/webexport.ts:186-195` (target), the export runners that call `exportInBrowser` (keep awake)
- Modify: `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/device.test.ts`

**Interfaces:**
- Consumes: `platform` (Task 4); HTTP `PUT/GET /api/device/exports/<name>` and commands `device_save`, `device_share`, `device_keep_awake` (Task 3).
- Produces in `device.ts`:
  - `saveChoices(mime: string): ['gallery', 'share'] | ['downloads', 'share']` (`video/*` and `image/*` → gallery).
  - `deviceTarget(name: string): { target: StreamTarget; finish(): Promise<Blob> }`: a mediabunny `StreamTarget` whose `onData({ data, position })` sends `PUT ?at=position` (in order, awaited one after another, chunked so one request stays ≤ 8 MB); `finish()` returns `await (await fetch(url)).blob()` and remembers it (below).
  - `deviceFileOf(blob: Blob): string | undefined`, from a `WeakMap<Blob, string>` filled by `finish()`.
  - `saveOnDevice(blob: Blob, name: string): Promise<boolean>`: writes the blob to the exports folder in 8 MB `PUT`s unless `deviceFileOf(blob)` already names it, then opens `DeviceSaveSheet` with `saveChoices(blob.type)`; resolves `false` when dismissed.
  - `keepAwake(on: boolean): void` (no-op off Android).
- `download.ts`: `saveBlob` starts with `if (platform === 'android') return saveOnDevice(blob, name);`.
- `webexport.ts`: on Android, MP4 uses `deviceTarget(name)` with `fastStart: false`, WebM with `deviceTarget` too; elsewhere `BufferTarget` exactly as today.

- [ ] **Step 1: Write the failing tests:** `saveChoices('video/mp4')` → `['gallery','share']`; `saveChoices('image/png')` → `['gallery','share']`; `saveChoices('application/zip')` → `['downloads','share']`; `saveChoices('')` → `['downloads','share']`; `deviceTarget` with a stubbed `fetch`: three chunks at positions 0, 100, 4 → three `PUT`s with `?at=0`, `?at=100`, `?at=4` in that order; a 20 MB chunk → three requests of ≤ 8 MB with consecutive offsets.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/device.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `device.ts`, `DeviceSaveSheet.tsx` (built on the editor's existing dialog component, two buttons, theme tokens; labels `device.saveToGallery`, `device.saveToDownloads`, `device.share`, `device.saved`), the `saveBlob` branch, the `webexport.ts` target choice, `keepAwake(true)` / `keepAwake(false)` around every `exportInBrowser` run (in a `finally`), and a notification through the existing notification plugin when the page becomes hidden during an export (`device.exportNeedsTramme`).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS; the web and desktop export tests (`exports.test.ts`, `webscene-export-limit.test.ts`) unchanged.
- [ ] **Step 5: Commit** `feat(android): exports written to a file, saved to the gallery or shared`.

### Task 6: The back button

**Files:**
- Modify: `apps/editor/src/device.ts` (`backAction`, listener)
- Modify: `apps/editor/src/main.tsx` (start the listener on Android)
- Test: `apps/editor/test/device.test.ts`

**Interfaces:**
- Consumes: the plugin's `back` event (Task 2) through `tauri.core.addPluginListener('tramme-device', 'back', cb)` (add `addPluginListener` to the `Tauri` interface of `tauri.ts`); command `device_exit` (Task 3).
- Produces: `backAction(s: { overlayOpen: boolean; path: string }): 'escape' | 'history' | 'exit'`: an open overlay → `'escape'`; otherwise a path other than `/` → `'history'`; `/` → `'exit'`. `'escape'` dispatches a `keydown` `Escape` on `document.activeElement ?? document.body` (the editor's menus, popovers and dialogs already close on Escape); `'history'` → `history.back()`; `'exit'` → `device_exit`. `overlayOpen` reads the DOM for the editor's open menus, popovers and dialogs (find their selectors in `ui/shell.tsx` and `ui/controls.tsx`; one selector constant).

- [ ] **Step 1: Write the failing tests:** `backAction({overlayOpen: true, path: '/p/abc'})` → `'escape'`; `({overlayOpen: false, path: '/p/abc'})` → `'history'`; `({overlayOpen: false, path: '/space'})` → `'history'`; `({overlayOpen: false, path: '/'})` → `'exit'`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** and start the listener in `main.tsx` when `platform === 'android'`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(android): the back button closes, goes back, then leaves`.

### Task 7: CI builds and signs; scripts and docs

**Files:**
- Modify: `.github/workflows/desktop.yml` (job `android`; `release` downloads `pattern: desktop-*` only)
- Create: `.github/workflows/android-keystore.yml`
- Modify: `package.json` (`android:dev`, `android:build`)
- Modify: `CONTRIBUTING.md` (section Android), `docs/desktop-and-mobile-apps.md` (step 6), `CHANGELOG.md` (unreleased section, if the file keeps one)

**Interfaces:**
- Consumes: everything above; secrets of the Global Constraints.
- Produces: artifact `android` with `tramme-<version>.aab` and `tramme-<version>.apk` (signed), or `tramme-<version>-debug.apk` without the secrets.

- [ ] **Step 1: Scripts.** `"android:dev": "node apps/editor/build.ts && cd apps/desktop && tauri android dev"`, `"android:build": "node apps/editor/build.ts && cd apps/desktop && tauri android build"`.
- [ ] **Step 2: Job `android`** in `desktop.yml`, `needs: [plan, checks]`, same `if` as `build`, `runs-on: ubuntu-latest`: `./.github/actions/setup` with `rust-targets: aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android`; `actions/setup-java@v4` (temurin 17); `android-actions/setup-android@v3`; `sdkmanager "ndk;27.2.12479018"` and `NDK_HOME` set to it; `npm ci`; `cd apps/desktop && npx tauri android init --ci`; with `TRAMME_GA_API_SECRET` as the desktop: `npm run android:build -- --aab --apk` when the signing secrets exist, else `npm run android:build -- --apk --debug` and a `::notice::` saying the build is unsigned. Signing step (secrets present): decode `ANDROID_KEYSTORE_BASE64` to `$RUNNER_TEMP/upload.jks`; `zipalign -p 4` then `apksigner sign` for the universal release `.apk`; `jarsigner -sigalg SHA256withRSA -digestalg SHA-256` for the `.aab`; `apksigner verify --print-certs` and fail unless the output contains `O=Qualris`; remove the keystore file. Rename to the names above, `actions/upload-artifact@v4` name `android`, `if-no-files-found: error`.
- [ ] **Step 3: Release untouched by Android:** in `release`, `actions/download-artifact@v4` gets `pattern: desktop-*` with `merge-multiple: true`.
- [ ] **Step 4: `android-keystore.yml`**, `workflow_dispatch` only: needs `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD` set first; `keytool -genkeypair -v -keystore upload.jks -alias tramme -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Tramme, O=Qualris"`; prints the base64 nowhere; uploads `upload.jks` as an artifact with `retention-days: 1`. Comment at the top: download it, store its base64 as `ANDROID_KEYSTORE_BASE64` and the alias `tramme` as `ANDROID_KEY_ALIAS`, keep a copy offline, delete the artifact.
- [ ] **Step 5: Docs.** CONTRIBUTING "Android": the four secrets, the keystore workflow, where the artifacts land, uploading the `.aab` to the Play Console, installing the `.apk` on a phone; the owner's phone checklist from the spec's "Checks". `docs/desktop-and-mobile-apps.md` step 6: what was done and how (plugin crate, generated project not committed, signing after build).
- [ ] **Step 6: Validate the workflow files** locally: `npx --yes @action-validator/cli .github/workflows/desktop.yml` and the keystore one (or `actionlint` if available). Expected: no error. Then `npm test`, `npm run typecheck`.
- [ ] **Step 7: Commit** `ci(android): the app built and signed on CI`.

After Task 7: tell the owner that the Android compile is proven only by the first CI run after their version bump and push, and what to set in the GitHub secrets.
