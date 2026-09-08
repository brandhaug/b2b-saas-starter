# Interactive Workspace isolation

[Issue #331](https://github.com/brandhaug/b2b-saas-starter/issues/331) verifies
AC-2 of the [security baseline](https://github.com/brandhaug/b2b-saas-starter/issues/329).
The tests use migrated local D1, real capability implementations, and successful
operations before attempting unauthorized access.

## Operation coverage

| Transport and test                                                                     | Positive controls                                                                                                                                                 | Denials and retained state                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Browser server handlers](../apps/web/src/lib/server/workspace-isolation.live.test.ts) | Dashboard and webhook pages for distinct Workspace owners; one user who is owner in A and member in B; webhook creation and update                                | AC-2.1/AC-2.2/AC-2.3: foreign and missing slugs return the same not-found response; foreign webhook IDs cannot update, rotate secrets, or schedule test events; selecting another Workspace's audit event returns no record; notification records and unread counts stay scoped; unauthorized dashboard sections are absent; the same session observes demotion and removal; denied calls preserve endpoint and audit data. |
| [REST](../apps/api/src/workspace-isolation-rest.live.test.ts)                          | Independent Workspace API Tokens; webhook creation; a queued test delivery; populated delivery and attempt reads; notification pagination and cursor continuation | AC-2.1/AC-2.2/AC-2.3: token/slug mismatch denies reads; foreign IDs cannot update, delete, rotate, schedule, or replay webhooks; secondary delivery and attempt reads return empty arrays; another Workspace's cursor never returns its records; foreign state, audit events, and queue-send count stay unchanged; foreign token revocation is an idempotent no-op; revoked tokens cannot read or write.                    |
| [MCP OAuth tools and resources](../apps/api/src/workspace-isolation-mcp.live.test.ts)  | Distinct users and a multi-Workspace user; signed JWTs verified with a local JWKS; read-only consent; webhook creation; overview tools and resource reads         | AC-2.1/AC-2.2/AC-2.3: foreign webhook IDs and substituted Workspace arguments cannot retarget operations; consent cannot transfer between Workspaces; current roles override JWT role claims; removal and consent revocation affect existing sessions; reassigning a slug cannot retarget an old JWT, including when the new Workspace is suspended; denied calls preserve foreign endpoint and audit data.                 |
| [Existing MCP Live coverage](../apps/api/src/mcp-live.test.ts)                         | Independent Workspace API Tokens and signed OAuth credentials                                                                                                     | Foreign endpoint/token/export IDs; API Token revocation; OAuth demotion, removal, consent version changes, and replacement; foreign audit data remains unchanged.                                                                                                                                                                                                                                                           |
| [Suspension controls](../apps/api/src/workspace-suspension.live.test.ts)               | REST tokens and MCP sessions before suspension and after reactivation                                                                                             | Authorized suspension responses, outsider nondisclosure, catalog-wide suspension gates, and the existing token-recovery exceptions.                                                                                                                                                                                                                                                                                         |

REST credentials belong to a Workspace, not a user. Distinct users and different
roles across Workspaces are therefore exercised through browser handlers and OAuth.
An error may echo the identifier supplied by the caller; it must not add protected
record fields or reveal whether that foreign identifier exists.

## Fixes retained by AC-2.4

MCP reads previously resolved the slug in a JWT without comparing its immutable
Workspace ID. Reassigning that slug could expose the new Workspace to a client
whose user belonged to both Workspaces. Reads also continued after consent was
revoked. The shared operation guard now checks Workspace ID, current consent
binding and scope, and current Member permissions for tools, resources, and writes.

Suspension used to run before the MCP authorization guard and could disclose the
new Workspace's ID through an error. It now runs after authority is established.
REST retains its suspension decision in its existing permission guard. Suspension
recovery exceptions retain the same permission-to-operation mapping.

## Running the checks

From the repository root, after `vp install`:

```bash
pnpm -C packages/i18n generate
vp test run apps/api/src/workspace-isolation-rest.live.test.ts apps/api/src/workspace-isolation-mcp.live.test.ts apps/api/src/mcp-live.test.ts apps/api/src/workspace-suspension.live.test.ts
pnpm -C apps/web exec vp test run src/lib/server/workspace-isolation.live.test.ts
pnpm run check
E2E_PORT=13331 pnpm run validate
```

Choose a free `E2E_PORT` when validating multiple worktrees. See the
[validation prerequisites](setup.md#validation).

## Evidence limits

These are representative regression tests, not an exhaustive operation or race
matrix. The browser suite injects an authenticated session at the documented
server-handler boundary. It does not test cookie issuance, browser session
revocation, or TanStack's HTTP serialization. The MCP issuer fixture signs real
JWTs but does not run browser consent, an external identity provider, or remote
JWKS networking; those have separate [issuer](../packages/auth/src/live-mcp-oauth.test.ts) and [protocol](../apps/api/src/mcp-oauth.test.ts) tests. The issuer does not support revoking an individual self-contained JWT. Revoke the MCP Client connection to stop its existing JWTs through the current-consent check.

Membership and consent changes are committed between calls. Concurrent revocation
between authorization and persistence is not covered. Queue sends are recorded by
a local test binding; external webhook receivers, deployed Cloudflare resources,
and production access policies are not exercised. Queued work and exported
artifacts belong to [AC-3](https://github.com/brandhaug/b2b-saas-starter/issues/332).
A deployment needs its own verification and retained operator evidence.
