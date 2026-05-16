# Adoption Readiness

## Purpose & Scope

Workspace-level "how ready is this starter to ship" metric: percent of enabled Starter Modules that report `ready`. The capability exposes the time-series trend that powers the home-page readiness card. Score math is a pure helper (`computeReadinessScore`) so other surfaces (background catalog refresh, audit events) can reuse it without instantiating the service.

## Public surface

- `ReadinessPoint = { label: string, score: number }` — a single point on the trend chart.
- `computeReadinessScore(states)` — pure helper. Returns 0–100, rounded to int. Empty input returns 0.
- `projectReadiness(states)` — pure helper. Returns `{ score, readyCount, totalCount }` for the current snapshot.
- `AdoptionReadiness.getTrend` — `readonly ReadinessPoint[]` for the current `WorkspaceContext`.

## Layers

- `SeedAdoptionReadiness(seed)` — returns the canned trend; workspace selection is provided by `WorkspaceContext`.
- `LiveAdoptionReadiness` — **stub.** Returns an empty array unconditionally; trend persistence is not yet wired into D1.

## Status & follow-ups

The live trend is a stub because there is no D1 table for readiness history yet. Two paths forward when this lands:

1. Add a `readinessHistory` table written daily by the background catalog refresh, then point the Live layer at it.
2. Compute the trend on the fly from `catalogRefreshRuns` + `workspaceModuleStates` snapshots.

Either path keeps `getTrend` shape-stable — only the Live layer changes.

## Anti-patterns

- Don't recompute the score inline in routes. Use `computeReadinessScore` or `projectReadiness` — they're the canonical math.
- Don't extend `ReadinessPoint` with module-level data. The trend is the high-level metric; per-module state lives in [`starter-module-catalog`](./starter-module-catalog.AGENTS.md).
