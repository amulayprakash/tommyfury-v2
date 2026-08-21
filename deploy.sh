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
    -h|--help)   sed -n '2,11p' "$0"; exit 0 ;;
    *)           echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mDEPLOY FAILED: %s\033[0m\n\n' "$1" >&2; exit 1; }

# ── 1. Preflight ─────────────────────────────────────────────────────────────
step "Preflight"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || fail "on branch '$branch', expected 'main'"

# A dirty tree means someone hand-edited TRACKED files on the box. Deploying over
# that would either lose their change or conflict halfway through, leaving a
# half-deployed server.
#
# Untracked files are deliberately NOT counted. A server legitimately accumulates
# them — tf-web/.env.production (which this script requires below), database
# dumps, logs — and an earlier version of this check counted them, so creating the
# very env file the script demands made the script refuse to run.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --untracked-files=no
  fail "tracked files are modified — commit, stash or revert on the server first"
fi

[ -f tf-api/.env ]            || fail "tf-api/.env is missing (see docs/deployment.md)"
[ -f tf-web/.env.production ] || fail "tf-web/.env.production is missing (see docs/deployment.md)"

# Without this, app-urls.ts hands vendors localhost callback URLs and FG posts
# every payment result into the void.
#
# Read the value the way Node's --env-file does rather than pattern-matching the
# raw line: NODE_ENV="production" and `NODE_ENV=production  # comment` are both
# valid and both load as "production", so a stricter regex would reject a
# perfectly good .env and block the deploy. Last assignment wins, as in Node.
node_env="$(
  sed -n 's/^[[:space:]]*NODE_ENV[[:space:]]*=[[:space:]]*//p' tf-api/.env \
    | sed -e 's/[[:space:]]*#.*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" \
          -e 's/[[:space:]]*$//' -e 's/\r$//' \
    | tail -n 1
)"
[ "$node_env" = "production" ] \
  || fail "tf-api/.env must set NODE_ENV=production (found: '${node_env:-unset}')"

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

step "tf-api — build"
( cd tf-api && npm run build )
[ -f tf-api/dist/index.cjs ] || fail "tf-api/dist/index.cjs was not produced"

# Deliberately AFTER the build. db:import truncates every master table and
# reloads it; if it ran first and the build then failed, the old process would
# keep serving on top of freshly-replaced data it was never built against.
# Building first means a broken commit aborts before any data is touched.
if [ "$WITH_DATA" -eq 1 ]; then
  step "tf-api — master data reload (--with-data)"
  [ -f tf-api/prisma/data-snapshot.json ] || fail "tf-api/prisma/data-snapshot.json not found"
  echo "This TRUNCATES every master table and reloads them from the snapshot."
  ( cd tf-api && npm run db:import )
fi

# `pm2 restart` fails on a box where the app has never been created, which is
# exactly the first-deploy case. Create it then; restart it every time after.
step "tf-api — restart"
if pm2 describe tf-api >/dev/null 2>&1; then
  pm2 restart tf-api --update-env
else
  echo "pm2 app 'tf-api' not found — creating it (first deploy)"
  ( cd tf-api && pm2 start dist/index.cjs --name tf-api --node-args=--env-file=.env )
  pm2 save
fi

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
