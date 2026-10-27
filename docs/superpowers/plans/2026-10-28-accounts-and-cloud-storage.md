# Accounts and cloud storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users sign up and sign in (email and password, Google, GitHub) and find their projects, libraries, conversations and provider keys in their account on any browser, with the personal mode kept for visitors who are not signed in.

**Architecture:** An AdonisJS 7 backend (`apps/server`) owns identities in Postgres and runs as a Cloudflare Container behind the Worker. The Worker gains a `cloud` mode. It checks a short-lived edge token (a JWT the backend signs) on every request. It serves projects, libraries and provider routes itself, through the existing `@tramme/api` routes over a bucket prefixed by the user's workspace (`w/<workspaceId>/`). It forwards the account routes to the backend. The editor reads the mode from its page, as it does for the personal mode, and gains a sign-in dialog, an account menu, an account settings section, an import of local projects, and a conflict dialog.

**Tech Stack:** AdonisJS 7 (`@adonisjs/core` 7.x, `auth` 10.x, `session` 8.x, `ally` 6.x, `lucid` 22.x with Postgres, `mail` 10.x, `limiter`, `@vinejs/vine` 4.x, Japa 5.x), Cloudflare Workers + Containers (`@cloudflare/containers` 0.3.x) + R2, Postgres (Neon, EU), Cloudflare Email Service (SMTP), Preact + signals, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-28-accounts-and-cloud-storage-design.md](../specs/2026-10-28-accounts-and-cloud-storage-design.md). Read it first. Its non-goals bind every task: no desktop sign-in, no credits, no gallery, no teams UI.

## Global Constraints

- Node 24. AdonisJS **7**: follow the official v7 docs for every framework API (`npm create adonisjs@latest`, API starter kit). The versions above were current on 2026-10-28. Do not use v6 snippets from memory.
- Backend tests use Japa (`apps/server/tests`), run by `npm test -w apps/server` against a real Postgres. Everything else uses Vitest (`npm test` at the root). `apps/server` is excluded from the root `tsconfig.json` and from `vitest.config.ts`, and has its own `typecheck` script.
- Cookies:
  - session: `__Host-tramme-session`;
  - edge token: `__Host-tramme-edge`.
  - Both `Path=/; Secure; HttpOnly; SameSite=Lax`.
- Edge token:
  - JWT HS256 signed with `EDGE_SECRET`;
  - payload `{ sub: userId, ws: workspaceId, sv: sessionVersion, iat, exp }`;
  - lifetime **600 s**.
- The internal routes of the backend (`/internal/*`) require the header `x-tramme-internal: <INTERNAL_SECRET>`. The Worker never forwards a public request to `/internal/*`.
- Workspace ids are **12 characters** from `[a-z0-9]` (random). R2 keys of a workspace start with `w/<workspaceId>/`.
- Passwords: at least **12** characters, at most 256. Login throttling: **5** failures per (email, IP) per **60 s**, then 429 with `retry-after`.
- Email tokens:
  - verification valid **48 h**, reset valid **1 h**;
  - stored hashed (SHA-256), single use.
- State-changing account routes refuse a request whose `Origin` is not the app's origin (`APP_ORIGIN`), with 403.
- Every interface string in English and French (`apps/editor/src/i18n/en.json`, `fr.json`); colours from theme tokens; reuse the existing components (`Modal`, `btn`, `icon-btn`, `field`) and patterns.
- Branch `feat/accounts` from `develop`. Conventional Commits. No `Co-Authored-By`, no mention of Claude. Do not push.
- Gates: each task's tests pass before its commit. The last task runs `npm run typecheck`, `npm test`, `npm run typecheck -w apps/server` and `npm test -w apps/server`.
- Browser checks only on the trial server (port 8790), never on 8787.

## Review Focus

1. **A session that ends mid-edit.** Saves answered 401 keep the document in the page, show a "signed out" state and open the sign-in dialog. After signing in, the pending save goes through. Test in Task 18.
2. **Account takeover by OAuth.** A Google or GitHub sign-in whose email the provider does not mark as verified never links to an existing account with that email: it fails with `email_taken`. Test in Task 5.
3. **Two devices, one project.** Device B saves after device A, so B's write gets 412. "Keep mine" writes without `If-Match`. "Take theirs" reloads after confirming. Neither happens silently. Test in Task 18.
4. **Edge token expiring during a long upload or a video stream.** Every request whose edge token expired but whose session is valid gets a fresh token from the Worker transparently, multipart parts and ranged GETs included. Test in Task 10.
5. **Deleting an account with many files.** The R2 purge lists and deletes page by page, in batches of 1000. It is idempotent: a second run on a half-purged prefix finishes the job. Test in Task 12.

---

## Phase A: the backend

### Task 1: Scaffold `apps/server`

**Files:**
- Create: `apps/server/` (AdonisJS 7 API starter kit), `apps/server/Dockerfile`, `apps/server/docker-entrypoint.sh`, `apps/server/.env.example`, `docker-compose.dev.yml` (repository root)
- Modify: root `package.json` (scripts), `tsconfig.json` (`exclude`), `vitest.config.ts` (`exclude`), `.gitignore`
- Test: `apps/server/tests/functional/health.spec.ts`

