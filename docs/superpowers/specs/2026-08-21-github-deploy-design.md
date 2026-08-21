# Deploying the full stack to Shree via GitHub

**Date:** 2026-08-21
**Status:** approved, ready for implementation planning

## Goal

Make one command on the server deploy everything — `tf-api`, `tf-web`, database
migrations, and master data — from a `git pull`, and make it impossible for the
deploy to silently do nothing. Everything travels through GitHub except `.env`
files.

## Where we start

The server is `Shree`, `103.127.167.212`, ssh user `devuser`, checkout at
`/var/www/Yash/tommyfury-v2` — **`tommyfury`, one `r`**, while the local Windows
repo is `tommyfurry-v2` with two. `pm2` runs app `tf-api` from `dist/index.cjs`
on port 4000 by an explicit absolute path. Apache (not nginx) serves
`tf-web/dist` as static files straight off disk. MySQL is local, database
`tf_api_dev`, app user `tf_app`.

There is no CI/CD: `.github/` does not exist.

Five facts drive the whole design.

### 1. Deploys are build-gated and have been forgotten

On 19/08/2026 the checkout sat at the newest commit while `tf-api/dist/` had been
built on 31/07/2026 and the process had 15 days of uptime. Roughly three weeks of
merged work — the entire HDFC provider among it — was pulled but never running.
`tf-web/dist/` was staler still, 14/07/2026.

**Pulling on this server changes nothing at runtime.** A deploy is only real once
`npm ci && npm run build` has run in each project and pm2 has restarted `tf-api`.

### 2. Master data cannot be rebuilt on the server

The master importers hardcode absolute Windows paths on one developer's machine:

| Script | Hardcoded path |
| --- | --- |
| `scripts/import-icici-master.ts:49` | `c:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/ICICI/UAT_MMV_Details` |
| `scripts/import-hdfc-master.ts:34` | `C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/HDFC API KIT/HDFC API KIT` |
| `scripts/import-fg-health-master.ts:24` | `.../dock boyz/FG API Kit/.../Health API Kit TCS` |

The source spreadsheets are not in git — only four test-case sheets under
`tf-api/docs/` are tracked. So `npm run db:import:fg` and friends can never run
from a server checkout.

That leaves `tf-api/prisma/data-snapshot.json` — a 24 MB portable export of every
master and provider-code table — as the **only** data transport that works from
git. It is currently excluded by `tf-api/.gitignore`:

```
# Portable data snapshot — distributed to the team out-of-band, not via git.
prisma/data-snapshot.json
```

A 24 MB tracked blob is not a new kind of problem for this repo:
`tf-api/docs/rc2026vhicle.csv` is **30 MB and already tracked**.

### 3. Our own public origins are hardcoded to localhost

`tf-api/src/config/app-urls.ts` ends:

```ts
export const API_BASE_URL = "http://localhost:4000";
export const WEB_BASE_URL = "http://localhost:8080";
```

Its own header comment says a server deployment must edit both lines, and that a
stale `localhost` means FG's payment gateway posts its result into the void and
HDFC's Pehchaan journey returns the customer to a dead page. But the file is
committed, so local and production overwrite each other on every pull.

### 4. `tf-web` cannot be built from a clean clone

Only `.env.example` files are tracked, and **`tf-web` has none**. `tf-web/.env`
and `tf-web/.env.local` are gitignored. `tf-web/src/lib/env.ts` fails fast on a
missing `VITE_LEGACY_API_URL` or `VITE_VENDOR_API_URL`, so `npm run build` on a
fresh checkout throws before it emits anything.

### 5. Nothing proxies to the node app

No Apache vhost proxies to `:4000`. Both node apps listen on all interfaces, so
browsers reach `tf-api` directly on port 4000 — which also means port 4000 is
open to the internet.

## Decisions taken

| Question | Decision |
| --- | --- |
| Target | Existing Shree box, in place |
| Trigger | Committed `deploy.sh`, run by hand over SSH |
| Data transport | Commit `data-snapshot.json` to git |
| Origins config | NODE_ENV-aware committed constants; **no `.env` committed** |
| API routing | Apache reverse proxy in front of `tf-api` |
| Public origin | `http://103.127.167.212` — bare IP, no TLS |

### Recorded concern: plaintext HTTP

