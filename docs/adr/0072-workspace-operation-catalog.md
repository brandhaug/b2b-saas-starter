# Shared workspace operation catalog

The operation catalog binds each canonical HTTP endpoint to its permission, capability call, and typed MCP exposure. REST and MCP share behavior for equivalently authorized callers, including mutations and one-time secrets. MCP adapters decode JSON inputs and invoke the catalog directly; they never fabricate an HTTP request, session, or workspace member.

Each tool checks its permission. Writes reverify API credentials, or require OAuth write scope plus the member's current role and matching consent version. Database-managed consent versions prevent revoke/re-consent or scope restoration from reviving older write tokens. Token issuance checks every permission implied by the requested scopes against the caller's authority.

Every mutation consumes the write bucket in addition to the MCP transport bucket. Tools receive no automatic retries. One-time secrets appear once in text results; expected refusals produce useful tool errors and defects receive generic messages. Tool annotations describe side effects but are not access control or confirmation guarantees.

Plugin-bound membership, authentication, account deletion, and system administration remain browser-session operations. Queue failures may occur after a test-send or replay row commits, so callers must inspect delivery state before retrying. Current tool names and input/output contracts derive from the catalog rather than a second table here.
