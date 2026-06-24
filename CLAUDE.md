# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Tommy & Furry v2 is a vendor insurance aggregator. It contains **two independent npm projects** (not a workspace — each has its own `package.json`, `node_modules`, and tooling):

- **`tf-api/`** — Express + TypeScript backend that adapts multiple insurer vendor APIs (Future Generali, ICICI Lombard) behind one canonical motor-insurance API. Persists with Prisma + MySQL.
- **`tf-web/`** — React 19 + Vite frontend (the customer journey UI) that consumes both `tf-api` and an existing legacy Laravel API.

The two are coupled by an OpenAPI contract: `tf-api` generates `openapi/openapi.json` from its zod schemas, and `tf-web` regenerates typed bindings from it.

## Local development

Windows-first. PowerShell orchestration scripts at the repo root bring up the whole stack (Docker MySQL → backend → frontend, each backend/frontend in its own window):

```powershell
./dev-up.ps1     # start DB, run migrations + seed, launch both dev servers
./dev-down.ps1   # stop the MySQL container (keeps data)
./dev-down.ps1 -Wipe   # stop DB and delete its data volume
```

Service URLs when running: backend `http://localhost:4000/api/v1`, frontend `http://localhost:8080`, DB `mysql://root:password@localhost:3306/tf_api_dev`.

To work in a single project, `cd` into it first — all `npm` scripts below are per-project.

### tf-api commands

```bash
npm run dev          # tsx watch, loads .env
npm run build        # tsup → dist (CJS bundle)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src
npm test             # vitest run
npm run test:watch
npx vitest run src/providers/fg/__tests__/mapper.test.ts   # single test file

npm run db:up        # docker compose up MySQL
npm run db:migrate   # prisma migrate dev
npm run db:seed      # seed masters + providers (tsx prisma/seed.ts)
npm run db:studio    # prisma studio
npm run db:import:fg # import FG master spreadsheet → DB (scripts/import-fg-master.ts)
npm run openapi:gen  # regenerate openapi/openapi.json from zod contracts
```

Tests run against a separate `tf_api_test` MySQL database (see `vitest.config.ts`); the DB must be up for suites that touch repositories. Provider integration tests use JSON fixtures (`src/providers/*/fixtures/`) and do not hit live vendor endpoints.

### tf-web commands

```bash
npm run dev          # vite (port 8080)
npm run build        # tsc -b && vite build
npm run typecheck    # tsc -b
npm run lint         # eslint .
npm test             # vitest run (jsdom; MSW for API mocking)
npm run gen:api      # regenerate typed bindings from ../tf-api/openapi/openapi.json
```

After changing any `tf-api` contract under `src/contracts/`, run `npm run openapi:gen` in `tf-api`, then `npm run gen:api` in `tf-web` to keep the frontend types in sync.

## tf-api architecture

**Layering:** `routes/v1/` → `controllers/` → `services/` → (`providers/` + `repositories/`). Routes are mounted under `/api/v1` in `src/app.ts`; `src/index.ts` is the thin HTTP entrypoint (listen + graceful shutdown).

**Provider adapter pattern** is the core abstraction:

- Every vendor implements the base `InsuranceProvider` interface (`src/providers/insurance-provider.ts`): `slug`, capability sets (`capabilities` = vehicle categories, `operations` = lifecycle ops, `motorCapabilities` = per-category plan types + add-ons), plus `getQuote`/`getFullQuote`.
- Lifecycle features beyond quoting are **optional capability interfaces** (`KycCapableProvider`, `IssuanceProvider`, `RenewalProvider`, `InspectionProvider`, `PolicyStatusProvider`, `CertificateProvider`). A provider opts in by implementing the interface **and** listing the op in its `operations` set. Controllers dispatch through the `supports*()` type-guards in that file — always gate optional calls behind the guard.
- Providers self-register into an in-memory `Map` (`provider-registry.ts`) via `registerXProvider()` calls at the top of `app.ts`. Look up by slug with `getProvider`; `compare.service.ts` fans a quote out to every eligible provider in parallel via `Promise.allSettled` so one slow/failing vendor never blocks the others.

