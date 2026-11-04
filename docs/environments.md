# Environments

Where Tramme lives, by environment. Every link from the site to the app (sign up, log in, open the editor, open a project) and from the app to the site (the terms) is written from one table, `brand/environments.ts`, never as a fixed address. Run on your machine, they stay on your machine; deployed to preprod, they stay in preprod.

| Environment | Website | App | When |
|---|---|---|---|
| `local` | `http://localhost:4321` | `http://localhost:8787` | `npm run site` and `npm run dev`: a dev server means local |
| `beta` | `https://beta.tramme.dev` | `https://app.beta.tramme.dev` | `TRAMME_ENV=beta` |
| `preprod` | `https://preprod.tramme.dev` | `https://app.preprod.tramme.dev` | `TRAMME_ENV=preprod` |
| `production` | `https://tramme.dev` | `https://app.tramme.dev` | a build with no `TRAMME_ENV` |

The addresses of beta and preprod follow the production pattern. They are a guess: where those deployments really are is decided where they are created, and it is changed in that one file.

## Choosing

- `TRAMME_ENV=<name>` when building or starting the site or the editor. An unknown name stops the build (a typo must not quietly send visitors to production).
- `TRAMME_SITE_URL` and `TRAMME_APP_URL` set one address by hand (another port, a branch deployment). `SITE_URL`, the site's older variable, still counts.
- Without any: `local` while a dev server runs, `production` for a build.

```
TRAMME_ENV=preprod npm run site:build                 # the site's links lead to app.preprod.tramme.dev
TRAMME_ENV=preprod node apps/editor/build.ts          # the app's links lead to preprod.tramme.dev
TRAMME_ENV=local TRAMME_APP_URL=http://localhost:8790 npm run site   # the app is on another port here
```

## What reads it

- The site: `apps/site/src/lib/links.ts` (`APP`, `signUp`, `logIn`, `space`, `appProject`) and `lib/site.ts` (`SITE.url`: the canonical links, the sitemap, the preview image, `llms.txt`, the structured data).
- The editor: `apps/editor/build.ts` defines `__TRAMME_SITE__`, read by `src/site.ts` (`SITE_URL`).

## What the servers read

The servers are given their address by their own settings, one per deployment:

- the accounts backend: `APP_ORIGIN` (the address of the app: it is the only origin it takes changes from, the one in the links of its mails and the one OAuth providers send people back to) and `APP_URL` (its own);
- the Worker: `APP_ORIGIN` and `VAULT_ORIGIN` (personal mode, `wrangler.jsonc`), `ACCOUNTS_URL` (the backend it hands the account routes to).

For `local`, `apps/server/.env.example` and `apps/worker/.dev.vars.example` already hold the local ones. A beta or preprod deployment sets the same names to its own addresses (a Wrangler environment for the Worker, the host's settings for the backend).
