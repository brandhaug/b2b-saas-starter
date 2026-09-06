# Workspace operation catalog

The operation catalog in `apps/api/src/operations.ts` owns workspace reads and
mutations shared by REST and MCP. Transport parity is the default: every
supported workspace operation is exposed to equivalently authorized callers.
Destruction, one-time secrets, and external side effects require accurate
contracts and authorization, not a read-only MCP policy.

## Shared dispatch

Each catalog row references its canonical HTTP endpoint and declares its
permission, capability call, and explicit, type-checked MCP exposure. REST
bindings preserve each row's inferred input, result, and error channel so
`HttpApiBuilder` checks them against the endpoint contract. Business behavior
stays in `packages/capabilities`.

`mcp-mutations.ts` provides an exhaustive projection over the mutation keys.
Its small typed adapters decode canonical payload schemas and JSON IDs, then
call the existing row's `run`. They never construct an HTTP request, session,
or membership. The workspace comes from the credential. HTTP path and query
codecs are not JSON argument codecs: list tools retain their numeric `limit`
schema, while REST's optional query decoder treats invalid limits as absent.

Effect is pinned to `4.0.0-rc.112`. We retain `McpServer.addTool` and JSON-text
results rather than changing the existing protocol's result representation.
One-time secrets appear in a single text result, without a duplicate structured
result. Expected capability refusals become useful `isError` tool results;
defects receive a generic message without internal details.

Stable services are captured when layers build. Each invocation resolves its
workspace, actor, and authority. The HTTP gate supplies the current origin and
rate-limit key as values, so signed export URLs use the invoking API origin
without retaining request objects across calls.

## Authorization and grants

`POST /mcp` authenticates. Every tool separately checks its catalog permission
before invoking the operation. API tokens remain confined to their workspace
and scopes; write invocations verify the credential again. OAuth writes require
an explicit `mcp:write` token scope, a current matching consent containing that
scope, and the member's current role. Existing `mcp:read` consents grant no write
access. New consent must be requested explicitly. Tokens bind to the consent ID and its database-managed version. A trigger
increments the version whenever consent scope or identity changes. Revocation,
re-consent, and scope reduction/restoration cannot revive older write tokens,
even within the same second. The issuer uses the pinned provider's claim
extension because it supplies the issuing client, unlike the legacy custom
claims callback.

The shared `requireTokenScopes` guard checks every permission a requested token
scope would grant against the creator's authority. REST and MCP use it in the
same catalog callback. In particular, a workspace admin cannot mint an `admin`
API token, whose permissions include owner-only export and workspace deletion.
API token writes retain `api_token` audit attribution; OAuth writes retain the
actual member's `user` attribution.

Every mutation invocation consumes `rest_write` before its authorization check,
in addition to the `mcp` transport bucket. A per-tool quota refusal is an MCP
`isError` result; a transport-gate refusal retains HTTP 429. Individual tool
results cannot assign independent HTTP statuses within a batched JSON-RPC request. Batching tools inside a protocol request does not bypass the
write bucket. No mutation receives automatic retries.

## Exposed mutations

The eleven existing workspace mutations are available as follows.

| Operation                         | MCP tool                             | Result and side effects                                                                                     |
| --------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `api-tokens.create`               | `create_api_token`                   | One-time plaintext token; audited, with best-effort webhook publication                                     |
| `api-tokens.replace`              | `replace_api_token`                  | One-time replacement token with narrowed scopes/expiry and bounded old-token overlap; audited and published |
| `api-tokens.delete`               | `delete_api_token`                   | Revokes a token; repeated or unknown IDs return revoked without a second audit or webhook                   |
| `webhooks.create`                 | `create_webhook`                     | Endpoint metadata; audited, with best-effort webhook publication                                            |
| `webhooks.update`                 | `update_webhook`                     | Changes URL, subscriptions, or enabled state; audited                                                       |
| `webhooks.delete`                 | `delete_webhook`                     | Removes endpoint data; audited; missing endpoints are refused                                               |
| `webhooks.rotate-secret`          | `rotate_webhook_secret`              | Returns the new signing secret once; audited; old secret has 24 hours of grace                              |
| `webhooks.test-event`             | `send_webhook_test_event`            | Saves a pending delivery and enqueues an external send                                                      |
| `webhooks.replay-delivery`        | `replay_webhook_delivery`            | Saves an audited pending copy and enqueues another external send                                            |
| `workspace-exports.request`       | `request_workspace_export`           | Saves an audited job, enqueues the archive, and notifies on completion                                      |
| `workspace-exports.download-link` | `get_workspace_export_download_link` | Returns a signed URL expiring within 15 minutes, capped by artifact retention                               |

Webhook creation's existing REST response omits the initial signing secret.
MCP preserves that response. Rotate the secret to obtain a usable signing
secret; rotation retains the previous secret during its grace period.

Missing or failed webhook queues return `CapabilityUnavailable`. Test-send and
replay may already have committed a pending delivery, so their error explains
that enqueue was not confirmed and instructs callers to inspect deliveries
before retrying. Export enqueue failure preserves the existing failed-row
behavior. URL validation, dispatch-time SSRF checks, disabled-endpoint guards,
plan ceilings, replay restrictions, rotation grace, and export expiry remain in
the capabilities.

All write tools declare all four supported annotations. Only API-token
revocation claims idempotency, because a second call has no further audit or
publication. Other mutations conservatively decline that hint. Deletion,
token replacement, endpoint updates, and rotation carry the destructive hint. All writes carry
`openWorldHint`, including operations that affect credentials, outbound
webhooks, queued work, or downloadable data. These are client hints, not access
control or a guarantee of human approval. No confirmation-token service exists.

## Boundaries and validation

System-admin operations, impersonation, account deletion, authentication
configuration, and membership/invitation mutations remain out of scope.
Better Auth's browser-session endpoints cannot be made callable by fabricating
a session or workspace member.

Tests exercise the streamable-HTTP handler, independent permission expectations,
secret results, observable mutation effects, current OAuth grants and roles,
revocation, typed refusals, audit attribution, and write-rate limiting. Existing
REST contracts, read tools, discovery, SDK types, and the permission matrix stay
under validation.
