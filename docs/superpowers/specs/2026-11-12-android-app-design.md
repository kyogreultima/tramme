# Tramme on Android (Play Store)

Date: 2026-11-12. Status: design, waiting for approval.

## Intent

Tramme must also be a mobile app, published on the Google Play Store under Qualris. The editor already works on a phone as an installable web app (the owner estimates the responsive work at 80 % done); this project is about **packaging that same editor as a native Android app** that the Play Store accepts, not about new editing features.

Out of scope, a separate project to brainstorm next: reaching CapCut's feature level on the phone (the loop "pick clips in the gallery → cut, split, reorder with the thumb → text, music, transitions, effects from a bottom toolbar → export 9:16 and share"). This project only makes sure that loop's two ends that depend on the device, **import from the gallery** and **export to the gallery or a share**, work natively.

Also out of scope, handled by the owner: the Play Console organization account for Qualris, the D-U-N-S number, identity checks, the store listing texts, the privacy policy and the content rating questionnaire.

## Goals

1. An Android App Bundle (`.aab`) built from this repository, signed with an upload key whose certificate names Qualris, ready to upload to the Play Console.
2. The app runs the same editor as the web and the desktop, in local mode like the desktop: projects stored on the phone, the assistant with the user's own keys held securely, sign-in to the Tramme account working like on the desktop.
3. On a phone: import photos, videos and sounds from the gallery and files; export a video without running out of memory, then save it to the gallery or share it to another app (TikTok, Instagram, WhatsApp…).
4. The app passes Play's technical requirements: current target API level, 64-bit, adaptive icon, permissions asked only when used.

## Non-goals

- New editing tools (the CapCut project).
- iOS (later; WKWebView has its own export questions, see docs/desktop-and-mobile-apps.md).
- Selling anything in the app. Nothing is sold today.
- A CI workflow for Android (the CI quota is exhausted; local build only for now).
- Google or GitHub sign-in (already off in the desktop app, same reason: needs the system browser and a way back).
- The local companion (`tramme agent`): impossible on a phone, hidden.

## Anti-goals

- A second editor or a fork of `apps/editor` for mobile. One editor, detected at runtime, like the desktop.
- A second Rust crate duplicating the desktop's storage, keys, account and fetch code.
- Anything that would get the app rejected: a purchase button or link to a payment page in the Android app, permissions requested at launch "just in case", keys or session cookies stored in plain files.
- An export that loads the whole video in memory and crashes on a mid-range phone.

## Constraints

- **Payments, later.** When the AI is included by default, a subscription will be sold and attached to the account: bought on one device, valid on all. Google accepts this as long as the Android app neither sells nor points to a payment page outside Play Billing. So from this first version, the Android app hides every purchase entry point (plans, checkout, upgrade buttons) and only reflects the account's current entitlements. Whether to add Play Billing later is a business decision, not part of this project.
- **Publisher Qualris.** Upload key certificate: `O=Qualris`; `publisher` and copyright already say Qualris in `tauri.conf.json`.
- **Environments.** Links and the backend come from `brand/environments.ts` (as `account.rs` does through `build.rs`); never a hardcoded domain.
- **Theme tokens only** for any new UI (save/share sheet, permission explanations); no raw technical errors shown to the user (`plainRenderMessage`).
- **Secrets never in the repo.** The upload keystore and its passwords live outside the repository; the build reads them from environment variables or a git-ignored properties file.
- **No push**: work is committed on `develop` only.

## How (decided)

