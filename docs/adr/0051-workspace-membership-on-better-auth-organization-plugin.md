# Workspace membership through Better Auth

Better Auth's organization plugin owns membership and invitation writes, while Drizzle reads support workspace projections. Plugin model mappings keep organization vocabulary inside `packages/auth`. Capabilities declare structural binding ports and apps supply session-bound adapters, so auth and capabilities remain sibling packages.

`packages/authz` owns permissions, static roles, and token-scope mappings. Entry points enforce named permissions; a system admin gains no workspace membership. Membership and invitation writes remain browser-session operations because fabricating a session for an API token would invent an actor and create competing authorization paths.

Plugin writes and capability audits cannot share a D1 batch, so a successful write can outlive a failed audit. This non-atomicity is an accepted integration cost. Plugin-owned schema changes must respect its model mappings and additional fields; arbitrary direct writes would bypass its lifecycle rules.