**Interfaces:**
- Produces:
  - `GET /api/health` answers `200 { ok: true }`;
  - root scripts `server:dev` (`node ace serve --hmr` in `apps/server`), `server:test`, `dev:cloud` (Task 13);
  - the package name `@tramme/server`.

- [ ] **Step 1:** Create the app with `npm create adonisjs@latest apps/server -- --kit=api --db=postgres --auth-guard=session`, choosing the options the v7 installer offers that match. Then add `@adonisjs/ally`, `@adonisjs/mail` and `@adonisjs/limiter` with `node ace add <pkg>`. Set `"name": "@tramme/server"` and `"private": true`.
- [ ] **Step 2:** Configure the app:
  - All HTTP routes live under the `/api` prefix (and `/internal`). There are no views.
  - The session cookie is named `__Host-tramme-session`, with the cookie store. The edge cookie comes in Task 6.
  - `.env.example` lists every variable:
    - `PORT=3333`, `HOST=0.0.0.0`, `APP_KEY`, `APP_ORIGIN`;
    - `DATABASE_URL`;
    - `EDGE_SECRET`, `INTERNAL_SECRET`;
    - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`;
    - `SMTP_HOST=smtp.mx.cloudflare.net`, `SMTP_PORT=465`, `SMTP_USERNAME=api_token`, `SMTP_PASSWORD`;
    - `MAIL_FROM`.
  - Validate them in `start/env.ts`.
- [ ] **Step 3:** `docker-compose.dev.yml` runs `postgres:17` on 5432 with databases `tramme` and `tramme_test`.
- [ ] **Step 4: Write the failing test** `health answers ok`: `GET /api/health` gives 200 `{ ok: true }`.
- [ ] **Step 5: Run** `docker compose -f docker-compose.dev.yml up -d`, then `npm test -w apps/server`. Expected: FAIL (no route).
- [ ] **Step 6:** Add the route. Then:
  - `Dockerfile`: multi-stage `node:24-slim`, `node ace build`, `npm ci --omit=dev` in `build/`, `EXPOSE 3333`;
  - `docker-entrypoint.sh`: `node ace migration:run --force && exec node bin/server.js`.
- [ ] **Step 7:** Exclude `apps/server` in `tsconfig.json` and `vitest.config.ts`. Add `apps/server/build`, `apps/server/.env` and `apps/server/tmp` to `.gitignore`.
- [ ] **Step 8: Run** `npm test -w apps/server`, `npm run typecheck -w apps/server` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 9: Commit** `feat(server): scaffold the AdonisJS backend`.

### Task 2: The schema

**Files:**
- Create: migrations and models in `apps/server/database/migrations/`, `apps/server/app/models/`
- Test: `apps/server/tests/unit/models.spec.ts`

**Interfaces:**
- Produces these tables (Lucid models of the same names, singular):
  - `users`:
    - `id uuid pk`, `email citext unique not null`, `password text null`, `name text not null`;
    - `email_verified_at timestamptz null`, `locale text not null default 'en'`, `session_version int not null default 1`;
    - `created_at`, `updated_at`.
  - `oauth_identities`: `id uuid pk`, `user_id uuid fk users on delete cascade`, `provider text check in ('google','github')`, `provider_user_id text`, `email text`, `created_at`, `unique(provider, provider_user_id)`.
  - `workspaces`: `id char(12) pk`, `name text`, `kind text check in ('personal','team') default 'personal'`, `owner_id uuid fk users on delete cascade`, `created_at`.
  - `workspace_members`: `workspace_id char(12) fk on delete cascade`, `user_id uuid fk on delete cascade`, `role text check in ('owner','member')`, `pk(workspace_id, user_id)`.
  - `email_tokens`: `id uuid pk`, `user_id uuid fk on delete cascade`, `purpose text check in ('verify','reset')`, `token_hash char(64) unique`, `expires_at timestamptz`, `used_at timestamptz null`, `created_at`.
- `User.personalWorkspace(): Promise<Workspace>`. `newWorkspaceId(): string` in `app/services/ids.ts` (12 characters from `[a-z0-9]`, `crypto.randomInt`).
- `User` uses the framework's password hashing (scrypt, the default) via the auth mixin, with `email` as the uid.

- [ ] **Step 1: Write the failing tests.**
  - `a user's email is unique whatever its case`: inserting `A@x.io` then `a@x.io` throws.
  - `deleting a user deletes their workspace, identities and tokens`.
  - `newWorkspaceId is 12 lowercase letters or digits`: 1000 draws, each matching `/^[a-z0-9]{12}$/`, all distinct.
- [ ] **Step 2: Run** `npm test -w apps/server`. Expected: FAIL.
- [ ] **Step 3:** Write the migrations (enable `citext`) and the models.
- [ ] **Step 4: Run** `npm test -w apps/server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): users, sign-in identities, workspaces and email tokens`.

### Task 3: Sign up, sign in, sign out, me

**Files:**
- Create: `apps/server/app/controllers/auth_controller.ts`, `apps/server/app/validators/auth.ts`, `apps/server/app/middleware/origin_middleware.ts`, `apps/server/app/middleware/session_version_middleware.ts`, `apps/server/app/services/accounts.ts`, `apps/server/app/transformers/user.ts` (or a plain `toJson`)
- Modify: `apps/server/start/routes.ts`, `apps/server/start/kernel.ts`, `apps/server/start/limiter.ts`
- Test: `apps/server/tests/functional/auth.spec.ts`

