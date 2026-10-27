# Accounts and cloud storage — design

Date: 2026-10-28. Status: agreed in conversation, waiting for review.

## Intent

Tramme becomes a product people sign in to: a user finds their projects, their libraries and their provider keys on any computer, and picks up where they left off. This is the foundation of the Meshy-like product decided with the user (credits, subscriptions, a gallery of public and private projects); it ships first because everything else hangs on an account, and because finding one's work on another device is the need that started the subject.

## The whole programme, in order

1. **Accounts and cloud storage** (this design): the backend, sign-up and sign-in, the projects and libraries kept per account, local projects brought into the account, conflicts between devices.
2. **Provider keys kept in the account** (this design too: small, and the assistant is unusable in the cloud without it).
3. Credits, subscriptions and payment (Paddle or Lemon Squeezy, merchant of record). How credits are counted is to be explored first: the agent runs in the browser, so the server cannot trust what it is told.
4. The gallery and its moderation; each project public or private.
5. The back-office.
6. The desktop app signed in to an account (see Non-goals for why it is apart).

## Goals

- Sign up and sign in with email and password, Google or GitHub. Email verification, password reset.
- Every project, library (plugins, sounds) and conversation of a signed-in user lives in their account, the same on every browser they sign in from.
- A visitor who is not signed in keeps today's personal mode: everything in their browser, keys in the key vault.
- After signing in, the projects a user made without an account in that browser can be brought into the account.
- Two devices editing the same project never overwrite each other silently: the second writer is asked which version to keep.
- The provider keys a user connects are kept in their account, encrypted, and work on every device.
- Account settings: name, password, sign out everywhere, export, delete the account and everything in it.

## Non-goals

- Credits, payment, plans and quotas, the gallery, visibility, the back-office (later projects).
- Teams: the data model has workspaces from day one, but each user has exactly one personal workspace and no way to invite anyone.
- Real-time collaboration, offline editing of cloud projects.
- **The desktop app signed in to an account.** The editor points at project files by plain URLs (`<img src>`, `<video src>`, `api.fileUrl`); in the browser the session cookie rides along, but the desktop app's page (a custom protocol origin) cannot send the cloud's cookies, and an `Authorization` header cannot be put on a media element. It needs signed file URLs or a desktop-side proxy: a project of its own. Until then the desktop keeps its local folders, and a project moves between desktop and cloud through the `.tramme` archive (export, import), which already works.
- Moving the private mode (one user behind Cloudflare Access) to accounts: it stays as it is, for self-hosting.

## Anti-goals

- A user able to read or write another user's files: the separation is by construction (every key prefixed by the workspace), not by checks sprinkled in routes.
- An account taken over through an unverified email (an OAuth sign-in linking itself to an existing account on an email the provider did not verify).
- Edits lost because a session expired mid-work.
- A second implementation of the storage semantics: the routes of `@tramme/api` serve the cloud as they serve R2, IndexedDB and the tests.

## Architecture (decided with the user)

- **The Worker stays in front** (`apps/worker`, a new `cloud` mode). It serves the editor, answers the projects, libraries and provider routes itself with the R2 binding (fast, streamed, ranged, multipart), and forwards the account routes to the backend.
- **The backend is AdonisJS** (the user wanted a full framework, for stability and maintenance; Adonis chosen over NestJS by the designer for what it ships: auth with sessions and access tokens, social sign-in, an ORM and migrations, validation, mail, rate limiting). It runs as a **Cloudflare Container** behind the Worker, one instance kept warm. It owns identities: users, their sign-in methods, workspaces, sessions, email tokens.
- **Postgres** holds the backend's data. Provider: Neon, EU region (designer's call; any Postgres reachable by `DATABASE_URL` works).
- **R2** holds the files, in an EU-jurisdiction bucket, every key under `w/<workspaceId>/` with today's layout below it (`projects/<id>/<path>`, `library/<shelf>/<name>`, `config/keys.json`).
- **Mail** goes through Cloudflare Email Service over authenticated SMTP, from Adonis's mail package.

How the Worker knows who is calling, without asking the backend on every request: the backend signs a short-lived **edge token** (a JWT, HS256 with a secret shared with the Worker, 10 minutes: user, workspace, session version) set as an HttpOnly cookie. The Worker checks it locally, the way it already checks Cloudflare Access tokens (`apps/worker/src/access.ts`). When it is missing or expired but the session cookie is there, the Worker asks the backend for a new one (an internal route, protected by a second shared secret), uses it, and sets it on its answer. Media requests the browser makes on its own (`<video src>` with ranges) are covered the same way.

## Behaviour

**Signed out.** The app at its public address behaves exactly as the personal mode does today (service worker, IndexedDB, key vault), plus a "Sign in" entry on the home page.

**Sign up.** Email, password (12 characters at least), name. The account is usable at once; a verification email is sent, and a quiet banner asks to verify (the gallery and payment, later, will require it). A personal workspace is created with the user.

**Sign in.** Email and password, or Google, or GitHub. An OAuth sign-in:
- finds the account already linked to that provider identity, or
- links itself to the account with the same email **only when the provider says the email is verified**, or
- creates a new account (email verified when the provider says so).
Five failed password attempts per email and IP in a minute slow the next ones down.

**The editor signed in** behaves like the private mode: projects, files, libraries, conversations and keys on the server. The home shows the account menu (name, settings, sign out).

**Local projects.** On the first sign-in from a browser that holds personal-mode projects, the user is offered to bring them into the account, all or some; each goes through the `.tramme` archive (exported from IndexedDB, imported into the account), so nothing new is invented. The local copies stay until the user deletes them. The offer stays reachable from the account menu.

**Two devices.** Every write of the document already carries the version it was read at (`If-Match`). When another device wrote in between, today the editor only shows an error and stops saving. Now it asks: keep this device's version (written over the other) or take the other one (reload, this device's unsaved change dropped after confirmation).

**A session that ends mid-work** (signed out elsewhere, expired): saves stop with a "signed out" state, the changes stay in the page, and a sign-in dialog brings the session back; saving then resumes.

**Account settings.** Name; password (set one when the account came from OAuth); the sign-in methods linked; sign out everywhere (every other session and edge token stops within 10 minutes); export (each project as a `.tramme`, plus a JSON of the account); delete the account (password or typed email to confirm; the data in Postgres goes at once, the files in R2 are purged in the background).

**Keys.** The settings' providers section works as in the private mode; the keys are written to `w/<ws>/config/keys.json`, encrypted (AES-GCM, key from a Worker secret), and read back by the provider routes for that user only. No Worker-wide provider secret is used in the cloud mode: a user without keys has no assistant until credits exist (project 3).

## Constraints

- Node 24, the repository's version. AdonisJS 7 (`@adonisjs/core` 7.x at the time of writing), its own test runner (Japa) for the backend; Vitest stays for everything else.
- Workers Paid plan (Containers, Email Sending).
- Every interface string in English and French; colours from theme tokens only; no decorative patterns.
- Cookies: `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Lax`. State-changing account routes check the `Origin` header.
- Personal data in the EU (Postgres region, R2 jurisdiction); account deletion removes everything.
- Commits without `Co-Authored-By` and without mention of Claude.

## Left to the builder

The look of the sign-in dialog and account menu (within the theme and the existing components), the copy of the emails, the Postgres connection pool size, the exact Adonis file layout where the framework's conventions decide.

## Theirs, still open

- The public address of the cloud mode at launch (it replaces the personal deployment at `app.tramme.dev`, or starts on another address first).
- The sender address of the emails.
