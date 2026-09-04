# developer-platform/mcp-client-connections

## Purpose

The MCP Clients a user has connected through OAuth (ADR 0068): the standing
consents to interactive clients (Claude, Cursor, …), each bound to exactly one
Workspace. The consent rows themselves are written by Better Auth's OAuth
provider during the authorization flow — this capability owns everything the
starter does _around_ them: the account page's list, `describeClient` for the
consent page's "who is asking" line, the `mcp_client.consent_granted` /
`mcp_client.consent_revoked` Audit Events, and revocation, which deletes the
consent **and revokes the refresh and access tokens it minted** — something the
provider's own delete-consent endpoint does not do.

## Surface

- `describeClient(clientId)` — the client behind an OAuth `client_id`, or
  `null` when no such client is registered. For CIMD clients the id is the
  HTTPS URL of their metadata document.
- `listForUser(userId)` — every consent the user holds, newest first, with the
  client and workspace resolved. Account-level read: no `WorkspaceContext`,
  because the consent names its own workspace.
- `recordGrant(input)` — the `mcp_client.consent_granted` Audit Event. The
  consent row is the plugin's write (an HTTP-shaped call), so the event cannot
  join it in a batch — the ADR 0051 trade, again; the caller records it right
  after.
- `revoke(input)` — one D1 batch: delete the consent, mark its refresh and
  access tokens `revoked`, and write `mcp_client.consent_revoked`. Ownership is
  part of the lookup (a foreign consent id matches nothing, so nothing is
  written) and returns `false`.

## Storage

Plugin-owned tables read and written directly through Drizzle:
`oauthConsent` (the connection), `oauthClient` (the client), and the two token
tables the revoke marks. A consent with a `null` `referenceId` names no
workspace; its tokens are matched by `IS NULL` on revoke. The joined workspace
can be gone (workspace delete cascades) — the projection carries it as `null`
rather than dropping the row.

## Anti-patterns

- Don't issue tokens or write consents here — the authorization server
  (`packages/auth`, `@better-auth/mcp`) owns that; this is the management
  surface beside it.
- Don't revoke without the audit event: `batch` makes the three writes atomic,
  so "deleted consent with no trail" is a bug, not a trade-off.
- Don't take a workspace slug. This capability is user-keyed; the workspace a
  connection reaches is data, not a scope.