**Interfaces:**
- Produces:
  - `type UserJson = { id: string; email: string; name: string; emailVerified: boolean; hasPassword: boolean; providers: ('google' | 'github')[]; locale: string; workspace: { id: string; name: string } }`;
  - `accounts.create({ email, name, password?, emailVerified? }): Promise<User>`, which creates the user, their personal workspace (named after them) and the owner membership in one transaction.
- Routes:
  - `POST /api/auth/signup { email, password, name }` gives `201 { user: UserJson }` and signs in. A taken email gives `422 { error: 'email_taken' }`.
  - `POST /api/auth/login { email, password }` gives `200 { user }`. A wrong pair gives `401 { error: 'invalid_credentials' }`. Throttled, it gives `429`.
  - `POST /api/auth/logout` gives `204`.
  - `GET /api/auth/me` gives `200 { user }`, or `401 { error: 'signed_out' }`.
- The session stores `sv`, the user's `session_version` at sign-in. `session_version_middleware` signs out (401 `signed_out`) a session whose `sv` differs from the database.
- `origin_middleware` is applied to every non-GET route under `/api/auth` and `/api/account`. It gives 403 `{ error: 'origin' }` when `Origin` is not `APP_ORIGIN`.

- [ ] **Step 1: Write the failing tests.**
  - `signs up, then me answers the user with a personal workspace`.
  - `refuses a password under 12 characters` (422).
  - `refuses a taken email, whatever its case` (422 `email_taken`).
  - `logs in and out`.
  - `a wrong password is refused the same way as an unknown email` (both 401 `invalid_credentials`).
  - `slows down after 5 failures`: the 6th within 60 s gives 429 with `retry-after`.
  - `refuses a foreign Origin` (403).
  - `a bumped session version signs the session out`: update `session_version` in the database, and `me` gives 401.
- [ ] **Step 2: Run** `npm test -w apps/server`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w apps/server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): sign up, sign in and out with email and password`.

### Task 4: Email verification and password reset

**Files:**
- Create: `apps/server/app/services/email_tokens.ts`, `apps/server/app/mails/verify_email.ts`, `apps/server/app/mails/reset_password.ts`
- Modify: `auth_controller.ts`, `routes.ts`, `config/mail.ts` (SMTP transport from the env of Task 1)
- Test: `apps/server/tests/functional/email_tokens.spec.ts`

**Interfaces:**
- `emailTokens.issue(user: User, purpose: 'verify' | 'reset'): Promise<string>` returns the raw token, 32 random bytes in base64url. Only its SHA-256 is stored. Issuing invalidates the user's earlier unused tokens of the same purpose.
- `emailTokens.consume(raw: string, purpose): Promise<User | null>` returns null when the token is unknown, used, expired or of another purpose.
- Links in the emails:
  - `${APP_ORIGIN}/?verify=<token>`;
  - `${APP_ORIGIN}/?reset=<token>`.
- Routes:
  - `POST /api/auth/verify { token }` gives `204`, or `400 { error: 'token' }`.
  - `POST /api/auth/verify/resend` (signed in) gives `204`, throttled to 3 per hour.
  - `POST /api/auth/password/forgot { email }` always gives `204` (no account enumeration), throttled to 3 per hour per email.
  - `POST /api/auth/password/reset { token, password }` gives `204`. It also bumps `session_version` (every other session ends) and marks the email verified.
- Signup (Task 3) now sends the verification email.

- [ ] **Step 1: Write the failing tests** (mail faked with the framework's mail fake).
  - `signup sends a verification link that verifies once`: the link's token verifies (204), and a second use gives 400.
  - `an expired token is refused`: travel 49 h.
  - `forgot answers 204 for an unknown email and sends nothing`.
  - `reset sets the password, ends the other sessions, and the token cannot be reused`.
  - `a reset token cannot verify` (purpose mismatch).
- [ ] **Step 2: Run** `npm test -w apps/server`. Expected: FAIL.
- [ ] **Step 3: Implement.** Emails go out in the user's `locale` (en, fr). The text is plain and short.
- [ ] **Step 4: Run** `npm test -w apps/server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): verify emails and reset passwords`.

### Task 5: Google and GitHub

**Files:**
- Create: `apps/server/app/controllers/oauth_controller.ts`, `apps/server/app/services/oauth_link.ts`
- Modify: `config/ally.ts`, `routes.ts`
- Test: `apps/server/tests/unit/oauth_link.spec.ts`, `apps/server/tests/functional/oauth.spec.ts`

**Interfaces:**
- `type ProviderProfile = { provider: 'google' | 'github'; id: string; email: string | null; emailVerified: boolean; name: string }`.
- `oauthLink.resolve(profile: ProviderProfile, signedIn: User | null): Promise<{ user: User } | { error: 'email_taken' | 'no_email' | 'identity_taken' }>`. The rules, in order:
  1. A signed-in user links the identity to themselves, unless it belongs to someone else (`identity_taken`).
  2. An identity already linked signs in its user.
  3. With no email: `no_email`.
  4. An account with that email and `emailVerified` true: link and sign in.
  5. An account with that email and `emailVerified` false: `email_taken`.
  6. Otherwise, create an account through `accounts.create`, `emailVerified` from the profile.
- Routes:
  - `GET /api/auth/:provider/redirect` gives 302 to the provider.
  - `GET /api/auth/:provider/callback` signs in, then 302 to `/`. On error it gives 302 to `/?auth_error=<code>`. A cancelled consent gives `auth_error=cancelled`.
  - The callback URLs registered with the providers are `${APP_ORIGIN}/api/auth/google/callback` and `${APP_ORIGIN}/api/auth/github/callback`.
- The GitHub email is the primary verified address from `/user/emails`, with the `user:email` scope. `emailVerified` comes from that list. For Google, it is the `email_verified` claim.

- [ ] **Step 1: Write the failing unit tests** for `resolve`, one per rule above, including Review Focus 2: `an unverified provider email never links to an existing account`.
- [ ] **Step 2: Write the failing functional test** `the callback signs in and redirects home`, with the Ally driver stubbed to return a profile.
- [ ] **Step 3: Run** `npm test -w apps/server`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `npm test -w apps/server`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(server): sign in with Google and GitHub`.

