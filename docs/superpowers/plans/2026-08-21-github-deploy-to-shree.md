# GitHub Deploy to Shree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ THIS PLAN NEVER COMMITS.** The repository owner's standing rule is that
> `git commit` and `git push` are theirs to run, in every repository, without
> exception. Every task therefore ends with a **"Hand off"** step that lists the
> changed files and the exact command **the user** may choose to run. Do not run
> `git add`, `git commit`, or `git push` at any point. Leave the work in the
> working tree and say it is ready.

**Goal:** Make one command on the server — `./deploy.sh` — deploy `tf-api`,
`tf-web`, database migrations and (opt-in) master data from a `git pull`, and
make it impossible for that deploy to silently do nothing.

**Architecture:** Four small committed code changes remove the reasons a
git-based deploy cannot currently work (data excluded from git, origins
hardcoded to localhost, no proxy trust, unbuildable web clone). A tracked
`deploy.sh` then does install → migrate → build → restart → verify in one
gated pass. Apache gains a path-preserving reverse proxy for `/api/v1` and an
SPA fallback for everything else, so the browser only ever talks to one origin.

**Tech Stack:** Node 22 · TypeScript (ESM, `.ts` import extensions, `@/*` →
`src/*`) · Express 5 · Prisma 6 + MySQL · tsup (CJS bundle) · Vitest · React 19
+ Vite 7 · pm2 · Apache 2.4 on Ubuntu.

**Spec:** [2026-08-21-github-deploy-design.md](../specs/2026-08-21-github-deploy-design.md)

---

## Orientation for someone new to this repo

Read this before Task 1; it will save you an hour.

- **Two independent npm projects, not a workspace.** `tf-api/` and `tf-web/`
  each have their own `package.json` and `node_modules`. Every `npm` command
  must be run from inside one of them, never from the repo root.
- **`tf-api` imports carry explicit `.ts` extensions** (`@/config/env.ts`, not
  `@/config/env`). This is deliberate — `tsconfig.json` sets
  `allowImportingTsExtensions` with `moduleResolution: bundler`. Copy the
  surrounding style exactly or the build breaks.
- **Tests need MySQL up.** `vitest.config.ts` points at a separate
  `tf_api_test` database. Run `npm run db:up` in `tf-api` first. The tests in
  this plan are pure-unit and do not touch the DB, but importing `@/app.ts`
  pulls in `@/config/env.ts`, which throws at import time if `DATABASE_URL` is
  unset — `vitest.config.ts` already supplies one.
- **`vitest.config.ts` pins `NODE_ENV=test`.** Task 1 depends on this; do not
  change it.
- **The server path is spelled `tommyfury-v2` — one `r`** — while this local
  repo is `tommyfurry-v2` with two. `cd ~/tommyfurry-v2` on the server fails.
- **`npm run build` in `tf-api` is `tsup`, which emits `dist/index.cjs`** (CJS)
  even though the package is `"type": "module"`. pm2 launches that file by
  absolute path.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `tf-api/src/config/app-urls.ts` | modify | Sole owner of this deployment's public origins; resolves them from `NODE_ENV` |
| `tf-api/src/__tests__/app-config.test.ts` | create | Guards the two deployment-config invariants: production origins are never localhost, and the app trusts exactly one proxy hop |
| `tf-api/src/app.ts` | modify (1 line) | Add `trust proxy` so rate limiting and access logs survive the reverse proxy |
| `tf-api/package.json` | modify (1 line) | Correct the stale `start` script |
| `tf-api/.gitignore` | modify | Stop excluding the master-data snapshot |
| `tf-web/.env.example` | create | Make a clean clone buildable; document the server values |
| `deploy.sh` | create | The single deploy entry point |
| `docs/deployment.md` | create | One-time server bootstrap: env files, Apache vhost, firewall, DB backup |

Tasks 1–3 are ordinary TDD. Tasks 4–7 produce config, scripts and docs that
have no meaningful unit test; each carries an explicit manual verification step
with the command to run and the output to expect.

---

### Task 1: Resolve public origins from NODE_ENV

**Why:** `src/config/app-urls.ts` currently hardcodes `localhost`, and its own
header comment says a server deployment must edit both lines. Because the file
is committed, local and production overwrite each other on every pull. In
production a stale `localhost` means FG's payment gateway POSTs its result into
the void (`fg/config.ts:93` builds `responseUrl` from `API_BASE_URL`) and HDFC's
Pehchaan journey returns the customer to a dead page (`hdfc/config.ts:42` builds
`kycReturnUrl` from `WEB_BASE_URL`).

The fix keeps both origins as committed constants — honouring the project rule
that non-secret wiring is authoritative in code, not env-overridable — and adds a
pure `resolveAppUrls(nodeEnv)` function so the rule can be tested without module
mocking.

