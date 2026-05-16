# Implementation Reports

## Purpose & Scope

Workspace-scoped log of human-authored implementation reports — design docs, post-mortems, integration write-ups. Listed on the workspace home and admin dashboard. Read-only today; authoring happens out-of-band (seed fixture for the demo workspace, manual D1 inserts for live workspaces).

## Public surface

- `ImplementationReport` — `{ id, title, status, summary, createdAt }`. `status` is a free-form string today (`'draft' | 'in-review' | 'shipped'` in seed data) and not yet a schema literal.
- `ImplementationReports.list` — `readonly ImplementationReport[]` for the current `WorkspaceContext`. Newest first.

## Storage

- Table: `implementationReports` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- One row per report. No body column on the wire DTO — only `summary` is exposed. If you need to render full markdown bodies, add a `body` field and a separate `getReport(slug, id)` method to avoid bloating list payloads.

## Status & follow-ups

- Narrow `status` to a `Schema.Literals(['draft', 'in-review', 'shipped'])` once the authoring flow lands. The seed fixture already follows that vocabulary.
- Add a `create`/`update` method when the authoring UI ships. Until then, this stays read-only and reports are inserted via seed or admin SQL.

## Anti-patterns

- Don't conflate this with [`audit-event-log`](../governance/audit-event-log.AGENTS.md). Implementation reports are human-authored narratives; audit events are machine-emitted. They have different cadence, retention, and access controls.
- Don't return the full report body in list responses — keep `summary` as the only prose field.