### Task 6: The edge token

**Files:**
- Create: `apps/server/app/services/edge_token.ts`, `apps/server/app/middleware/internal_middleware.ts`, `apps/server/app/controllers/internal_controller.ts`
- Modify: `routes.ts`, `auth_controller.ts`, `oauth_controller.ts`
- Test: `apps/server/tests/unit/edge_token.spec.ts`, `apps/server/tests/functional/internal.spec.ts`

**Interfaces:**
- `edgeToken.sign(user: User, workspaceId: string, now?: number): { token: string; expiresAt: number }`. It is an HS256 JWT built with `node:crypto` (`createHmac`), with the payload of the Global Constraints.
- `edgeToken.cookie(token): string`, the `Set-Cookie` value: `__Host-tramme-edge=<token>; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`.
- Every successful sign-in (password, OAuth, reset) and `GET /api/auth/me` also set the edge cookie. Sign-out clears both cookies (`Max-Age=0`).
- `POST /internal/edge`, with the internal header and the browser's `Cookie` forwarded, answers `200 { token, expiresAt, userId, workspaceId }` for a live session, else `401`. Without the internal header: `404` (the route does not exist for the public).

- [ ] **Step 1: Write the failing tests.**
  - `the token is a valid HS256 JWT`: split it, recompute the HMAC with `EDGE_SECRET`, and expect the payload to be `{ sub, ws, sv, iat, exp }` with `exp - iat === 600`.
  - `login sets both cookies`.
  - `internal/edge answers a fresh token for a live session`.
  - `internal/edge refuses a stale session version` (401).
  - `internal/edge is a 404 without the secret`.
- [ ] **Step 2: Run** `npm test -w apps/server`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w apps/server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): sign edge tokens for the Worker`.

### Task 7: Account settings

**Files:**
- Create: `apps/server/app/controllers/account_controller.ts`, `apps/server/app/validators/account.ts`
- Modify: `routes.ts`, `internal_controller.ts`
- Test: `apps/server/tests/functional/account.spec.ts`

**Interfaces:**
- Routes (all signed in):
  - `PATCH /api/account { name?, locale? }` gives `200 { user }`.
  - `PUT /api/account/password { current?, next }` gives `204`. `current` is required when the user has a password. Setting one for an OAuth-only account needs no `current`. It bumps `session_version` and re-signs this session (its `sv` updated, a new edge cookie), so only the other sessions end.
  - `POST /api/account/sessions/revoke` gives `204`: same bump and re-sign, without changing the password.
  - `DELETE /api/account/identities/:provider` gives `204`. It refuses (`409 { error: 'last_method' }`) when it is the only way left to sign in.
  - `POST /internal/account/delete { userId, password?, email? }`, internal only, gives `200 { workspaces: string[] }` after deleting the user (cascade). It gives `403 { error: 'confirm' }` when neither the password matches nor `email` equals the user's.
  - `GET /api/account/export` gives `200` with a JSON of the account: user, identities (without tokens) and workspaces. The projects are exported by the editor (Task 17).

- [ ] **Step 1: Write the failing tests**, one per route and refusal above, plus `revoking keeps this session and ends another`, with two signed-in clients.
- [ ] **Step 2: Run** `npm test -w apps/server`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w apps/server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): account settings, sign out everywhere, delete`.

---

## Phase B: the Worker

### Task 8: A bucket under a prefix

**Files:**
- Create: `packages/api/src/prefixed.ts`
- Modify: `packages/api/src/index.ts` (export)
- Test: `packages/api/test/prefixed.test.ts`

**Interfaces:**
- `export function prefixedBucket(bucket: Bucket, prefix: string): Bucket`. `prefix` must end with `/`, otherwise it throws.
- Every key passed in gets the prefix. Every key coming back (objects, `delimitedPrefixes`) has it removed. `list({ prefix })` lists under `prefix + options.prefix`. Multipart upload ids pass through unchanged.

