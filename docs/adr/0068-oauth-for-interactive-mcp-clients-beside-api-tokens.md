# OAuth for member-authorized clients

Interactive MCP clients use browser consent and OAuth; automation can use
Workspace API Tokens. The web Worker issues audience-bound credentials and the
API Worker verifies issuer, signature, exact audience and expiry. Ordinary REST
workspace operations keep their API Token guards.

The persistent assistant design
adds a specific member-OAuth REST resource for private conversations. It reuses
the issuer, code+PKCE flow, Workspace selection and client connections, with
`ASSISTANT_RESOURCE_URL` as a distinct audience and `assistant:read` /
`assistant:write` scopes. MCP-audience credentials fail on this resource, assistant
credentials fail on MCP, and Workspace API Tokens have no access. Token creator
attribution never becomes a member principal.

Consent selects one Workspace and explicitly grants resources and scopes.
Execution checks current membership, immutable Workspace ID, resource grants and
consent version. Resource changes invalidate older grants. Connection revocation
removes consent and associated credentials for its granted resources. MCP writes
also require `mcp:write`, as defined in [ADR 0072](./0072-workspace-operation-catalog.md).

Private conversations additionally enforce creator ownership, current permissions,
suspension and authentication assurance for reads, writes, exports and observation.
Each outgoing batch checks current authority; idle subscriptions check at least
every 15 seconds. Natural observation-credential expiry closes that subscription
but does not cancel an accepted answer. Bounded retained session proof distinguishes
natural expiry from explicit revocation; current membership, consent and assurance
still apply. A failed authority lookup closes access and interrupts the run.

Client metadata fetches reject unsafe hosts and redirects but cannot pin DNS
resolution in Workers. Proof-of-possession tokens are refused because the resource
server does not implement DPoP. Consent creation and its audit are not atomic
across the plugin boundary; revocation uses one D1 batch. Local issuer and contract
tests are separate from deployed identity-provider validation.
