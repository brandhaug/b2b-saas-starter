# Workspace lifecycle

Creates, renames, and hard-deletes workspaces through the `WorkspaceLifecycleBinding` port. Only `create` runs headerless, the plugin accepting a `userId` body field; rename and delete are `requireHeaders: true`, so the app must supply the adapter with session headers.

## Contracts

- `create({ name, slug, userId })` is identity-keyed, the creator being a member of nothing yet. The plugin makes them the first owner and the capability reads the row back by slug, returning the `Workspace` DTO plus `planId`.
- Audits `workspace.created`, `workspace.renamed`, and `workspace.deleted`. The delete is recorded as a system event (`workspaceId: null`) naming the removed workspace in `targetId`, so it survives its own cascade.

## Pitfalls

- The Seed adapter shares a workspace catalog with Seed suspension in `layers.ts`; creation, rename, and deletion update the identities suspension resolves. It refuses slugs still in that catalog and optionally adds the creator to the shared `SeedRoster` as owner.
- Contract cases assert no id shapes or rosters, because Seed fabricates identities and mints ids from `Clock`.

## Boundaries

- No slug parameter on rename or remove; read `WorkspaceContext`.
- No lifecycle write re-created in Drizzle in the Live layer. The plugin owns validation, hooks, and the owner-member bootstrap.