- [ ] **Step 1: Write the failing tests.**
  - Run the shared suite: `storageContract('prefixed', () => prefixedBucket(memoryBucket(), 'w/abc123def456/'))`. Use the in-memory bucket the other contract runs use; see `packages/api/test/storage.test.ts`.
  - `two prefixes never see each other`: write the same project id under two prefixes. Each lists only its own, and a read under one never returns the other's bytes.
  - `refuses a prefix without a trailing slash`.
- [ ] **Step 2: Run** `npx vitest run packages/api/test/prefixed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): a bucket kept under a prefix`.

### Task 9: Checking the edge token in the Worker

**Files:**
- Create: `packages/api/src/edge.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/test/edge.test.ts`

**Interfaces:**
- `export interface Edge { userId: string; workspaceId: string; sessionVersion: number; exp: number }`.
- `export async function verifyEdge(token: string, secret: string, now = Date.now()): Promise<Edge | null>`. It uses Web Crypto: HMAC SHA-256 and a constant-time comparison via `crypto.subtle.verify`. It returns null for a bad signature, an `alg` other than `HS256`, an expired `exp`, a malformed token, or a missing `ws`.
- `export async function signEdge(edge: Omit<Edge, 'exp'>, secret: string, now = Date.now()): Promise<string>`, used by tests and by the dev tooling only. It must produce the same tokens as the backend's `edgeToken.sign`.

- [ ] **Step 1: Write the failing tests.**
  - The round trip.
  - Each null case.
  - `accepts a token signed by the backend`: a fixture token generated once by `apps/server`'s `edgeToken.sign` with secret `test-secret` and a fixed `now`, verified here with the same `now`.
- [ ] **Step 2: Run** `npx vitest run packages/api/test/edge.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): verify the backend's edge tokens`.

### Task 10: The Worker's cloud mode

**Files:**
- Create: `apps/worker/src/cloud.ts`, `apps/worker/src/container.ts`, `apps/worker/test/cloud.test.ts`
- Modify: `apps/worker/src/index.ts` (dispatch `MODE === 'cloud'`), `apps/worker/src/http.ts` (`Env`), `apps/worker/src/personal.ts` (export what the cloud mode reuses for signed-out visitors)

**Interfaces:**
- `Env` gains:
  - `EDGE_SECRET`, `INTERNAL_SECRET`, `KEYS_SECRET` (Task 11);
  - `API: DurableObjectNamespace` (the container);
  - `API_ORIGIN?: string`, a development override: the backend at that address instead of the container.
- `apps/worker/src/container.ts`:
  - `export class Api extends Container`, with `defaultPort = 3333` and `sleepAfter = '24h'`. Its `envVars` are filled from the Worker's secrets and vars listed in Task 1.
  - `export function backend(env: Env): (req: Request) => Promise<Response>`, which fetches `API_ORIGIN` when set, else `getContainer(env.API, 'main')`.
- `apps/worker/src/cloud.ts`:
  - `export interface CloudDeps { files: Bucket; backend: (req: Request) => Promise<Response>; secret: string; internal: string; assets: Fetcher; personal: (req: Request) => Promise<Response> }`;
  - `export async function cloud(req: Request, deps: CloudDeps, ctx?: ExecutionContext): Promise<Response>`, with this routing, in order:
    0. A request to `VAULT_ORIGIN`'s host goes to `deps.personal` unchanged (the key vault of signed-out visitors).
    1. `/internal/*` gives 404.
    2. `/api/auth/*` and `/api/account/*` (except `DELETE /api/account`, Task 12) are forwarded to `backend` with method, headers (cookies included), body and `x-forwarded-for`. The answer comes back as is, `Set-Cookie` included.
    3. The edge is resolved: `__Host-tramme-edge` is verified with `verifyEdge`. If it is missing or invalid and `__Host-tramme-session` is present, the Worker calls `backend(POST /internal/edge)` with the internal header and the `Cookie`. A 200 gives the edge, and its token is set as a cookie on the final answer. Anything else gives no edge.
    4. `/api/config`: the private mode's config, plus `mode: 'cloud'` and `signedIn: boolean`.
    5. Storage routes (`STORAGE`) and the provider, key and transcribe routes need an edge, else `401 { error: 'signed_out' }`. Storage is `storageRoute(req, prefixedBucket(files, 'w/<ws>/'), url)`. Providers and keys are in Task 11.
    6. Pages: with an edge, the editor's page from `assets` with `<meta name="tramme-account" content="1">` injected after `<head>`. Without one, `deps.personal(req)`: today's personal-mode answer, vault included, unchanged.

- [ ] **Step 1: Write the failing tests** (Vitest, an in-memory bucket, a fake backend recording requests, `signEdge` for tokens).
  - `forwards the account routes with their cookies, and passes Set-Cookie back`.
  - `never forwards /internal`.
  - `a valid edge token serves the user's projects, under their prefix only`: user A creates a project, and user B's list is empty.
  - `no session gives 401 on storage`.
  - `an expired edge with a live session is refreshed`: the fake `/internal/edge` returns a new token, the answer is 200 and carries `Set-Cookie: __Host-tramme-edge=...`. It also works for a multipart part `PUT` and a ranged `GET` (Review Focus 4).
  - `a refused refresh gives 401` (a stale session).
  - `pages: signed in, the account meta; signed out, the personal page`.
  - `the vault's address is answered by the personal mode`.
  - `config says cloud, signed in or not`.
