# Environments

Where Tramme lives, by environment. Every link from the site to the app (sign up, log in, open the editor, open a project) and from the app to the site (the terms) is written from one table, `brand/environments.ts`, never as a fixed address. Run on your machine, they stay on your machine; deployed to beta, they stay in beta.

| Environment | Website | App | When |
|---|---|---|---|
| `local` | `http://localhost:4321` | `http://localhost:8787` | `npm run site` and `npm run dev`: a dev server means local |
| `beta` | `https://beta.tramme.dev` | `https://beta.app.tramme.dev` | `TRAMME_ENV=beta` |
| `production` | `https://tramme.dev` | `https://app.tramme.dev` | a build with no `TRAMME_ENV` |

Tramme has two deployed environments, beta and production. Their addresses are in that one file.

## Choosing

- `TRAMME_ENV=<name>` when building or starting the site or the editor. An unknown name stops the build (a typo must not quietly send visitors to production).
- `TRAMME_SITE_URL` and `TRAMME_APP_URL` set one address by hand (another port, a branch deployment). `SITE_URL`, the site's older variable, still counts.
- Without any: `local` while a dev server runs, `production` for a build.

```
TRAMME_ENV=beta npm run site:build                    # the site's links lead to beta.app.tramme.dev
TRAMME_ENV=beta node apps/editor/build.ts             # the app's links lead to beta.tramme.dev
TRAMME_ENV=local TRAMME_APP_URL=http://localhost:8790 npm run site   # the app is on another port here
```

## What reads it

- The site: `apps/site/src/lib/links.ts` (`APP`, `signUp`, `logIn`, `space`, `appProject`) and `lib/site.ts` (`SITE.url`: the canonical links, the sitemap, the preview image, `llms.txt`, the structured data).
- The editor: `apps/editor/build.ts` defines `__TRAMME_SITE__`, read by `src/site.ts` (`SITE_URL`).

## What the servers read

The servers are given their address by their own settings, one per deployment:

- the accounts backend (private repository): `APP_ORIGIN` (the address of the app: it is the only origin it takes changes from, the one in the links of its mails and the one OAuth providers send people back to) and `APP_URL` (its own);
- the Worker: `APP_ORIGIN` and `VAULT_ORIGIN` (personal mode, `wrangler.jsonc`), `ACCOUNTS_URL` (the backend it hands the account routes to).

For `local`, the backend's `.env.example` (private repository) and `apps/worker/.dev.vars.example` already hold the local ones. A beta deployment sets the same names to its own addresses (a Wrangler environment for the Worker, the host's settings for the backend).

## Beta deployment

Two repositories deploy beta, on every push to `develop`. This one is public; the accounts backend and the billing live in the private `tramme-platform`, which holds this one as its `tramme` submodule.

- The site: `.github/workflows/beta.yml` here, once the checks pass (`npm run site:deploy:beta`: Worker `tramme-site-beta`, custom domain `beta.tramme.dev`, built with `TRAMME_ENV=beta`).
- The app: the same workflow then sends the event `public-develop` to `tramme-platform`, whose Beta workflow builds the editor with `TRAMME_ENV=beta`, builds the backend's image and deploys the Worker `tramme-beta` (`beta.app.tramme.dev`, and `cles.beta.app.tramme.dev` for the key vault) from `deploy/wrangler.jsonc`, with this repository's Worker as is.

Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in both repositories; `PLATFORM_DISPATCH_TOKEN` here (a fine-grained token with Contents read and write on `tramme-platform` only). The backend's own secrets are given once, in Cloudflare: `npx wrangler secret put <NAME> --env beta -c deploy/wrangler.jsonc` from the platform repository, for `APP_KEY`, `DATABASE_URL` (its own database), `EDGE_SECRET`, `INTERNAL_SECRET`, `SMTP_PASSWORD` (and the OAuth ones when they exist).

## Which backend each build talks to

- **The web app** (`app.tramme.dev`, `beta.app.tramme.dev`) calls `/api/...` at the address that serves it, so it talks to the Worker of its own deployment, and that Worker to its own backend (a binding, with no address). A beta page cannot reach the production backend, and the other way round.
- **The desktop app** is on its own protocol, with no Worker and no browser cookies, so its account calls (`/api/auth`, `/api/account`, `/api/billing`) are answered by its Rust side (`apps/desktop/src-tauri/src/account.rs`), which sends them to the backend of the environment the app was **built** for: `build.rs` reads that environment's app address from `brand/environments.ts` (`TRAMME_ENV`; with none, `local` for `tauri dev` and `production` for a release build) and fixes it in the binary. The beta app signs in at `beta.app.tramme.dev`, the stable one at `app.tramme.dev`; nothing the page says or the user sets changes it, and an unknown environment name stops the build. The backend's session cookie is kept in the system keychain, one session per backend, and never handed to the page. The request carries the backend's own address as its `Origin` (the backend only takes a change from its app) and none of the page's credentials. Not offered in the app yet: the sign-in with Google or GitHub, which needs the system browser and a way back into the app; the buttons stay off there.

## Beta desktop app

`.github/workflows/desktop-beta.yml`, run on `develop` when the app's version changes (`tauri.conf.json`), and by hand from the Actions tab: the checks, then Windows and Linux builds with `TRAMME_ENV=beta`, published as the prerelease `vX.Y.Z-beta.N`, then the beta site deployed again so that it offers it (`apps/site/src/lib/download.ts` takes the latest prerelease on the beta, GitHub's latest release on production; with no prerelease yet the beta offers the latest release).

The beta app is its own product, **Tramme Beta** (identifier `app.tramme.desktop.beta`, set through `TAURI_CONFIG`): it installs beside Tramme and does not replace it. Both associate with `.tramme` files; the last one installed opens them. macOS is left out, as in the stable release, until the app is signed. The stable app never sees a beta build: its update check, like the site's, reads GitHub's latest release, which skips prereleases.