**Files:**
- Modify: `tf-api/src/config/app-urls.ts` (whole file, currently 15 lines)
- Test: `tf-api/src/__tests__/app-config.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tf-api/src/__tests__/app-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { resolveAppUrls, API_BASE_URL, WEB_BASE_URL } from "@/config/app-urls.ts";

describe("resolveAppUrls", () => {
  it("uses the Shree public origin in production", () => {
    expect(resolveAppUrls("production")).toEqual({
      api: "http://103.127.167.212",
      web: "http://103.127.167.212",
    });
  });

  it("never returns a localhost origin in production", () => {
    // This is the regression that matters: a localhost origin in production
    // means FG posts payment results into the void and HDFC's Pehchaan journey
    // returns the customer to a dead page.
    const { api, web } = resolveAppUrls("production");
    expect(api).not.toContain("localhost");
    expect(web).not.toContain("localhost");
  });

  it("uses the local dev servers in development", () => {
    expect(resolveAppUrls("development")).toEqual({
      api: "http://localhost:4000",
      web: "http://localhost:8080",
    });
  });

  it("treats test like development, so the suite never depends on a deployment", () => {
    expect(resolveAppUrls("test")).toEqual(resolveAppUrls("development"));
  });

  it("exports constants already resolved for the running NODE_ENV", () => {
    // vitest.config.ts pins NODE_ENV=test.
    expect(API_BASE_URL).toBe("http://localhost:4000");
    expect(WEB_BASE_URL).toBe("http://localhost:8080");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tf-api && npx vitest run src/__tests__/app-config.test.ts
```

Expected: FAIL. `resolveAppUrls` is not exported from `@/config/app-urls.ts`, so
vitest reports something like
`SyntaxError: The requested module '/src/config/app-urls.ts' does not provide an export named 'resolveAppUrls'`.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `tf-api/src/config/app-urls.ts` with:

```ts
/**
 * Where THIS deployment is reachable from the outside.
 *
 * Vendors call us back (payment ResponseURL) or return the customer's browser to
 * us (CKYC / e-KYC return URLs), so several provider configs need our own public
 * origin. They all build it from the two constants here rather than each holding
 * its own copy.
 *
 * ⚠️ DEPLOYMENT: the origins are chosen by NODE_ENV, and both sets are committed
 * — nothing here is env-overridable (see the rule at the top of config/env.ts).
 * `PRODUCTION_URLS` must name the origin this deployment is actually reachable
 * at. A stale `localhost` there means FG's payment gateway posts its result into
 * the void and HDFC's Pehchaan journey returns the customer to a dead page.
 * This file is the only place to change them.
 */
import { env } from "@/config/env.ts";

export interface AppUrls {
  /** Origin vendors POST server-to-server callbacks to (tf-api). */
  readonly api: string;
  /** Origin a vendor returns the customer's BROWSER to (tf-web). */
  readonly web: string;
}

/** Local dev servers. `test` uses these too, so the suite depends on no deployment. */
const DEVELOPMENT_URLS: AppUrls = {
  api: "http://localhost:4000",
  web: "http://localhost:8080",
};

/**
 * Shree (103.127.167.212). Apache serves tf-web at the origin root and
 * reverse-proxies /api/v1 to 127.0.0.1:4000, so both share a single origin.
 * Swapping in a real domain + TLS is a change to these two lines.
 */
const PRODUCTION_URLS: AppUrls = {
  api: "http://103.127.167.212",
  web: "http://103.127.167.212",
};

/** The whole rule, as a pure function so it can be tested for every NODE_ENV. */
export function resolveAppUrls(nodeEnv: string): AppUrls {
  return nodeEnv === "production" ? PRODUCTION_URLS : DEVELOPMENT_URLS;
}

const urls = resolveAppUrls(env.NODE_ENV);

export const API_BASE_URL = urls.api;
export const WEB_BASE_URL = urls.web;
```

The exported names `API_BASE_URL` and `WEB_BASE_URL` are unchanged, so the two
consumers (`src/providers/fg/config.ts:2`, `src/providers/hdfc/config.ts:2`)
need no edit.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd tf-api && npx vitest run src/__tests__/app-config.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Verify nothing else regressed**

```bash
cd tf-api && npm run typecheck && npm test
```

Expected: `typecheck` prints nothing and exits 0. The full suite passes. Pay
particular attention to `src/providers/fg/__tests__/payment.test.ts` and
`src/providers/hdfc/__tests__/` — they exercise the two consumers of these
constants.

- [ ] **Step 6: Hand off (do NOT run this yourself)**

Changed: `tf-api/src/config/app-urls.ts`, `tf-api/src/__tests__/app-config.test.ts`

Command for the user, if they choose to commit:

```bash
git add tf-api/src/config/app-urls.ts tf-api/src/__tests__/app-config.test.ts
git commit -m "feat(config): resolve public origins from NODE_ENV"
```

---

### Task 2: Trust exactly one reverse-proxy hop

**Why:** Putting Apache in front of `tf-api` introduces a defect if this is
skipped. `src/app.ts:56-63` configures `express-rate-limit` with
`RATE_LIMIT_MAX` (default 100) per `RATE_LIMIT_WINDOW_MS` (default 60 s), keyed
on client IP. Behind a proxy with no `trust proxy`, every request appears to come
from `127.0.0.1`, so all users worldwide share **one** 100-requests-per-minute
bucket and the first busy minute locks everyone out. `pino-http` (`src/app.ts:69`)
would likewise record the proxy address as the client for every request,
destroying the access log.

