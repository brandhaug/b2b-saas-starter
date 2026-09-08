# OAuth for interactive MCP clients

Interactive MCP clients use browser consent and OAuth; automation can use workspace API tokens. The web worker issues audience-bound credentials and the API worker verifies issuer, signature, audience, and expiry. REST remains token-only. Missing OAuth configuration leaves MCP token access available.

Each consent selects one workspace. Tool execution rereads membership instead of trusting the role claim. Mutations also check the current grant and consent version. Connection revocation removes consent and associated credentials; write tokens also bind to a consent version, as defined in [ADR 0072](./0072-workspace-operation-catalog.md).

Client metadata fetches reject unsafe hosts and redirects but cannot pin DNS resolution in Workers. Proof-of-possession tokens are refused because the resource server does not implement DPoP. Consent creation and its audit are not atomic across the plugin boundary; revocation uses one D1 batch.
