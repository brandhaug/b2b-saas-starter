# Starter Module Catalog

## Purpose & Scope

The canonical list of Starter Modules (auth, billing, email, analytics, …) plus their per-workspace state (enabled / health / missing config). The capability is the spine of the home page: it answers "what's wired up here, and what still needs config?" Status flows downstream into [`adoption-readiness`](./adoption-readiness.AGENTS.md) and [`integration-surfaces`](../notifications/integration-surfaces.AGENTS.md).

## Public surface

- `ModuleStatus = 'ready' | 'needs-config' | 'disabled' | 'attention'` — shared status vocabulary (re-used by `IntegrationSurface`).
- `StarterModule` — `{ id, name, category, summary, docsPath, optional }`. Catalog-level fields, workspace-independent.
- `ModuleState` — `{ moduleId, enabled, status, missingConfig, updatedAt }`. Per-workspace state.
- `StarterModuleWithState` — `StarterModule & { state: ModuleState }`. The composed shape returned for workspace views.
- `StarterModuleCatalog.listModules` — `readonly StarterModuleWithState[]` for the current `WorkspaceContext`.
- `StarterModuleCatalog.listAllModules` — `readonly StarterModule[]` (no state). Powers the public docs index and marketing surfaces.

## Storage

- Tables: `starterModules` (catalog) and `workspaceModuleStates` (per-workspace overlay). Left join on `moduleId` — modules without a state row default to `{ enabled: false, status: 'disabled', missingConfig: [], updatedAt: <now> }`.
- `missingConfig` is a JSON array of env-var-shaped strings (e.g. `['STRIPE_SECRET_KEY']`) and is the source of truth for "what's blocking ready" copy in the UI.
- `status` is backed by the shared DB enum; missing state rows collapse to `'disabled'`.

## Status & follow-ups

- Add `setEnabled(slug, moduleId, enabled)` and `recomputeStatus(slug, moduleId)` mutators when the in-product toggle UI ships. Today the workspace state table is populated by seed + the background catalog refresh.
- The background catalog refresh ([`catalog-refresh-history`](./catalog-refresh-history.AGENTS.md)) should be the only writer of `status` and `missingConfig`. Avoid drift by routing manual overrides through `setEnabled` instead of direct status writes.
- Consider deriving `category` into a literal once the list stabilizes — it's a free-form string today.

## Anti-patterns

- Don't read `workspaceModuleStates` directly from routes. The capability's left-join + default-state logic is non-trivial; bypassing it produces stale "missing state" rows.
- Don't reuse `ModuleStatus` outside this package's downstream capabilities. It's a workspace-status vocabulary — not a generic "thing health" enum.
- Don't compute `score` here. That lives in [`adoption-readiness`](./adoption-readiness.AGENTS.md) so the catalog stays focused on inventory.