The chosen public origin serves the customer journey over unencrypted HTTP. KYC
and payment data cross the wire in the clear, and vendor callbacks (FG's payment
`ResponseURL`, HDFC's Pehchaan return URL) will point at a bare IP over HTTP,
which some vendors reject in production. This was raised and the decision was
reaffirmed.

**This configuration is a UAT/staging rehearsal, not a go-live configuration.**
The design confines the origin to two constants in one file plus one line of a
server-side `.env.production`, so swapping in a domain and a Let's Encrypt
certificate later is a small, contained change.

## Target topology

| URL | Served by |
| --- | --- |
| `http://103.127.167.212/` | Apache, `DocumentRoot` → `tf-web/dist`, static |
| `http://103.127.167.212/api/v1/*` | Apache `ProxyPass` → `http://127.0.0.1:4000/api/v1` |

Because the browser then talks to one origin, the customer journey stops making
cross-origin requests at all, and port 4000 can be closed to the internet.
`ALLOWED_ORIGINS` is still set to that single origin — CORS becomes a backstop
for any non-proxied caller rather than something the journey depends on. Every
router in `tf-api/src/app.ts:82-88` mounts under `/api/v1`, so a path-preserving
`ProxyPass` needs no rewriting.

## Repository changes

All of these are committed. No `.env` file is ever committed.

### `tf-api/.gitignore` — track the data snapshot

Remove the `prisma/data-snapshot.json` exclusion and its comment. The file
becomes a tracked artifact, refreshed by `npm run db:export` on the machine that
holds the source spreadsheets, and committed like any other change.

**The snapshot was stale and has been refreshed (21/08/2026).** The file on disk
was exported 23/07/2026 — before the HDFC integration — and contained only two
providers (`fg`, `icici`) with zero HDFC rows in `provider_mmv_codes`,
`provider_rto_codes` or `provider_insurer_codes`. Deploying it would have loaded
a server that serves no HDFC quotes at all, silently defeating the `hdfc v1
complete` release it ships alongside. Re-exported from the local dev database,
which holds the full set; the masters were unchanged (mmv 21132, rto 1535,
pincode 168011 identical), so the refresh is purely additive:

| | 23/07 snapshot | refreshed |
| --- | ---: | ---: |
| providers | 2 | 3 |
| `providerMmvCodes` | 7 473 | 12 923 |
| `providerRtoCodes` | 2 046 | 3 478 |
| `providerInsurerCodes` | 20 | 28 |

The new file is 25.5 MB and covers all 14 `SNAPSHOT_TABLES`. It was verified by a
full local round-trip — `npm run db:import` truncated and reloaded every master
table and reproduced all counts exactly — so the `--with-data` path is proven
before it is ever run against the server.

### `tf-api/src/config/app-urls.ts` — NODE_ENV-aware

Keep both origins as committed constants, in one file, chosen by `NODE_ENV`:
`localhost:4000` / `localhost:8080` in development, `http://103.127.167.212` for
both in production. This honours the project rule that non-secret vendor wiring is
authoritative in code rather than env-overridable, while ending the
local-versus-production overwrite. The exported names `API_BASE_URL` and
`WEB_BASE_URL` do not change, so no consumer is touched.

### `tf-api/src/app.ts` — trust the proxy

Add `app.set("trust proxy", 1)` before the middleware stack.

This is a defect the reverse proxy would otherwise introduce. `express-rate-limit`
is configured at `src/app.ts:56-63` with `RATE_LIMIT_MAX` per
`RATE_LIMIT_WINDOW_MS`. Behind a proxy without `trust proxy`, every request
appears to come from `127.0.0.1`, so all users worldwide share a single
100-requests-per-minute bucket and the first busy minute locks everyone out.
`pino-http` would likewise record the proxy address as the client IP for every
request, destroying the access log.

### `tf-api/package.json` — correct the start script

`"start": "node dist/index.js"` and `"main": "dist/index.js"` are both stale;
`tsup.config.ts` emits `format: ["cjs"]` and `dist/` contains only `index.cjs`.
This has never broken anything because pm2 launches the app by absolute path
rather than through `npm start`. Both are corrected to `dist/index.cjs`.

The `start` script also gains `--env-file=.env`. Instrumenting the built bundle
showed that env loading currently succeeds only incidentally: `@prisma/client` is
marked external, so its `require` lands early and Prisma's generated client loads
the **whole** `.env` into `process.env` as a module-load side effect, ahead of the
zod validation in `src/config/env.ts`. Nothing in the source guarantees that
order. Passing the flag explicitly — matching `"dev"` and pm2's
`node_args: --env-file=.env` — makes it deterministic.

### `tf-web/.env.example` — new file

Template covering `VITE_LEGACY_API_URL`, `VITE_VENDOR_API_URL`,
`VITE_IDLE_TIMEOUT_MIN` and `VITE_RC_API_URL`, with the production values for
`103.127.167.212` shown as comments. This closes the gap where a clean clone
cannot build.

### `deploy.sh` — new file at the repo root

The single entry point, `set -euo pipefail`, run from the repo root on the server.
Note that `dev-up.ps1` and `dev-down.ps1` are gitignored and remain local-only;
`deploy.sh` is deliberately tracked.

1. **Preflight.** Refuse to run unless the working tree is clean and the branch is
   `main`; print `git status` and exit non-zero otherwise. This catches the failure
   mode where someone hand-edited `app-urls.ts` or `.env` on the box and the next
   `git pull` conflicts halfway through a deploy.
2. **tf-api.** `npm ci --include=dev` (its `postinstall` runs `prisma generate`) →
   `npx prisma migrate deploy` → `npm run build` → `pm2 restart tf-api --update-env`.
   `migrate deploy` is the non-interactive production command; `migrate dev` must
   never run here. `--include=dev` is load-bearing: `tsup`, the Prisma CLI and
   `tsx` are all devDependencies, and npm silently omits devDependencies when
   `NODE_ENV=production` is exported in the shell — the build would fail with
   `tsup: not found`.
3. **tf-web.** `npm ci` → `npm run build`. Vite reads the server's untracked
   `.env.production`. Output is static, so there is nothing to restart.
4. **Verify.** Poll `http://127.0.0.1:4000/api/v1/readyz` until it returns
   `{"status":"ok","db":"up"}` or fail loudly on timeout — that endpoint runs
   `SELECT 1` through Prisma, so it proves both the process and the database.
   Assert `tf-web/dist/index.html` is newer than the moment the deploy started.
5. **Report.** Print the deployed commit SHA and both build timestamps.

Steps 2 through 4 are exactly what was missing when three weeks of work sat pulled
but unbuilt.

**`--with-data` flag, off by default.** When passed, additionally runs
`npm run db:import` after migrations. It is opt-in because `scripts/import-data.ts`
sets `FOREIGN_KEY_CHECKS = 0` and calls `deleteMany({})` on every snapshot table
before reloading — a full truncate-and-replace of the live master tables. That must
never happen by accident on a routine code deploy.

## One-time server bootstrap

These run once, not per deploy. They are documented in a new `docs/deployment.md`
so the next person does not have to rediscover them.

- **`tf-api/.env`** from `.env.example`, containing at minimum a working
  `DATABASE_URL` for the `tf_app` user, `NODE_ENV=production`,
  `ALLOWED_ORIGINS=http://103.127.167.212`, and the `HDFC_*` credentials. The
  server `.env` had **no `HDFC_*` keys at all** as of 19/08/2026, and because
  `src/config/env.ts` marks everything except `DATABASE_URL` optional or
  defaulted, a rebuilt `tf-api` will boot happily and silently serve no HDFC
  quotes. That silence is the trap worth calling out.
- **`tf-web/.env.production`**, untracked, with
  `VITE_VENDOR_API_URL=http://103.127.167.212/api/v1` and the legacy API URL.
- **Apache.** Enable `proxy` and `proxy_http`; add path-preserving `ProxyPass` /
  `ProxyPassReverse` for `/api/v1` to the `tf-web` vhost; run `apache2ctl
  configtest`; reload.
- **Apache SPA fallback.** `tf-web/src/app/router/index.tsx:10` uses
  `createBrowserRouter`, so routes are History API paths with no file behind
  them. Serving `tf-web/dist` off disk means every deep link and **every browser
  refresh** returns 404 without a `FallbackResource /index.html` on the
  DocumentRoot directory. The `ProxyPass` for `/api/v1` must be declared before
  it — proxy matching precedes filesystem mapping, so API requests never reach
  the fallback and never get rewritten to HTML.
- **Firewall.** Drop public access to port 4000 once the proxy is verified.
- **Baseline `mysqldump`** of `tf_api_dev` before the first `--with-data` run. This
  is the only undo for the truncate.
- **Disk headroom.** Root was **90% full** on 19/08/2026 (80 G free of 823 G).
  `npm ci` across two projects plus a 24 MB tracked blob needs room.

## Verification

The deploy is proven when all of the following hold:

- `deploy.sh` exits zero and prints the expected commit SHA
- `curl http://103.127.167.212/api/v1/readyz` returns `{"status":"ok","db":"up"}`
  **through Apache**, not just on `127.0.0.1:4000`
- `curl -I http://103.127.167.212/vehicle-insurance/compare` returns `200`, not
  `404` — proving the SPA fallback is in place and deep links survive a refresh
- `pm2 describe tf-api` shows uptime reset to seconds
- `tf-api/dist/index.cjs` and `tf-web/dist/index.html` both carry today's mtime
- The compare page in a browser at `http://103.127.167.212/` returns live quotes
  from every enabled provider
- Port 4000 is refused from outside the box

## Out of scope

- TLS and a real domain — deliberately deferred, see the recorded concern
- GitHub Actions or any automatic trigger; the deploy stays manual
- The standalone `nivabupa-api` pm2 app, a separate repo at
  `/var/www/Yash/nivabupa-api`, untouched by this
- Making the master importers portable — the snapshot makes that unnecessary for
  deployment, though it remains a real gap for anyone rebuilding masters
- Zero-downtime or rollback tooling beyond the pre-`--with-data` dump

## Known preconditions

- Local `main` is **1 commit ahead of `origin/main`** (`417fae8 hdfc v1 complete`,
  unpushed). Nothing reaches the server until that is pushed. Pushing is the user's
  to run.
- The server checkout may have uncommitted local edits. If `deploy.sh` preflight
  refuses, that has to be resolved on the box before the first deploy.