`1` — not `true` — is correct: exactly one hop (Apache) is trusted, so a
client-supplied `X-Forwarded-For` cannot be used to spoof an IP past it.

**Files:**
- Modify: `tf-api/src/app.ts:31` (immediately after `const app = express();`)
- Test: `tf-api/src/__tests__/app-config.test.ts` (append to the file from Task 1)

- [ ] **Step 1: Write the failing test**

Append to `tf-api/src/__tests__/app-config.test.ts`. Also add `createApp` to the
imports at the top of that file:

```ts
import { createApp } from "@/app.ts";
```

Then append this block at the end of the file:

```ts
describe("createApp proxy trust", () => {
  it("trusts exactly one reverse-proxy hop", () => {
    // Apache terminates the client connection and proxies /api/v1 to
    // 127.0.0.1:4000. Without this setting express-rate-limit buckets every
    // user in the world under 127.0.0.1, and pino-http logs the proxy as the
    // client on every request. `1` rather than `true` means a client-supplied
    // X-Forwarded-For cannot spoof an IP past that single trusted hop.
    expect(createApp().get("trust proxy")).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tf-api && npx vitest run src/__tests__/app-config.test.ts
```

Expected: FAIL with `expected false to be 1` — Express's default for
`trust proxy` is `false`.

- [ ] **Step 3: Write the implementation**

In `tf-api/src/app.ts`, inside `createApp()`, insert one statement plus its
comment directly after `const app = express();`:

```ts
export function createApp(): express.Application {
  const app = express();

  // Apache reverse-proxies /api/v1 to this process (see docs/deployment.md), so
  // req.ip must come from X-Forwarded-For. `1` trusts exactly that one hop:
  // without it express-rate-limit keys every user in the world on 127.0.0.1 and
  // pino-http logs the proxy as the client on every request.
  app.set("trust proxy", 1);

  // Security headers
  app.use(helmet());
```

Change nothing else in the file.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd tf-api && npx vitest run src/__tests__/app-config.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Verify nothing else regressed**

```bash
cd tf-api && npm run typecheck && npm test
```

Expected: `typecheck` exits 0; full suite passes. `src/__tests__/compare.test.ts`,
`fg-integration.test.ts` and `icici-integration.test.ts` all call `createApp()`
over supertest — they must stay green.

- [ ] **Step 6: Hand off (do NOT run this yourself)**

Changed: `tf-api/src/app.ts`, `tf-api/src/__tests__/app-config.test.ts`

```bash
git add tf-api/src/app.ts tf-api/src/__tests__/app-config.test.ts
git commit -m "fix(api): trust one reverse-proxy hop so rate limiting keys on the real client IP"
```

---

### Task 3: Correct the stale `start` script

**Why:** `tf-api/package.json` says `"start": "node dist/index.js"`, but
`tsup.config.ts` sets `format: ["cjs"]` and `dist/` contains only `index.cjs`
and `index.cjs.map`. `npm start` therefore fails with
`Cannot find module .../dist/index.js`. This has never broken production only
because pm2 launches the app by absolute path (`.../tf-api/dist/index.cjs`)
rather than through `npm start`. Leaving it wrong is a trap for whoever next
tries to run the built app by hand.

No unit test: asserting a package.json string against itself proves nothing. The
verification below actually runs the built binary.

**Files:**
- Modify: `tf-api/package.json:9`

- [ ] **Step 1: Make the change**

In `tf-api/package.json`, change the `main` field:

```json
    "main": "dist/index.js",     →     "main": "dist/index.cjs",
```

and the `start` script:

```json
    "start": "node dist/index.js",     →     "start": "node --env-file=.env dist/index.cjs",
```

`--env-file=.env` is not cosmetic. Without it, the app boots correctly today only
by accident: `tsup.config.ts` marks `@prisma/client` external, so
`require("@prisma/client")` lands early in the bundle, and Prisma's generated
client loads the **entire** `.env` into `process.env` as a module-load side
effect — before `src/config/env.ts` validates. Nothing in the source enforces
that ordering. A tsup or esbuild change, or a reordered import in `index.ts` /
`app.ts`, flips it and `env.ts` then throws `DATABASE_URL: Required` at boot.
Passing the flag explicitly matches `"dev"` and pm2's `node_args: --env-file=.env`,
and makes env loading deterministic rather than incidental.

- [ ] **Step 2: Build**

```bash
cd tf-api && npm run build
```

Expected: tsup succeeds and reports writing `dist/index.cjs`.

- [ ] **Step 3: Verify the script actually starts the server**

Requires MySQL up (`npm run db:up`) and a `tf-api/.env` present.

```bash
cd tf-api
node --env-file=.env dist/index.cjs & server_pid=$!
sleep 3
curl -s http://127.0.0.1:4000/api/v1/readyz; echo
kill "$server_pid"
```

(Capture the PID rather than using `kill %1` — job control is not enabled in
non-interactive shells, so `%1` fails there.)

Expected: `{"status":"ok","db":"up","timestamp":"..."}`.

If you get `{"status":"error","db":"down",...}` the server started but MySQL is
not reachable — that still proves the entrypoint path is correct, which is what
this task is about.