- [ ] **Step 2: Run** `npx vitest run apps/worker/test/cloud.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `index.ts` builds `CloudDeps` from `env`, with `files` from `env.FILES`.
- [ ] **Step 4: Run** the test, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): the cloud mode, accounts in front of the projects`.

### Task 11: Keys kept in the account

**Files:**
- Create: `packages/api/src/sealed.ts`
- Modify: `packages/api/src/index.ts`, `apps/worker/src/cloud.ts`
- Test: `packages/api/test/sealed.test.ts`, `apps/worker/test/cloud.test.ts`

**Interfaces:**
- `export function sealedKeyStore(store: KeyStore, secret: string, context: string): KeyStore`.
  - It encrypts with AES-GCM 256: the key is derived by HKDF-SHA-256 from `secret` with `info = context`, the workspace id.
  - It saves `{ v: 1, iv, data }`, both base64.
  - `load` of a missing object gives empty keys. `load` of a plaintext legacy object, or of one sealed for another context, throws `HttpError(500, 'keys cannot be read')`.
- In the cloud mode, with an edge:
  - `/api/keys/*` uses `keysRoute(req, sealedKeyStore(bucketKeyStore(prefixed), env.KEYS_SECRET, ws), parts)`.
  - The provider routes use `loadKeys(thatStore)` with **no** Worker secrets.
  - `/api/transcribe` uses the user's OpenAI key route only. The Workers AI binding is not offered in the cloud mode: it is the operator's cost, which belongs to project 3.

- [ ] **Step 1: Write the failing tests.**
  - `round trip`.
  - `the stored object holds no key in clear`: the saved JSON does not contain the key string.
  - `another workspace's context cannot read it`.
  - In `cloud.test.ts`: `a user's keys reach only their provider calls`: user A saves an Anthropic key, and user B's `/api/config` shows none.
- [ ] **Step 2: Run** `npx vitest run packages/api/test/sealed.test.ts apps/worker/test/cloud.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): provider keys kept sealed in the account`.

### Task 12: Deleting an account

**Files:**
- Create: `packages/api/src/purge.ts`
- Modify: `apps/worker/src/cloud.ts`, `packages/api/src/index.ts`
- Test: `packages/api/test/purge.test.ts`, `apps/worker/test/cloud.test.ts`

**Interfaces:**
- `export async function purgePrefix(bucket: Bucket, prefix: string): Promise<number>`. It lists page by page and deletes in batches of at most 1000 keys, then returns the count. It is safe to run again.
- `DELETE /api/account { password?, email? }` in `cloud.ts`, with an edge:
  1. It calls `backend(POST /internal/account/delete { userId, password, email })`.
  2. On 200, for each returned workspace, it runs `ctx.waitUntil(purgePrefix(files, 'w/<ws>/'))`.
  3. It answers `204`, clearing both cookies. A 403 from the backend comes back as is.

- [ ] **Step 1: Write the failing tests.**
  - `purges 2500 objects in three batches and leaves other prefixes`.
  - `a second run finishes a half-purged prefix` (Review Focus 5).
  - In `cloud.test.ts`: `deleting the account purges its files and clears the cookies`, and `a wrong confirmation keeps everything`.
- [ ] **Step 2: Run** `npx vitest run packages/api/test/purge.test.ts apps/worker/test/cloud.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): delete an account and purge its files`.

### Task 13: Deployment and local development

**Files:**
- Modify: `apps/worker/wrangler.jsonc` (new `env.cloud`), root `package.json` (`dev:cloud`, `deploy:cloud`), `docs/deploy.md`
- Create: `docs/accounts.md` (architecture, edge token, secrets, how to run locally)

**Interfaces:**
- `env.cloud` in `wrangler.jsonc`:
  - `name: "tramme-cloud"`;
  - `vars`: `MODE: "cloud"`, `APP_ORIGIN`, `VAULT_ORIGIN`. The addresses are placeholders, with a comment that they are the user's to choose (spec, "Theirs, still open");
  - `r2_buckets`: `FILES` on `tramme-cloud`, created with `--jurisdiction eu`;
  - `containers`: `class_name: "Api"`, `image: "../server/Dockerfile"`, `max_instances: 1`;
  - `durable_objects.bindings`: `API` to `Api`;
  - `migrations`: `new_sqlite_classes: ["Api"]`;
  - the relay rate limit and observability of the personal env;
  - the comment lists the secrets: `EDGE_SECRET`, `INTERNAL_SECRET`, `KEYS_SECRET`, `APP_KEY`, `DATABASE_URL`, `GOOGLE_*`, `GITHUB_*`, `SMTP_PASSWORD`, `MAIL_FROM`.
- `npm run dev:cloud` starts Postgres (compose), `npm run server:dev`, the editor build in watch mode, and `wrangler dev --env cloud --var API_ORIGIN:http://localhost:3333 --port 8787`. Document that agents use `--port 8790` with `--persist-to .wrangler/state-trial`.

