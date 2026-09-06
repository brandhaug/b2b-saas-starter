# Workspace API tokens

The starter includes workspace-scoped API tokens for REST and MCP access. Tokens are stored hashed, support simple scopes such as read, write, and admin, track last use, expose create and revoke UI, and emit audit events for lifecycle changes. Audit events for sensitive usage were originally required but have been removed (amended 2026-08-21): a per-request `api_token.used` event cost a second D1 write on every authenticated request and flooded the governance log with noise. `lastUsedAt` — throttled to at most one write per 60 seconds per token — is the activity signal instead. Lifecycle events (`api_token.created`, `api_token.revoked`) remain, and no mutation path may skip them.

## Expiry and replacement

API tokens can carry an `expiresAt` timestamp. Creation accepts a future,
canonical ISO UTC timestamp or no expiry. Every bearer verification reads the
stored lifecycle and refuses a revoked token or one whose expiry is at or before
that verification's clock instant. Expired tokens remain listed so an owner can
identify stale credentials; revocation removes them from the list. There is no
credential cache or scheduled expiry job.

Replacement requires the same `apiToken:create` permission as issuance. It
preserves the workspace and name, accepts only a subset of the original scopes,
and inherits expiry unless an earlier future expiry is requested. Neither
credential can gain a later expiry through replacement. A revoked, expired, or
already replaced source cannot be replaced again. The caller chooses an overlap
of 0 through 86,400 seconds. Zero retires the old credential immediately;
otherwise its expiry becomes the earlier of its existing expiry and the overlap
end. The replacement's plaintext is returned once and only its SHA-256 hash is
stored. The `replacedByTokenId` on the old token identifies its successor.

D1 commits the guarded source update, replacement insert, and
`api_token.replaced` audit record in one batch. The replacement insert obtains
its required workspace ID from the source row claimed by this replacement ID.
If a concurrent revoke or replacement invalidates the claim, that scalar
subquery returns null. The database's NOT NULL constraint rejects the insert
and rolls back the whole batch, including the source update and audit row.
A source already unavailable when read returns 409; a lost concurrent claim
returns the normal capability-unavailable 503. No automatic retry mints another
credential. The audit metadata links both IDs, the old retirement timestamp,
the replacement expiry, and its scopes. Webhook fan-out happens after commit
using the existing `api_token.created` event and never includes plaintext.

Replacement transfers a plan slot, so owners can rotate at their token ceiling.
Creation counts unrevoked, unexpired tokens that have not been replaced. Old
credentials in the bounded overlap remain usable but occupy no additional slot.

Seed stores token hashes and enforces the same creation, replacement,
revocation, expiry, and last-use rules as Live. Fixture credentials resolve by
stable token ID, independent of list order, and the local D1 seed uses that same
mapping and scope data. Seed serializes mutations and records the audit before
changing its token store, so a failed audit leaves the credential intact.

The web form guides scope narrowing and overlap selection, displays expiry and
expired states, and keeps the replacement secret visible after list refresh.
REST and the derived SDK expose replacement; the operation catalog explicitly
excludes it from MCP, as it already excludes token creation. This keeps
credential-bearing responses out of tool histories. MCP bearer verification and
token listing still enforce and expose expiry.

The interaction is inspired by [Unkey's replacement-key operation](https://www.unkey.com/docs/api-reference/v2/keys/reroll-key).
The implementation remains local to the starter's capabilities and D1.
