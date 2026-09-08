# OAuth for interactive MCP clients

Interactive MCP clients use browser consent and OAuth; automation can use workspace API tokens. The web worker issues audience-bound credentials and the API worker verifies issuer, signature, audience, and expiry. REST remains token-only. Missing OAuth configuration leaves MCP token access available.

Each consent selects one workspace. Tool and resource execution reread membership, compare the immutable Workspace ID, and check the current grant and consent version before exposing data or suspension details. Writes additionally require `mcp:write`, as defined in [ADR 0072](./0072-workspace-operation-catalog.md). Connection revocation removes consent and associated credentials; existing tokens lose read and write access on their next operation.

Client metadata fetches reject unsafe hosts and redirects but cannot pin DNS resolution in Workers. Proof-of-possession tokens are refused because the resource server does not implement DPoP. Consent creation and its audit are not atomic across the plugin boundary; revocation uses one D1 batch.
