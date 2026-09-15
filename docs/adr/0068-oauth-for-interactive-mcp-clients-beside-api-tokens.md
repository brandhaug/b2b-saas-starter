# OAuth for member-authorized clients

Interactive MCP clients use browser consent and OAuth; automation can use workspace API tokens. The web worker issues audience-bound credentials and the API worker verifies issuer, signature, audience, and expiry. Current REST routes remain token-only. Missing OAuth configuration leaves MCP token access available.

The [accepted persistent assistant specification](https://github.com/brandhaug/b2b-saas-starter/issues/444) adds member-authorized REST for the same private conversations as the web app. Its pending implementation reuses the OAuth issuer and client connections with a distinct assistant resource/audience and explicit read/write scopes. Workspace tokens cannot access these conversations, and MCP and assistant audience tokens cannot be exchanged between resource endpoints. A workspace token's creator is attribution, not a member principal.

Each consent selects one workspace. Resource execution rereads membership, compares the immutable Workspace ID, and checks current resource grants and consent version before exposing data or suspension details. MCP writes additionally require `mcp:write`, as defined in [ADR 0072](./0072-workspace-operation-catalog.md). Connection revocation removes consent and associated credentials; existing tokens lose read and write access on their next operation.

Client metadata fetches reject unsafe hosts and redirects but cannot pin DNS resolution in Workers. Proof-of-possession tokens are refused because the resource server does not implement DPoP. Consent creation and its audit are not atomic across the plugin boundary; revocation uses one D1 batch.
