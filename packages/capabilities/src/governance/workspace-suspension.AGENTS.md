# Workspace suspension

Workspace suspension stops product access while preserving membership, credentials, and billing state. This identity-keyed service is shared by web, REST, MCP, authentication, and background consumers.

- `transition` verifies the current System Admin role and rejects impersonation. Both actions require an internal reason; suspension also requires a customer explanation. Same-state requests produce no audit or notice.
- Live batches the state change, audit, and prepared notification rows through `auditedMutations`' transition mode, gated on a transition-id predicate; a loser reads the winner's projection back. A notice persistence failure rolls back the transition. Seed applies the same guard against its in-memory transition stamp and commits the notice rows before publishing their emails. Internal reasons remain on the workspace row and never enter public schemas, audits, or notifications.
- `requireAllowed` applies suspension policy after normal membership and RBAC checks. Recovery operation names do not confer permission. Owner-only SSO repair, permitted credential metadata/revocation, billing recovery, and security cleanup remain available.
- Product requests recheck current state; do not cache suspension in a session, API token, or MCP grant. Outsider workspace resolution must still return not found.
- Seed lifecycle and suspension share a workspace catalog so newly created, renamed, and removed workspaces have the same identity in both services. Unknown workspace IDs remain denied. `list` orders by `(name, id)` under SQLite's BINARY collation in both adapters, since the operator console renders it as-is.
- Lifecycle removal and exports enforce the policy inside their capabilities too. Signed download links recheck state. Account deletion must not delete a suspended sole-member workspace indirectly.
- Background consumers check at execution. Suppressed ordinary work is acknowledged or marked skipped, so reactivation cannot replay it. Billing, security, lifecycle notices, and cleanup continue.

The adjacent contract cases run against Seed and Live. HTTP and mounted web guards have separate boundary tests. Operator policy is in [workspace suspension](../../../../docs/workspace-suspension.md).