- **Same Tauri crate as the desktop.** `apps/desktop/src-tauri` gains the Android target (`tauri android init`, Tauri 2 mobile). The generated Android project (`gen/android`) is committed, except build outputs. Code that only makes sense on the desktop is put behind `#[cfg(desktop)]` / `#[cfg(mobile)]`: single instance, the quick bubble window, the `.tramme` file association, the projects folder setting, the update notice and downloads.
- **Identity** (designer's call, to confirm: it can never change once published): application id `app.tramme`, in the line of the desktop's `app.tramme.desktop`, set by an Android-only config override (`tauri.android.conf.json`) so the desktop keeps its own. Name on the phone: Tramme. Portrait and landscape both allowed.
- **Environment**: the same environment selection as the desktop build (`build.rs` from `brand/environments.ts`); the build uploaded to the Play Store points at production. Analytics behave as on the desktop (opt-in).
- **Same editor**, served by the same custom protocol (on Android the webview reaches it as `http://tramme.localhost`). The editor learns it is on Android from the Tauri global (as `apps/editor/src/tauri.ts` does for the desktop) and adapts only what this design lists.
- **Storage**: the store of `store.rs` unchanged, rooted in the app's private data folder instead of `Documents/Tramme`. Projects are private to the app; what leaves the phone leaves through export, `.tramme` export or share.
- **Secrets** (provider keys, account session cookie): `keyring` has no Android backend. A small storage behind the same `Secrets` interface as `keys.rs`, encrypted with a key held by the Android Keystore, so `keys.rs` and `account.rs` keep their logic.
- **Provider calls and account**: `fetch.rs` and `account.rs` as on the desktop (ureq with rustls works on Android).
- **Import**: the editor's existing file inputs, opened through the system picker (photos, videos, sounds, `.tramme`). If the webview does not open the picker on its own, the app's Android side answers it.
- **Export**: on Android, the video is written in pieces to a file in the app's storage (mediabunny's stream target) instead of a buffer in memory. Then a sheet offers **Save to gallery** (MediaStore, `Movies/Tramme`) and **Share** (the Android share sheet). The other heavy jobs that use `BufferTarget` (proxies, cutout, depth, faces, long jobs) keep working as they are; they are not part of this project unless a test on a phone shows they crash.
- **Screen and lifecycle**: the screen stays on during an export; leaving the app during an export warns that it will stop. The Android back button closes the open sheet or menu first, then goes back in the editor's router, then leaves the app.
- **Permissions** asked at the moment of use only: microphone for dictation and voice-over. No storage permission for reading (the system picker needs none) and none for saving to `Movies/` on recent Android.
- **Android versions**: minimum Android 8 (API 26), target the API level Play requires at build time. Video export needs WebCodecs in the system WebView (Chromium 94 or newer, updated by the Play Store); where it is missing, the export formats are explained instead of failing late, as `webexport.ts` already does with `VideoEncoder`.
- **Version**: the Android version name follows `tauri.conf.json` (set by `scripts/version.ts`); the version code is derived from it so it always grows (major × 10000 + minor × 100 + patch).
- **Icons**: generated from the existing source icon with `tauri icon`, including Android's adaptive icon.
- **Commands**: `npm run android:dev` (emulator or phone over USB) and `npm run android:build` (signed `.aab`, plus an `.apk` to install directly for testing).
- **Docs**: `docs/desktop-and-mobile-apps.md` step 6 updated with what was done; a short "Android" section in `CONTRIBUTING.md` (toolchain, keystore, build).

## Left to the builder

- Installing the toolchain on this Windows machine (JDK 17, Android SDK, NDK, Rust Android targets) and writing down exactly what was installed in CONTRIBUTING.md.
- The exact secure-storage implementation behind `Secrets` (a Tauri mobile plugin in Kotlin, or a maintained crate), as long as the key stays in the Android Keystore.
- Whether "Save to gallery" and "Share" are one small Kotlin plugin of the app or existing maintained Tauri plugins; prefer the fewest dependencies.
- How the editor exposes "is Android" (one helper next to the desktop's detection, reused everywhere: no scattered checks).
- Which existing purchase entry points to hide (find them in `accounts.ts`, `ui/Space.tsx` and the billing calls) and how, with one switch.

## Checks before calling it done

- `cargo check` for the desktop target and for `aarch64-linux-android` both pass; the Rust store tests and the storage contract suite still pass on the desktop.
- On an emulator and, if available, a real phone: create a project, import a video from the gallery, edit, export a 9:16 video of at least 60 seconds without a crash, find it in the gallery, share it; sign in to the account; save a provider key, restart the app, the assistant still works; the back button behaves as described.
- No purchase entry point visible on Android.
- `npm run android:build` produces a signed `.aab` whose certificate says Qualris.