- [ ] **Step 4: Hand off (do NOT run this yourself)**

Changed: `tf-api/package.json`

```bash
git add tf-api/package.json
git commit -m "fix(api): point the start script at dist/index.cjs, the file tsup emits"
```

---

### Task 4: Track the master-data snapshot

**Why:** The master importers cannot run on the server — they hardcode absolute
Windows paths on one developer's machine (`scripts/import-icici-master.ts:49`,
`scripts/import-hdfc-master.ts:34`, `scripts/import-fg-health-master.ts:24`) and
the source spreadsheets are not in git. That makes
`tf-api/prisma/data-snapshot.json` — a 24 MB portable export of every master and
provider-code table — the only data transport that works from a git checkout.

A 24 MB tracked blob is not new for this repo: `tf-api/docs/rc2026vhicle.csv` is
30 MB and already tracked.

**Files:**
- Modify: `tf-api/.gitignore:11-12`

- [ ] **Step 1: Remove the exclusion**

In `tf-api/.gitignore`, delete these two lines:

```
# Portable data snapshot — distributed to the team out-of-band, not via git.
prisma/data-snapshot.json
```

and replace them with:

```
# NOTE: prisma/data-snapshot.json IS tracked. The master importers hardcode
# absolute Windows paths and cannot run on the server, so the snapshot is the
# only way master data reaches a deployment. Refresh it with `npm run db:export`
# on the machine that holds the source spreadsheets.
```

- [ ] **Step 2: Verify the file is no longer ignored**

```bash
git check-ignore -v tf-api/prisma/data-snapshot.json; echo "exit=$?"
git status --short tf-api/prisma/data-snapshot.json
```

