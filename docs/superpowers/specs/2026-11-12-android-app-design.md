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
- Building or installing the Android toolchain on the owner's machine: every Android build runs on GitHub's CI.
- Uploading to the Play Console automatically: the owner uploads the `.aab` by hand for now.
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
- **Secrets never in the repo.** The upload keystore and its passwords live in the repository's GitHub secrets (the keystore base64-encoded); the CI job writes them to a temporary file for the build only.
- **Built on CI only.** Nothing Android is built on the owner's machine. The work is committed on `develop` only, never pushed by the builder; the owner updates the version (`scripts/version.ts`) and pushes, and CI builds.

## How (decided)

- **Same Tauri crate as the desktop.** `apps/desktop/src-tauri` gains the Android target (Tauri 2 mobile). Code that only makes sense on the desktop is put behind `#[cfg(desktop)]` / `#[cfg(mobile)]`: single instance, the quick bubble window, the `.tramme` file association, the projects folder setting, the update notice and downloads.
- **Identity** (confirmed by the owner; it can never change once published): application id `app.tramme`, in the line of the desktop's `app.tramme.desktop`, set by an Android-only config override (`tauri.android.conf.json`) so the desktop keeps its own. Name on the phone: Tramme. Portrait and landscape both allowed.
- **Environment**: the same environment selection as the desktop build (`build.rs` from `brand/environments.ts`); the build uploaded to the Play Store points at production. Analytics behave as on the desktop (opt-in).
- **Same editor**, served by the same custom protocol (on Android the webview reaches it as `http://tramme.localhost`). The editor learns it is on Android from the Tauri global (as `apps/editor/src/tauri.ts` does for the desktop) and adapts only what this design lists.
- **Storage**: the store of `store.rs` unchanged, rooted in the app's private data folder instead of `Documents/Tramme`. Projects are private to the app; what leaves the phone leaves through export, `.tramme` export or share.
- **Secrets** (provider keys, account session cookie): `keyring` has no Android backend. A small storage behind the same `Secrets` interface as `keys.rs`, encrypted with a key held by the Android Keystore, so `keys.rs` and `account.rs` keep their logic.
- **Provider calls and account**: `fetch.rs` and `account.rs` as on the desktop (ureq with rustls works on Android).
- **Import**: the editor's existing file inputs, opened through the system picker (photos, videos, sounds, `.tramme`). If the webview does not open the picker on its own, the app's Android side answers it.
- **Export**: on Android, the video is written in pieces to a file in the app's storage (mediabunny's stream target) instead of a buffer in memory. Then a sheet offers **Save to gallery** (MediaStore, `Movies/Tramme`) and **Share** (the Android share sheet); a file that is not a picture or a video (a `.tramme`, a zip, the account's data) offers **Save to Downloads** and **Share**. Every place of the editor that saves a file today (`saveBlob`) takes this way on Android. The other heavy jobs that use `BufferTarget` (proxies, cutout, depth, faces, long jobs) keep working as they are; they are not part of this project unless a test on a phone shows they crash.
- **Screen and lifecycle**: the screen stays on during an export; leaving the app during an export warns that it will stop. The Android back button closes the open sheet or menu first, then goes back in the editor's router, then leaves the app.
- **Permissions** asked at the moment of use only: microphone for dictation and voice-over. No storage permission for reading (the system picker needs none) and none for saving to `Movies/` on recent Android.
- **Android versions**: minimum Android 8 (API 26), target the API level Play requires at build time. Video export needs WebCodecs in the system WebView (Chromium 94 or newer, updated by the Play Store); where it is missing, the export formats are explained instead of failing late, as `webexport.ts` already does with `VideoEncoder`.
- **Version**: the Android version name follows `tauri.conf.json` (set by `scripts/version.ts`); the version code is Tauri's own derivation from it (it always grows with the version).
- **Icons**: the Android icons already in `apps/desktop/src-tauri/icons/android` (from `icons/mobile-source.png`).
- **The generated Android project is not committed** (decided while planning): nobody runs the Android toolchain outside CI, so CI runs `tauri android init --ci` on every build. Everything of ours lives outside it: the Kotlin code in a small Tauri plugin crate of the repo (its `android/` library and manifest are merged into the app by Tauri), the identifier in `tauri.android.conf.json`. Signing is done after the build on the produced files (`apksigner` for the `.apk`, `jarsigner` for the `.aab`), so the generated Gradle files are never patched.
- **CI**: an Android job next to the desktop ones in `.github/workflows/desktop.yml`, on the same triggers: the release (a version on `main` without a tag) builds the signed `.aab` and a signed `.apk`; a manual run on another branch builds them too. The `.aab` stays a private workflow artifact, for the Play Console. The signed `.apk` goes into the GitHub release like the desktop installers, under a stable name, so **the site offers it** (download page, and the download button on an Android phone): that is how the owner and testers install it. Like the desktop, the beta workflow on `develop` builds its own product, "Tramme Beta" (`app.tramme.beta`, beta environment), published as a prerelease that the beta site offers, and installable next to the stable app; the stable app comes from `main`'s release. One reusable Android workflow serves both. Without the signing secrets, the job builds an unsigned debug `.apk` as a private artifact only and says so: nothing unsigned is ever published, and the desktop release goes on without Android.
- **Updates**: the Android app shows no update notice of its own (Play forbids an app from Play to update itself any other way). Known limit, said on the download page: the site's `.apk` is signed with the upload key, the Play Store's with Google's key, so one cannot update the other; moving from the site's app to the Play Store's means uninstalling first, and the projects stored in the app go with it unless exported.
- **Upload keystore**: created once by a manual workflow (or a documented `keytool` command run in CI), certificate `CN=Tramme, O=Qualris`; the owner stores the result in the GitHub secrets and keeps a copy somewhere safe. If it is ever lost, Google can reset the upload key (Play App Signing holds the real one).
- **npm scripts** `android:dev` and `android:build` exist for whoever has the toolchain (CI calls `android:build`); nobody needs them on the owner's machine.
- **Docs**: `docs/desktop-and-mobile-apps.md` step 6 updated with what was done; a short "Android" section in `CONTRIBUTING.md` (the secrets to set, where the artifacts land, how to upload to the Play Console).

## Left to the builder

- The CI job's setup (JDK, Android SDK and NDK, Rust Android targets, caches), kept as short as the desktop jobs.
- The exact secure-storage implementation behind `Secrets` (a Tauri mobile plugin in Kotlin, or a maintained crate), as long as the key stays in the Android Keystore.
- Whether "Save to gallery" and "Share" are one small Kotlin plugin of the app or existing maintained Tauri plugins; prefer the fewest dependencies.
- How the editor exposes "is Android" (one helper next to the desktop's detection, reused everywhere: no scattered checks).
- Which existing purchase entry points to hide (find them in `accounts.ts`, `ui/Space.tsx` and the billing calls) and how, with one switch.

## Checks before calling it done

- Locally, without any Android toolchain: the desktop still builds and its tests pass (Rust store tests, storage contract suite, `npm test`, `npm run typecheck`); the editor's Android branches are covered by its own tests where they hold logic (version code, export sheet choice, back button order, purchase switch).
- On CI: the Android job compiles and produces the artifacts.
- The beta site's download page offers the beta `.apk` once the beta workflow has run with the signing secrets.
- By the owner, on a phone with the `.apk` from the site: create a project, import a video from the gallery, edit, export a 9:16 video of at least 60 seconds without a crash, find it in the gallery, share it; sign in to the account; save a provider key, restart the app, the assistant still works; the back button behaves as described.
- No purchase entry point visible on Android.
- The CI's `.aab` is signed with a certificate that says Qualris.
