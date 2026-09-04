# MCP Client Connections

## Purpose & Scope

The standing OAuth consents a user has granted to interactive MCP clients, each bound to one workspace (ADR 0068). Better Auth's OAuth provider writes the consent rows; this owns everything around them: the account list, the consent page's client description, the audit events, and revocation.

## Entry Points & Contracts

- `listForUser(userId)` is account-level, a consent naming its own workspace. A deleted workspace comes back `null` on the projection rather than dropping the row.
- `describeClient(clientId)` resolves the client behind an OAuth `client_id`, or `null`. For CIMD clients that id is the HTTPS URL of their metadata document.
- `recordGrant` writes `mcp_client.consent_granted` on its own, the consent row being an HTTP-shaped plugin write that cannot join a batch.
- `revoke` is one D1 batch: delete the consent, mark its refresh and access tokens `revoked`, and write `mcp_client.consent_revoked`. Revoking the minted tokens is the part the provider's own delete-consent endpoint skips. Ownership is part of the lookup, so a foreign consent id matches nothing, writes nothing, and returns `false`.

## Patterns & Pitfalls

- The revoked event carries `workspaceId: null` when the consented workspace is gone: the consent column is deliberately FK-free while `audit_events.workspace_id` cascades, so a dangling id would fail the whole batch.
- A consent with a `null` `referenceId` names no workspace; its tokens are matched by `IS NULL` on revoke.

## Anti-patterns

- No token issuing or consent writing here; the authorization server (`packages/auth`, `@better-auth/mcp`) owns that.
- No revoke without its audit event; the batch makes all three writes atomic, so a deleted consent with no trail is a bug.
- No workspace slug parameter; this capability is user-keyed and the workspace a connection reaches is data, not a scope.
