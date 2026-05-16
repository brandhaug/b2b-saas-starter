# Integration Surfaces

## Purpose & Scope

Workspace-scoped view of third-party connections (Slack, GitHub, Linear, Stripe, …). Each row represents one configured provider with a health status that mirrors [`starter-module-catalog`](../catalog/starter-module-catalog.AGENTS.md)'s `ModuleStatus`. Drives the Integrations tab inside the workspace shell.

## Public surface

- `IntegrationSurface` — `{ id, provider, displayName, status, summary }`. `status` reuses `ModuleStatus` (`'ready' | 'needs-config' | 'attention' | 'disabled'`) so integrations and modules can share badges, copy, and filters.
- `IntegrationSurfaces.list` — `readonly IntegrationSurface[]` for the current `WorkspaceContext`.

## Storage

- Table: `integrationConnections` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- The Live layer hard-codes `summary: ''` — the `summary` field exists in the schema but isn't yet sourced from D1. Fill this in once provider-specific summaries (e.g. "12 channels synced", "Repo: brandhaug/foo") have a place to live.
- `status` is widened defensively in the Live layer: any row whose stored status isn't one of the four literal values falls back to `'disabled'`. Tighten this once we have a constraint on the column.

## Status & follow-ups

- Add `summary` derivation — either per-provider helpers that hit the provider's API (cached) or a `summary` column populated by the OAuth handshake.
- Add `connect`/`disconnect` methods when the OAuth flow ships. Currently rows are inserted by seed or admin SQL.
- Consider sharing the `'ready' | 'needs-config' | 'attention' | 'disabled'` literal in one place — right now both `ModuleStatus` and the Live cast duplicate it.

## Anti-patterns

- Don't add provider-specific fields to `IntegrationSurface`. The DTO is intentionally provider-agnostic so the UI can render a uniform grid. Provider-specific UIs read from the provider's own service.
- Don't reuse this for OAuth tokens. Connection metadata lives here; secrets belong in `account` (Better Auth) or a dedicated `integrationCredentials` table.
