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
> plaintext HTTP, so KYC and payment data cross the wire in the clear, and vendor
> callbacks point at a bare IP. Moving to a domain + TLS is a change to
> `PRODUCTION_URLS` in `tf-api/src/config/app-urls.ts`, `VITE_VENDOR_API_URL` in
> `tf-web/.env.production`, `ALLOWED_ORIGINS` in `tf-api/.env`, and the vhost
> below.

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

`NODE_ENV=production` is not optional — `deploy.sh` refuses to run without it. It
is what makes `app-urls.ts` hand vendors the real origin instead of `localhost`,
and a `localhost` callback means FG posts every payment result into the void and
HDFC returns the customer to a dead page.

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

`vite build` runs in production mode, and `.env.production` takes precedence over
`.env`. Vite bakes these values into the bundle, so **a change here needs a
rebuild** — `./deploy.sh` — not a restart.

### 3. First run — get tf-api up before touching Apache

Apache's proxy is useless until something is listening on 4000, and the steps
below ask you to curl through it. So run the deploy once now:

```bash
cd /var/www/Yash/tommyfury-v2
./deploy.sh
```

On a box where the pm2 app does not exist yet, `deploy.sh` creates it
(`pm2 start dist/index.cjs --name tf-api --node-args=--env-file=.env`, then
`pm2 save`) instead of restarting it. On every later deploy it restarts the
existing process. Either way, confirm it directly before moving on:

```bash
curl -s http://127.0.0.1:4000/api/v1/readyz
pm2 describe tf-api
```

`readyz` must return `{"status":"ok","db":"up",...}`. If it does not, fix that
first — Apache cannot help you here.

To survive a reboot, register the pm2 startup hook once:

```bash
pm2 startup    # prints a sudo command; run what it prints
pm2 save
```

### 4. Apache

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

### 5. Close port 4000

Only after the proxy is verified working:

```bash
curl -s http://103.127.167.212/api/v1/readyz    # must be ok BEFORE you do this
sudo ufw deny 4000
```

`tf-api` binds all interfaces, so until this is done the API is directly
reachable on `:4000`, bypassing the proxy.

### 6. Database baseline

Take a dump before the first `--with-data` run. It is the only undo for the
truncate.

```bash
sudo mysqldump --defaults-file=/etc/mysql/debian.cnf tf_api_dev \
  > ~/tf_api_dev-$(date +%F).sql
```

Root login is denied on this box for both `-p` and `sudo`; `debian.cnf` is the
reliable admin path. Table names are snake_case (`mmv_master`, `rto_master`,
`provider_mmv_codes`), not the Prisma model names.

### 7. Disk

Root was **90% full** on 19/08/2026 (80 G free of 823 G). `npm ci` across two
projects plus a ~25 MB tracked snapshot needs headroom.

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

## Master data

`tf-api/prisma/data-snapshot.json` is **tracked in git** — that is deliberate.
The master importers (`scripts/import-fg-master.ts`, `import-icici-master.ts`,
`import-hdfc-master.ts`, `import-fg-health-master.ts`) hardcode absolute Windows
paths to spreadsheets that are not in the repo, so they cannot run on the server.
The snapshot is the only way master data reaches a deployment.

When provider codes or masters change, refresh it on the machine that holds the
source spreadsheets:

```bash
cd tf-api && npm run db:export
```

then commit the updated JSON and deploy with `--with-data`.

**Check the snapshot is current before a `--with-data` deploy.** A stale one is
silent: it loads without error and simply leaves a provider missing.

```bash
cd tf-api && node -e "const s=require('./prisma/data-snapshot.json'); console.log(s.exportedAt); console.log(s.tables.providers.map(p=>p.slug).join(', '))"
```

This caught a real problem on 21/08/2026 — the snapshot then on disk was exported
23/07/2026, listed only `fg` and `icici`, and had zero HDFC rows in
`provider_mmv_codes` / `provider_rto_codes` / `provider_insurer_codes`. Deploying
it would have served no HDFC quotes at all.

## Rollback

```bash
cd /var/www/Yash/tommyfury-v2
git log --oneline -5
git checkout <previous-sha>
./deploy.sh
```

`deploy.sh` requires branch `main`, so for a rollback either branch from the old
SHA and rename, or temporarily run the four inner commands by hand:
`npm ci --include=dev`, `npx prisma migrate deploy`, `npm run build`,
`pm2 restart tf-api`.

Migrations do not roll back automatically. If the bad deploy included one,
restore from the dump in step 6.

### Restoring the database — read this before you run it

```bash
sudo mysql --defaults-file=/etc/mysql/debian.cnf tf_api_dev < ~/tf_api_dev-<date>.sql
```

> ⚠️ **This is a full-database point-in-time restore, not a master-data restore.**
> The baseline dump in step 6 covers *every* table, so replaying it also reverts
> `quotes`, `health_quotes` and anything else written since the dump was taken.
> Every quote and proposal created in that window is lost.

If you only need to undo a bad `--with-data` reload, prefer re-running the import
with a known-good snapshot — it touches nothing but the master tables:

```bash
cd /var/www/Yash/tommyfury-v2
git checkout <good-sha> -- tf-api/prisma/data-snapshot.json
cd tf-api && npm run db:import
```

Reach for the full restore only when a migration or the schema itself is broken,
and take a fresh dump of the current state first so the transactional rows are
recoverable:

```bash
sudo mysqldump --defaults-file=/etc/mysql/debian.cnf tf_api_dev \
  > ~/tf_api_dev-before-restore-$(date +%F-%H%M).sql
```

## Other things on this box

- pm2 app `nivabupa-api` (port 4100) is a **separate standalone repo** at
  `/var/www/Yash/nivabupa-api`. Nothing here touches it.
- `ondc-api` on :3000 from `/var/www/docboyzsitechange/`, and a docker-proxy on
  :8001 — unrelated.
- Apache also serves `healthinsurance.tommyandfurry.com`, `docboyz.in`,
  `collectkart.docboyz.in`, `ondc.docboyz.in` and `regtechapi.in`. Do not disturb
  those vhosts.