Expected: `git check-ignore` prints nothing and `exit=1` (meaning "not
ignored"), and `git status` now shows `?? tf-api/prisma/data-snapshot.json`.

- [ ] **Step 3: Confirm the snapshot on disk is real and current**

```bash
cd tf-api && node -e "const s=require('./prisma/data-snapshot.json'); console.log('exportedAt', s.exportedAt); console.table(s.counts)"
```

Expected: an `exportedAt` timestamp and a table of non-zero row counts per table
(`mmvMaster`, `rtoMaster`, `insurerMaster`, the `provider*Code` tables, …).

If `exportedAt` looks stale relative to the master data you expect on the
server, regenerate it before handing off — MySQL must be up and the local DB
must hold the full masters:

```bash
cd tf-api && npm run db:export
```

- [ ] **Step 4: Hand off (do NOT run this yourself)**

Changed: `tf-api/.gitignore`
New in tree: `tf-api/prisma/data-snapshot.json` (24 MB)

```bash
git add tf-api/.gitignore tf-api/prisma/data-snapshot.json
git commit -m "chore(data): track the master-data snapshot so deploys can load it"
```

---

### Task 5: Make a clean clone buildable

**Why:** Only `.env.example` files are tracked, and **`tf-web` has none**.
`tf-web/.env` and `.env.local` are gitignored. `tf-web/src/lib/env.ts` calls
`envSchema.safeParse` and throws on a missing `VITE_LEGACY_API_URL` or
`VITE_VENDOR_API_URL`, so `npm run build` on a fresh checkout fails before
emitting anything. The server needs this template to write its own
`.env.production`.

`VITE_*` values are baked into the JS bundle at build time, so they are public
by definition — committing a template of them leaks nothing. Actual `.env`
files stay untracked.

**Files:**
- Create: `tf-web/.env.example`

- [ ] **Step 1: Create the file**

Create `tf-web/.env.example` with exactly this content:

```dotenv
# tf-web environment.
#
# Vite bakes every VITE_* value into the JS bundle at BUILD time, so they are
# public by definition — never put a secret in here or in any .env file below.
#
#   local dev   cp .env.example .env
#   server      cp .env.example .env.production   (untracked; `vite build` runs in
#               production mode and .env.production takes precedence over .env)

# Existing Laravel API — auth, customers, cases, Zuno quotes, payments.
VITE_LEGACY_API_URL=https://insuranceapp.tommyandfurry.com/api

# tf-api. Local dev talks to the dev server directly. On Shree, Apache
# reverse-proxies /api/v1 to 127.0.0.1:4000, so the API shares the site origin:
#   server value: http://103.127.167.212/api/v1
VITE_VENDOR_API_URL=http://localhost:4000/api/v1

# Minutes of inactivity before the auth store logs the user out.
VITE_IDLE_TIMEOUT_MIN=30

# Third-party RC (vehicle registration) lookup, called directly from the browser.
VITE_RC_API_URL=https://regtechapi.in/api/rc_validationworking

# AccessToken header for the RC lookup. Has a default in src/lib/env.ts; set it
# here only when the token changes.
# VITE_RC_API_TOKEN=
```

- [ ] **Step 2: Verify the template actually builds**

Prove the file is sufficient on its own, using a throwaway env directory so your
real `.env` is not consulted:

```bash
cd tf-web
mv .env .env.bak && mv .env.local .env.local.bak
cp .env.example .env
npm run build
```

Expected: `tsc -b` then `vite build` both succeed, and `dist/index.html` is
written. A failure here means the template is missing a required variable.

Restore your local files immediately afterwards:

```bash
cd tf-web && rm .env && mv .env.bak .env && mv .env.local.bak .env.local
```

- [ ] **Step 3: Confirm no real env file became tracked**

```bash
git status --short tf-web/
```

Expected: only `?? tf-web/.env.example`. If `.env`, `.env.local` or `.env.bak`
appears, stop and fix `.gitignore` before handing off.

- [ ] **Step 4: Hand off (do NOT run this yourself)**

Changed: `tf-web/.env.example` (new)

```bash
git add tf-web/.env.example
git commit -m "docs(web): add .env.example so a clean clone can build"
```

---

### Task 6: The deploy script

**Why:** This is the whole point of the plan. On 19/08/2026 the server checkout
sat at the newest commit while `tf-api/dist/` had been built on 31/07/2026 and
the process had 15 days of uptime — roughly three weeks of merged work, the
entire HDFC provider among it, pulled but never running. `tf-web/dist/` was
staler still. **Pulling on this server changes nothing at runtime.** The script
makes install → migrate → build → restart → verify a single gated pass that
fails loudly rather than quietly doing nothing.

**Files:**
- Create: `deploy.sh` (repo root)

> **The script below was revised after review. `deploy.sh` in the repo root is
> authoritative; this copy is the pre-review draft.** Four changes were made:
>
> 1. **The data reload moved to AFTER the build.** As drafted, `--with-data`
>    truncated and reloaded every master table *before* `npm run build`. A build
>    failure then left the old process still serving on top of freshly replaced
>    data it was never built against. Building first means a broken commit aborts
>    before any data is touched.
> 2. **`pm2 restart` gained a first-deploy fallback.** On a box where the pm2 app
>    does not exist yet, `pm2 restart tf-api` fails and there was no documented
>    way to create it. The script now creates and `pm2 save`s it when absent.
> 3. **The `NODE_ENV` check no longer pattern-matches the raw line.** The drafted
>    `grep -qE '^[[:space:]]*NODE_ENV=production[[:space:]]*$'` rejects
>    `NODE_ENV="production"` and `NODE_ENV=production  # comment`, both of which
>    Node's `--env-file` loads as `production` — it would have blocked a deploy on
>    a perfectly valid `.env`. It now parses the value the way Node does.
> 4. **`--help` printed one line too many** (`sed -n '2,12p'` included
>    `set -euo pipefail`); corrected to `2,11p`.

- [ ] **Step 1: Create the script**

Create `deploy.sh` at the repo root with exactly this content:

```bash
#!/usr/bin/env bash
#
# Deploy tf-api + tf-web from this checkout. Run on the server, from the repo
# root, AFTER `git pull`:
#
#   ./deploy.sh              code + migrations
#   ./deploy.sh --with-data  ALSO truncate-and-reload every master table
#
# `git pull` alone changes NOTHING at runtime: pm2 serves tf-api/dist/index.cjs
# and Apache serves tf-web/dist off disk. A deploy is only real once both have
# been rebuilt and pm2 restarted. See docs/deployment.md for one-time setup.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

READYZ_URL="http://127.0.0.1:4000/api/v1/readyz"
STARTED_AT="$(date +%s)"
WITH_DATA=0

for arg in "$@"; do
  case "$arg" in
    --with-data) WITH_DATA=1 ;;
    -h|--help)   sed -n '2,12p' "$0"; exit 0 ;;
    *)           echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mDEPLOY FAILED: %s\033[0m\n\n' "$1" >&2; exit 1; }

# ── 1. Preflight ─────────────────────────────────────────────────────────────
step "Preflight"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || fail "on branch '$branch', expected 'main'"

# A dirty tree means someone hand-edited the box. Deploying over it would either
# lose their change or conflict halfway through, leaving a half-deployed server.
if [ -n "$(git status --porcelain)" ]; then
  git status
  fail "working tree is dirty — commit, stash or revert on the server first"
fi

[ -f tf-api/.env ]            || fail "tf-api/.env is missing (see docs/deployment.md)"
[ -f tf-web/.env.production ] || fail "tf-web/.env.production is missing (see docs/deployment.md)"

# Without this, app-urls.ts hands vendors localhost callback URLs and FG posts
# every payment result into the void.
grep -qE '^[[:space:]]*NODE_ENV=production[[:space:]]*$' tf-api/.env \
  || fail "tf-api/.env must set NODE_ENV=production"

commit="$(git rev-parse --short HEAD)"
echo "deploying $commit  ($(git log -1 --format=%s))"

# ── 2. tf-api ────────────────────────────────────────────────────────────────
# --include=dev is deliberate: tsup, the prisma CLI and tsx are devDependencies,
# and npm silently omits devDeps when NODE_ENV=production is exported in the
# shell. Without this the build fails with "tsup: not found".
step "tf-api — install"
( cd tf-api && npm ci --include=dev )   # postinstall runs `prisma generate`

step "tf-api — migrate"
( cd tf-api && npx prisma migrate deploy )

if [ "$WITH_DATA" -eq 1 ]; then
  step "tf-api — master data reload (--with-data)"
  [ -f tf-api/prisma/data-snapshot.json ] || fail "tf-api/prisma/data-snapshot.json not found"
  echo "This TRUNCATES every master table and reloads them from the snapshot."
  ( cd tf-api && npm run db:import )
fi

step "tf-api — build"
( cd tf-api && npm run build )
[ -f tf-api/dist/index.cjs ] || fail "tf-api/dist/index.cjs was not produced"

step "tf-api — restart"
pm2 restart tf-api --update-env

# ── 3. tf-web ────────────────────────────────────────────────────────────────
step "tf-web — install"
( cd tf-web && npm ci --include=dev )

step "tf-web — build"
( cd tf-web && npm run build )          # tsc -b && vite build
[ -f tf-web/dist/index.html ] || fail "tf-web/dist/index.html was not produced"

# ── 4. Verify ────────────────────────────────────────────────────────────────
step "Verify"

# /readyz runs SELECT 1 through Prisma, so an ok here proves process AND database.
ready=""
for attempt in $(seq 1 30); do
  ready="$(curl -fsS --max-time 3 "$READYZ_URL" 2>/dev/null || true)"
  case "$ready" in
    *'"status":"ok"'*'"db":"up"'*) break ;;
    *) ready="" ;;
  esac
  [ "$attempt" -lt 30 ] || fail "readyz never returned ok — check: pm2 logs tf-api --lines 50"
  sleep 1
done
echo "readyz: $ready"

# Catch the exact failure this script exists to prevent: a "successful" run that
# left yesterday's bundle in place.
api_built="$(date -r tf-api/dist/index.cjs +%s)"
web_built="$(date -r tf-web/dist/index.html +%s)"
[ "$api_built" -ge "$STARTED_AT" ] || fail "tf-api/dist/index.cjs predates this run — the build did not happen"
[ "$web_built" -ge "$STARTED_AT" ] || fail "tf-web/dist/index.html predates this run — the build did not happen"

# ── 5. Report ────────────────────────────────────────────────────────────────
step "Deployed $commit"
printf '  tf-api  %s\n' "$(date -r tf-api/dist/index.cjs)"
printf '  tf-web  %s\n' "$(date -r tf-web/dist/index.html)"
pm2 describe tf-api | grep -E 'status|uptime' || true
```

- [ ] **Step 2: Make it executable, in a way git records**

```bash
chmod +x deploy.sh
git update-index --chmod=+x deploy.sh 2>/dev/null || true
```

On Windows the filesystem has no exec bit; `git update-index --chmod=+x` sets
mode `100755` in the index so the server checkout is executable. It is a no-op
until the file is staged — if it reports `fatal: Unable to mark file`, skip it
and tell the user to run it after `git add`.

- [ ] **Step 3: Verify the script parses and its guards fire**

You cannot run a real deploy from Windows — there is no pm2 and no server. Test
the parts that are testable:

```bash
bash -n deploy.sh && echo "syntax OK"
```

Expected: `syntax OK`.

```bash
bash deploy.sh --nonsense; echo "exit=$?"
```

Expected: `unknown argument: --nonsense` and `exit=2`.

```bash
bash deploy.sh --help
```

Expected: the usage comment block, exit 0.

- [ ] **Step 4: Verify the dirty-tree guard**

Because this plan never commits, the working tree already carries the
uncommitted changes from Tasks 1–6. That makes the guard directly observable —
no probe file needed:

```bash
bash deploy.sh; echo "exit=$?"
```

Expected: a `git status` dump listing your uncommitted work, followed by
`DEPLOY FAILED: working tree is dirty — commit, stash or revert on the server first`
and `exit=1`.

Crucially it must fail **before** printing any `==> tf-api — install` line. If
you see `npm ci` run, the preflight is in the wrong order — fix it.

- [ ] **Step 5: Hand off (do NOT run this yourself)**

Changed: `deploy.sh` (new, mode 100755)

```bash
git add deploy.sh
git update-index --chmod=+x deploy.sh
git commit -m "feat(deploy): add one-command server deploy with build and readyz gates"
```

---

### Task 7: Server bootstrap documentation

**Why:** Several steps run once, not per deploy, and none of them are
discoverable from the code. Two of them are outright blockers that the spec did
not originally capture:

1. **SPA deep links 404.** `tf-web/src/app/router/index.tsx:10` uses
   `createBrowserRouter` (History API). Apache serves `tf-web/dist` off disk, so
   `http://103.127.167.212/vehicle-insurance/compare` looks for a file that does
   not exist. Without a fallback, every deep link and **every browser refresh**
   returns 404. The router file's own comment anticipates exactly this.
2. **HDFC silently disabled.** The server `.env` had no `HDFC_*` keys at all as
   of 19/08/2026. `src/config/env.ts` marks everything except `DATABASE_URL`
   optional or defaulted, so `tf-api` boots cleanly and serves zero HDFC quotes
   with no error anywhere.

**Files:**
- Create: `docs/deployment.md`

- [ ] **Step 1: Create the document**

Create `docs/deployment.md` with exactly this content:

````markdown
# Deploying to Shree

The server is `Shree`, `103.127.167.212`, ssh user `devuser`. The checkout is
`/var/www/Yash/tommyfury-v2` — **`tommyfury`, one `r`**, while the local Windows
repo is `tommyfurry-v2` with two. `cd ~/tommyfurry-v2` will fail.

## Routine deploy

```bash
ssh devuser@103.127.167.212
cd /var/www/Yash/tommyfury-v2
git pull
./deploy.sh
```

Add `--with-data` **only** when master data actually changed:

```bash
./deploy.sh --with-data
```

`--with-data` runs `npm run db:import`, which sets `FOREIGN_KEY_CHECKS = 0` and
calls `deleteMany({})` on every master table before reloading them from
`tf-api/prisma/data-snapshot.json`. It is a full truncate-and-replace of live
master data. Take a dump first (see below).

`git pull` on its own deploys nothing — pm2 serves `tf-api/dist/index.cjs` and
Apache serves `tf-web/dist` off disk. Both must be rebuilt.

## Topology

| URL | Served by |
| --- | --- |
| `http://103.127.167.212/` | Apache, `DocumentRoot` → `tf-web/dist`, static |
| `http://103.127.167.212/api/v1/*` | Apache `ProxyPass` → `http://127.0.0.1:4000/api/v1` |

pm2 app `tf-api` runs `dist/index.cjs` with `--env-file=.env` on port 4000.

> **Not a go-live configuration.** This serves the customer journey over
> plaintext HTTP, so KYC and payment data cross the wire in the clear, and
> vendor callbacks point at a bare IP. Moving to a domain + TLS is a change to
> `PRODUCTION_URLS` in `tf-api/src/config/app-urls.ts`,
> `VITE_VENDOR_API_URL` in `tf-web/.env.production`, `ALLOWED_ORIGINS` in
> `tf-api/.env`, and the vhost below.

## One-time bootstrap

### 1. `tf-api/.env`

Copy `tf-api/.env.example` and fill it in. Minimum for a working deploy:

```dotenv
PORT=4000
NODE_ENV=production
LOG_LEVEL=info
DATABASE_URL=mysql://tf_app:<password>@localhost:3306/tf_api_dev
ALLOWED_ORIGINS=http://103.127.167.212
```

`NODE_ENV=production` is not optional — `deploy.sh` refuses to run without it.
It is what makes `app-urls.ts` hand vendors the real origin instead of
`localhost`, and a `localhost` callback means FG posts every payment result into
the void and HDFC returns the customer to a dead page.

Then add every vendor credential block from `.env.example`. **Check `HDFC_*`
specifically**: the server `.env` had none as of 19/08/2026, and because
`src/config/env.ts` defaults or marks optional everything except `DATABASE_URL`,
a rebuilt `tf-api` boots perfectly happily and serves zero HDFC quotes with no
error in any log. Verify after deploying:

```bash
curl -s http://103.127.167.212/api/v1/providers
```

Every provider you expect must appear.

### 2. `tf-web/.env.production`

Untracked, created on the box:

```bash
cd /var/www/Yash/tommyfury-v2/tf-web
cp .env.example .env.production
```

Then edit the one line that differs from the local default:

```dotenv
VITE_VENDOR_API_URL=http://103.127.167.212/api/v1
```

`vite build` runs in production mode, and `.env.production` takes precedence
over `.env`. Vite bakes these values into the bundle, so **a change here needs a
rebuild** — `./deploy.sh` — not a restart.

### 3. Apache

Enable the proxy modules once:

```bash
sudo a2enmod proxy proxy_http
```

Then the vhost. Both directives below are load-bearing:

```apache
<VirtualHost *:80>
    ServerName 103.127.167.212

    # tf-api. This MUST come before the DocumentRoot block: ProxyPass is matched
    # before filesystem mapping, so /api/v1 never reaches FallbackResource and
    # never gets rewritten to index.html.
    ProxyPreserveHost On
    ProxyPass        /api/v1  http://127.0.0.1:4000/api/v1
    ProxyPassReverse /api/v1  http://127.0.0.1:4000/api/v1

    # tf-web — the static Vite build output.
    DocumentRoot /var/www/Yash/tommyfury-v2/tf-web/dist

    <Directory /var/www/Yash/tommyfury-v2/tf-web/dist>
        Require all granted
        Options -Indexes
        AllowOverride None

        # The app uses createBrowserRouter (History API), so
        # /vehicle-insurance/compare is not a file on disk. Without this, every
        # deep link and every browser refresh returns 404.
        FallbackResource /index.html
    </Directory>

    ErrorLog  ${APACHE_LOG_DIR}/tf-web-error.log
    CustomLog ${APACHE_LOG_DIR}/tf-web-access.log combined
</VirtualHost>
```

Apply:

```bash
sudo apache2ctl configtest    # must print "Syntax OK"
sudo systemctl reload apache2
```

### 4. Close port 4000

Only after the proxy is verified working:

```bash
curl -s http://103.127.167.212/api/v1/readyz    # must be ok BEFORE you do this
sudo ufw deny 4000
```

`tf-api` binds all interfaces, so until this is done the API is directly
reachable on `:4000`, bypassing the proxy.

### 5. Database baseline

Take a dump before the first `--with-data` run. It is the only undo for the
truncate.

```bash
sudo mysqldump --defaults-file=/etc/mysql/debian.cnf tf_api_dev \
  > ~/tf_api_dev-$(date +%F).sql
```

Root login is denied on this box for both `-p` and `sudo`; `debian.cnf` is the
reliable admin path. Table names are snake_case (`mmv_master`, `rto_master`,
`provider_*_codes`), not the Prisma model names.

### 6. Disk

Root was **90% full** on 19/08/2026 (80 G free of 823 G). `npm ci` across two
projects plus a 24 MB tracked snapshot needs headroom.

```bash
df -h /
```

## Verifying a deploy

`deploy.sh` checks the first four itself. Do the rest by hand after a bootstrap
or any Apache change:

| Check | Command | Expected |
| --- | --- | --- |
| Script succeeded | `./deploy.sh` | exits 0, prints the commit SHA |
| API alive + DB up | `curl -s http://127.0.0.1:4000/api/v1/readyz` | `{"status":"ok","db":"up",...}` |
| Bundles are fresh | in the script's report | both timestamps are from this run |
| Process restarted | `pm2 describe tf-api` | uptime in seconds, not days |
| **Proxy works** | `curl -s http://103.127.167.212/api/v1/readyz` | same ok, **through Apache** |
| **Deep links work** | `curl -sI http://103.127.167.212/vehicle-insurance/compare` | `200`, not `404` |
| Providers enabled | `curl -s http://103.127.167.212/api/v1/providers` | every expected provider |
| Port 4000 closed | `curl -s --max-time 3 http://103.127.167.212:4000/api/v1/healthz` | connection refused |
| Journey works | open `http://103.127.167.212/` | compare page returns live quotes |

## Rollback

```bash
cd /var/www/Yash/tommyfury-v2
git log --oneline -5
git checkout <previous-sha>
./deploy.sh
```

`deploy.sh` requires branch `main`, so for a rollback either branch from the
old SHA and rename, or temporarily run the four inner commands by hand:
`npm ci --include=dev`, `npx prisma migrate deploy`, `npm run build`,
`pm2 restart tf-api`.

Migrations do not roll back automatically. If the bad deploy included one,
restore from the dump in step 5.

For master data only:

```bash
sudo mysql --defaults-file=/etc/mysql/debian.cnf tf_api_dev < ~/tf_api_dev-<date>.sql
```

## Other things on this box

- pm2 app `nivabupa-api` (port 4100) is a **separate standalone repo** at
  `/var/www/Yash/nivabupa-api`. Nothing here touches it.
- `ondc-api` on :3000 from `/var/www/docboyzsitechange/`, and a docker-proxy on
  :8001 — unrelated.
- Apache also serves `healthinsurance.tommyandfurry.com`, `docboyz.in`,
  `collectkart.docboyz.in`, `ondc.docboyz.in` and `regtechapi.in`. Do not
  disturb those vhosts.
````

- [ ] **Step 2: Verify the Apache snippet is syntactically valid**

You cannot run `apache2ctl` from Windows. Instead check the two ordering
invariants by reading:

- `ProxyPass /api/v1` appears **before** the `<Directory>` block that contains
  `FallbackResource`.
- `FallbackResource /index.html` is inside the `<Directory>` block whose path
  matches `DocumentRoot`.

Confirm both by eye, then:

```bash
grep -n "ProxyPass\|FallbackResource\|DocumentRoot" docs/deployment.md
```

Expected line order: `ProxyPass`, `ProxyPassReverse`, `DocumentRoot`,
`FallbackResource`.

- [ ] **Step 3: Verify every path and command in the doc resolves**

The doc must say `tommyfury-v2` (one `r`) everywhere it names a server path. The
only permitted `tommyfurry-v2` (two `r`s) is the single opening sentence that
contrasts the two spellings.

```bash
grep -c "tommyfurry-v2" docs/deployment.md
grep -c "tommyfury-v2" docs/deployment.md
```

Expected: exactly `1` for the two-`r` spelling, and `5` or more for the one-`r`
spelling. Any other count for the first means a server path is misspelled and
will fail with `No such file or directory`.

- [ ] **Step 4: Hand off (do NOT run this yourself)**

Changed: `docs/deployment.md` (new)

```bash
git add docs/deployment.md
git commit -m "docs: add Shree deployment and bootstrap guide"
```

---

## After all tasks

- [ ] **Full verification sweep**

```bash
cd tf-api && npm run typecheck && npm run lint && npm test
cd ../tf-web && npm run typecheck && npm run lint && npm test
```

Expected: all six commands exit 0.

- [ ] **Report to the user, then stop**

State plainly: what changed, that everything is in the working tree
**uncommitted**, and the two things only they can do:

1. **Commit and push.** Nothing reaches the server until `origin/main` has these
   changes. Note that `417fae8 hdfc v1 complete` is *already* unpushed and local
   `main` was 1 commit ahead of `origin/main` before this work started.
2. **Run the bootstrap in `docs/deployment.md` on the box**, then
   `git pull && ./deploy.sh`. SSH from this machine fails with
   `Permission denied (keyboard-interactive)` — there is no key auth, so the
   deploy cannot be driven from here.
