import type { Router } from "express";

/**
 * Type boundary for the NivaBupa module.
 *
 * The module itself is JavaScript — a byte-faithful port of the standalone
 * NivaBupa (Reassure 3.0) service, kept as JS so its verified request/response
 * behaviour is not reshaped by a TypeScript rewrite. This declaration is what
 * `tsc --noEmit` and the TS entrypoints resolve `@/nivabupa/index.js` against;
 * only the four exports tf-api actually consumes are surfaced, so the internals
 * stay private to the module.
 */

/** Every `/nivabupa/*` route. Mount at `/` and at `/health` (compatibility alias). */
export function createNivabupaRouter(): Router;

/** `GET /healthz` and `GET /readyz` — the NivaBupa service's own probes. Mount once at `/`. */
export function createNivabupaProbeRouter(): Router;

/** The single path prefix every NivaBupa route and middleware is scoped to. */
export const NIVABUPA_PATH_PREFIX: string;

/** Result of the boot-time MySQL check reported by {@link startNivabupa}. */
export type NivabupaDbStatus =
  | { ok: true; db: string; version: string }
  | { ok: false; error: string };

/**
 * Boot the module: log its route map, verify the NivaBupa MySQL connection and
 * start the stale-journey sweeper. Never throws — an unreachable database
 * degrades journey persistence without stopping the pass-through endpoints.
 */
export function startNivabupa(): Promise<NivabupaDbStatus>;

/** Stop the sweeper and drain the NivaBupa MySQL pool. Call after the HTTP server closes. */
export function stopNivabupa(): Promise<void>;
