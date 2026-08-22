# workspace-lifecycle

## Purpose

Creates, renames, and hard-deletes workspaces. The write half goes through the
organization plugin via the structural `WorkspaceLifecycleBinding` port — only
`create` runs headerless (the plugin accepts a `userId` body field); rename and
delete are `requireHeaders: true`, so the app supplies the adapter with session
headers.

## Surface

- `create({ name, slug, userId })` → `CreatedWorkspace`. Identity-keyed: no
  `WorkspaceContext`, because the creator is a member of nothing yet. The
  plugin makes them the first owner; the capability reads the row back by slug.
- `rename({ name })` → `Workspace`. Per-workspace, reads the context.
- `remove` — per-workspace, hard delete. Cascades clear members, invitations,
  tokens, webhooks, deliveries; the audit event is recorded as a **system
  event** (`workspaceId: null`) so it survives its own cascade, naming the
  removed workspace in `targetId`.

Audit events: `workspace.created`, `workspace.renamed`, `workspace.deleted`
(ADR 0051 trade: recorded after the plugin write, not batched).

Failures: refusals from the plugin (taken slug) surface as
`WorkspaceChangeRejected`; no binding or store failure as
`CapabilityUnavailable`.

Seed adapter keeps created rows in a local `Ref` and refuses taken slugs
including the fixture's; optionally adds the creator to the shared roster.

## Anti-patterns

- Don't take a slug parameter on rename/remove — read `WorkspaceContext`.
- Don't record the delete's audit event against the deleted workspace id; it
  cascades away.
- Don't re-create lifecycle writes in Drizzle in the Live layer — the plugin
  owns validation, hooks, and the owner-member bootstrap.