**Per-provider folder layout** (`src/providers/fg/`, `src/providers/icici/`): `config.ts` (env → typed config + capability constants), `auth.ts` (token fetcher), `http.ts` (transport), `mapper.ts` (canonical request → vendor payload), `normalizer.ts` (vendor response → canonical result), `db-code-resolver.ts` (canonical IDs → vendor master codes), `<provider>.provider.ts` (the class), `index.ts` (`registerXProvider`). FG speaks **SOAP/XML** for motor and JSON for CKYC/renewal; ICICI uses an **AES-encrypted login → JWT**. Both providers are off by default (`FG_ENABLED` / `ICICI_ENABLED`).

**Canonical contracts** (`src/contracts/`) are zod schemas — the stable seam between providers and the rest of the app, and the single source of truth for the generated OpenAPI doc. Mappers/normalizers exist precisely so vendor-specific shapes never leak past this boundary.

**Token management** (`src/providers/token-manager.ts`): a singleton `TokenManager` owns caching + single-flight refresh; each provider supplies its own `TokenFetcher` (vendors disagree on the grant). Tokens are treated as stale at 80% of TTL. FG uses *separate* tokens per WSO2 product subscription (motor / CKYC / renewal), keyed independently in the cache.

**Data layer:** Prisma + MySQL (`prisma/schema.prisma`). Masters (`RtoMaster`, `MmvMaster`, `InsurerMaster`, `MotorAddon`) are seeded; **FG is the master data source**, so `MmvMaster.modelId` holds FG's PASIA_CODE and rows carry FG enrichment (GVW/seating/vehicle class). `Provider*Code` tables map canonical master IDs → vendor codes. `db-code-resolver.ts` does this translation in production; `passthroughCodeResolver` is used in dev/fixtures. **Premiums and money are stored as integers in paise** to avoid float rounding.

**Config & conventions:** `src/config/env.ts` validates all env via zod and fails fast at boot. **Vendor credentials are env-only — never in the DB or committed code.** See `tf-api/.env.example` for the full FG/ICICI/LiveChek/payment-gateway variable set.

**Module system:** ESM with explicit `.ts` extensions in imports and an `@/*` → `src/*` path alias (`tsconfig.json`: `allowImportingTsExtensions`, `moduleResolution: bundler`). Dev runs via `tsx`; production builds a CJS bundle via `tsup` (`@prisma/client` left external).

## tf-web architecture

React 19 + Vite + Tailwind v4, **React Router 7 data router**, TanStack Query (server state), Zustand (client state), react-hook-form + zod (forms), shadcn-style primitives in `src/components/ui/`.

- **App shell** in `src/app/`: `router/` (route table, guards, paths, layouts wiring) and `providers.tsx` (QueryClient + Toaster). Feature code lives under `src/features/<feature>/` (e.g. `auth`, `vehicle`, `cart`, `home`), each owning its pages, components, API hooks, and Zustand store.
- **Two API clients** (`src/lib/api/`): `legacyClient` → the existing Laravel API (auth, customers, cases, Zuno quotes, payments); `vendorClient` → the new `tf-api`. Both are wrapped by `attachAuthInterceptors` (injects `Bearer` token + `X-SIGNUP-ID`; a 401 triggers logout + redirect to login). Generated `tf-api` types live in `src/lib/api/generated/vendor-api.d.ts` (do not hand-edit — regenerate via `gen:api`).
- **Routing preserves legacy paths verbatim** (including legacy casing) so existing links/bookmarks/gateway redirects keep working (`src/app/router/routes.tsx`). Many routes are intentional `placeholder(...)` stubs for later phases. The fully built flow is the **vehicle-insurance wizard**: category → vehicle-details → compare → proposal → review → kyc → payment → success (two-wheeler / car / commercial journeys share these steps).
- **Auth** (`src/features/auth/auth-store.ts`): Zustand `persist` to `localStorage`, status derived (never persisted) and recomputed on hydration, cross-tab sync via the `storage` event, plus an idle-timeout logout.
- `src/lib/env.ts` validates `VITE_*` env via zod and fails fast at boot.
