# Catalog Refresh History

## Purpose & Scope

Run history for the background catalog refresh (the cron that re-evaluates Starter Module health, missing config, and version drift). Powers the "last 14 runs" sparkline on the admin dashboard. **The only capability today that has a write method** — the background worker calls `recordRun` after every refresh.

## Public surface

- `CatalogRefreshStatus = 'ok' | 'failed'` — schema literal.
- `CatalogRefreshRun` — `{ id, label, status, modules, durationMs, startedAt }`. `label` is a short weekday tag (`'Mon'`, `'Tue'`, …) derived from `startedAt` for chart axes.
- `CatalogRefreshHistory.listRecent` — `readonly CatalogRefreshRun[]`. Top 14 runs, newest first.
- `CatalogRefreshHistory.recordRun({ label, status, modules, durationMs, startedAt })` — appends a row. The `label` param is currently ignored by the Live layer (re-derived from `startedAt`) but kept in the shape for Seed-layer test ergonomics.
- `runCatalogRefresh` — `Effect<number, CapabilityUnavailable, StarterModuleCatalog | CatalogRefreshHistory>`. The one place the "no refresh run goes unrecorded" rule lives: captures the refresh outcome with `Effect.result`, records an ok/failed run with the real duration, re-fails on error, and resolves the refreshed module count. Every catalog-refresh entry point (`apps/background` cron and CLI) runs this instead of re-implementing the sequence.

## Storage

- Table: `catalogRefreshRuns` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- `summary` column is a JSON blob `{ modules, durationMs }`. Treat the JSON as the freeform extension point — adding fields here doesn't require a schema migration as long as the DTO stays stable.
- `id` is generated via the shared `newCapabilityId('crr')` helper (`crr_${Date.now()}_${8-byte hex}`), so concurrent runs can't collide.
- `workspaceId` is always `null` — refreshes are global. Per-workspace catalog refreshes would need a column change here.

## Status & follow-ups

- Add retention pruning: there's no cap on `catalogRefreshRuns` row count. A trim-to-90-days job belongs in the background worker.
- Consider a `failureReason` column or `summary.error` for failed runs — currently a failure tells you it failed but not why.

## Anti-patterns

- Don't expose `summary` JSON raw on the wire. Map into the DTO so the JSON shape can evolve.
- Don't call `recordRun` from request paths. This is a background-worker write — the cadence assumption matters.