- [ ] **Step 1:** Write the config and scripts.
- [ ] **Step 2: Run** `npx wrangler deploy --dry-run --env cloud -c apps/worker/wrangler.jsonc`. Expected: the bundle builds and the container image is listed. If Docker is not running, the dry run may not build the image: say so in the report.
- [ ] **Step 3:** Write `docs/accounts.md` and the cloud section of `docs/deploy.md`: secrets, Google and GitHub callback URLs, Email Service domain onboarding, `wrangler r2 bucket create tramme-cloud --jurisdiction eu`.
- [ ] **Step 4: Commit** `chore(cloud): deployment and local development of the cloud mode`.

---

## Phase C: the editor

### Task 14: The account in the editor

**Files:**
- Create: `apps/editor/src/account.ts`
- Modify: `apps/editor/src/mode.ts` (`cloud` from the meta), `apps/editor/src/api.ts` (`ServerConfig.mode` gains `'cloud'`, `signedIn?: boolean`)
- Test: `apps/editor/test/account.test.ts`

**Interfaces:**
- In `mode.ts`: `export const cloud: boolean`, true when `<meta name="tramme-account">` is present. `boot()` behaves as in the private mode when `cloud` is true (it leaves the local store).
- In `account.ts`:
  - `export type Account = UserJson` (the shape of Task 3, declared here);
  - `export const account: Signal<Account | null>`;
  - `export const signedOut: Signal<boolean>`, set when a storage call answered 401 `signed_out` in the cloud mode;
  - `loadAccount(): Promise<Account | null>`;
  - `signUp(email, password, name)`, `signIn(email, password)`, `signOut()`;
  - `oauthUrl(provider: 'google' | 'github'): string`;
  - `requestReset(email)`, `resetPassword(token, password)`, `verifyEmail(token)`, `resendVerification()`;
  - `updateAccount(patch)`, `changePassword(current, next)`, `revokeSessions()`, `unlink(provider)`;
  - `deleteAccount(confirm: { password?: string; email?: string })`;
  - `exportAccount(): Promise<Blob>`.
  - Each throws `ApiError` with the server's `error` code.
- `api.ts`'s `answered()` sets `signedOut.value = true` on a 401 whose body is `signed_out`.

- [ ] **Step 1: Write the failing tests**, with `fetch` stubbed.
  - Each function calls its route with the right method and body.
  - A 401 `signed_out` from `api.write` sets `signedOut`.
  - `cloud` is read from the meta.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/account.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): the account in the editor`.

### Task 15: Signing in

**Files:**
- Create: `apps/editor/src/ui/AccountDialog.tsx`
- Modify: `apps/editor/src/main.tsx` (the `?verify=`, `?reset=` and `?auth_error=` query parameters on `/`), `apps/editor/src/ui/Home.tsx` (a "Sign in" button when signed out, in the cloud deployment only), `apps/editor/src/i18n/en.json`, `fr.json`, `apps/editor/src/screens/home.css`
- Test: `apps/editor/test/account-dialog.test.ts`

**Interfaces:**
- `export function AccountDialog(props: { view: 'signin' | 'signup' | 'forgot' | 'reset'; token?: string; onClose: () => void }): JSX.Element`.
  - Fields and buttons: email, password, name on signup, "Continue with Google" and "Continue with GitHub" (links to `oauthUrl`), "Forgot password", and switching between sign in and sign up.
  - Server error codes become messages in both locales: `invalid_credentials`, `email_taken`, `token`, 429 with the wait, `no_email`, `identity_taken`, `cancelled`.
  - After a sign-in, the page reloads, so the Worker serves the account page.
- How does a signed-out visitor see "Sign in" when the deployment is cloud? `/api/config` answers `mode: 'cloud'`, `signedIn: false` on the personal page: the Worker adds it in Task 10. If not, add it there.
- `?verify=<t>` calls `verifyEmail`, toasts, and removes the parameter. `?reset=<t>` opens the dialog on `reset`. `?auth_error=<code>` toasts the message.

- [ ] **Step 1: Write the failing tests** (happy-dom).
  - `signs in`.
  - `shows the server's error in the user's language`.
  - `the OAuth buttons point at the provider routes`.
  - `the reset view sets the password from the token`.
  - `a verify link verifies and leaves the address clean`.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/account-dialog.test.ts apps/editor/test/i18n.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): sign in, sign up, reset a password`.

### Task 16: The account menu and settings

**Files:**
- Create: `apps/editor/src/ui/AccountMenu.tsx`, `apps/editor/src/ui/settings/Account.tsx` (or a section inside `Settings.tsx`, following how its sections are written)
- Modify: `apps/editor/src/settings.ts` (`SettingsSection` gains `'account'`), `apps/editor/src/ui/Settings.tsx`, `apps/editor/src/ui/Home.tsx`, i18n files
- Test: `apps/editor/test/account-settings.test.ts`

**Interfaces:**
- `AccountMenu`, on the home top bar when signed in, shows:
  - the name and email;
  - Account settings, which opens `openSettings('account')`;
  - Bring local projects (Task 17);
  - Sign out.
