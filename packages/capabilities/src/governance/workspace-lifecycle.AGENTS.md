# Workspace Lifecycle

## Purpose & Scope

Creates, renames, and hard-deletes workspaces through the `WorkspaceLifecycleBinding` port. Only `create` runs headerless, the plugin accepting a `userId` body field; rename and delete are `requireHeaders: true`, so the app must supply the adapter with session headers.

## Entry Points & Contracts

- `create({ name, slug, userId })` is identity-keyed, the creator being a member of nothing yet. The plugin makes them the first owner and the capability reads the row back by slug, returning the `Workspace` DTO plus `planId`.
- `remove` is a hard delete; cascades clear members, invitations, tokens, webhooks, and deliveries.
- Audits `workspace.created`, `workspace.renamed`, and `workspace.deleted`. The delete is recorded as a system event (`workspaceId: null`) naming the removed workspace in `targetId`, so it survives its own cascade.
- A 4xx from the binding, a taken slug included, is `WorkspaceChangeRejected` (409); an unwired binding or any other failure is `CapabilityUnavailable` (`no_lifecycle_binding`).

## Patterns & Pitfalls

- The Seed adapter keeps created rows in a local `Ref`, refuses taken slugs including the fixture's, and optionally adds the creator to the shared `SeedRoster` as owner.
- Contract cases assert no id shapes or rosters, because Seed fabricates identities and mints ids from `Clock`.

## Anti-patterns

- No slug parameter on rename or remove; read `WorkspaceContext`.
- No audit event for the delete recorded against the deleted workspace id; it cascades away.
- No lifecycle write re-created in Drizzle in the Live layer. The plugin owns validation, hooks, and the owner-member bootstrap.