- When the email is not verified, a quiet line with "Resend".
- The account section of the settings:
  - name;
  - password: change, or set when there is none;
  - the linked methods: Google and GitHub, each with link or unlink, and unlink refused with the `last_method` message;
  - sign out everywhere;
  - export: the account JSON, plus each project as a `.tramme`, downloaded one by one with the existing project export;
  - delete the account: a confirm dialog asking for the password, or the email when the account has none, then sign out and reload.

- [ ] **Step 1: Write the failing tests**, one per action above, with `account.ts` stubbed. Include `unlinking the last method shows why it is refused`.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/account-settings.test.ts apps/editor/test/i18n.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): the account menu and the account settings`.

### Task 17: Bringing local projects into the account

**Files:**
- Create: `apps/editor/src/bring.ts`, `apps/editor/src/ui/BringDialog.tsx`
- Modify: `apps/editor/src/ui/Home.tsx` (offer once after the first sign-in on this browser), i18n files
- Test: `apps/editor/test/bring.test.ts`

**Interfaces:**
- `export async function localProjects(): Promise<Manifest[]>`. It reads the personal-mode IndexedDB directly: `listProjects(recordBucket(idbRecords()))`, the same database the service worker uses (`apps/editor/src/sw.ts`). It returns `[]` when there is none.
- `export async function bring(ids: string[], progress: (done: number, total: number, name: string) => void): Promise<{ brought: Manifest[]; failed: { id: string; error: string }[] }>`.
  - For each id: `exportProject(recordBucket(idbRecords()), id)` gives the archive, then `importArchive(blob)` into the account, through the current API.
  - It never deletes the local copy, and goes on after a failure.
- The offer shows once per browser: a localStorage key `tramme.bring.offered.<userId>`, wrapped in try/catch. It lists the local projects with checkboxes, all checked.

- [ ] **Step 1: Write the failing tests**, with `fake-indexeddb` (already a dev dependency) and the import stubbed.
  - `lists the local projects`.
  - `brings the chosen ones through the archive, keeps the local copies`.
  - `a failure does not stop the others`.
  - `offered once`.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/bring.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): bring local projects into the account`.

### Task 18: Conflicts and ended sessions while saving

**Files:**
- Create: `apps/editor/src/ui/ConflictDialog.tsx`
- Modify: `apps/editor/src/state.ts:243-275` (`write` and the save effect), `apps/editor/src/ui/` (a "signed out" save state where the save state is shown), i18n files
- Test: `apps/editor/test/save-conflict.test.ts`

**Interfaces:**
- `S.save` gains the states `'conflict'` and `'signedOut'`.
- On 412 the editor no longer only toasts. It opens `ConflictDialog` with two choices:
  - **Keep mine:** `api.write` without `ifMatch`, then the new etag is kept.
  - **Take theirs:** a confirmation, then the project reloads from the server.
  - Closing the dialog leaves the state on `'conflict'`, which reopens it.
- On 401 `signed_out`, the state becomes `'signedOut'`, the document stays, and `AccountDialog` opens on `signin`. Once signed in again (without reload: here the dialog calls `signIn`, then `loadAccount`), the pending save runs.
- This applies to every mode: the private mode gets the conflict dialog too.

- [ ] **Step 1: Write the failing tests** (Review Focus 1 and 3).
  - `a 412 asks; keep mine writes without If-Match`.
  - `take theirs reloads after confirmation`.
  - `a 401 keeps the changes and saves them after signing in`.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/save-conflict.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test, then `npx vitest run apps/editor/test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): ask which version to keep, survive an ended session`.

---

## Phase D: close

### Task 19: CI for the backend

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1:** Add a `server` job:
  - Node 24, with a `postgres:17` service holding the database `tramme_test`;
  - env `DATABASE_URL`, `APP_KEY` (generated in the job), `EDGE_SECRET=test-secret`, `INTERNAL_SECRET=test-internal`, `APP_ORIGIN=http://localhost:8787`, SMTP values (unused, mail faked);
  - steps: `npm ci`, then `npm run typecheck -w apps/server`, then `npm test -w apps/server`.
- [ ] **Step 2:** Check that the YAML parses, with `npx --yes yaml-lint .github/workflows/ci.yml` or an equivalent.
- [ ] **Step 3: Commit** `ci: run the backend's tests against Postgres`.

### Task 20: Changelog and final verification

**Files:**
- Modify: `CHANGELOG.md` (`Unreleased`), `README.md` (one line on the cloud mode and a link to `docs/accounts.md`)

- [ ] **Step 1:** Add the user-visible lines:
  - accounts (email and password, Google, GitHub);
  - projects, libraries and keys in the account;
  - bringing local projects;
  - the conflict dialog;
  - account settings, export and deletion.
- [ ] **Step 2: Run** `npm run typecheck`, `npm test`, `npm run typecheck -w apps/server` and `npm test -w apps/server`. Expected: all pass. Fix before going on.
- [ ] **Step 3: Commit** `docs: changelog for accounts and cloud storage`.
- [ ] **Step 4:** Do not push. Report:
  - the commits;
  - deviations from the plan;
  - what was not verified for lack of a real deployment: OAuth against Google and GitHub, SMTP delivery, the container on Cloudflare;
  - the secrets and the external setup the user must do: Google and GitHub OAuth apps, Neon database, Email Service domain, R2 bucket in EU jurisdiction, Workers Paid.
