# Workspace SSO connections

## Purpose & Scope

Workspace SSO protocol configuration uses the Better Auth binding. Starter-owned policy, domain claims, and replacement state use audited D1 batches (ADR 0077). Keep protocol writes plugin-backed.

## Entry Points & Contracts

- Configuration permission is owner-only, including direct plugin endpoints. Admin reads stay sanitized; credentials never leave the write path.
- Domain ownership is an exact, deployment-wide claim. Unverified rows do not reserve domains. Explicit operator transfers leave a pending claim until the destination verifies a new connection.
- Workspace access checks belong in `workspace-context.ts`. Account sign-in must remain independent of Required SSO.
- Authentication proof must bind the actual session, provider, and connection generation. Neither session refresh nor a client-supplied session ID establishes authentication.

## Patterns & Pitfalls

- Metadata validation cannot substitute for a completed IdP login. Replacement tests must leave the current connection usable.
- Retiring a connection invalidates its proofs and in-flight callbacks. Required SSO stays enforced during DNS failure.
- Recovery context is available only to SSO repair endpoints. Never use it for exports, data access, or developer controls.
- Existing members and invitees can have external email domains. Verified-domain auto-join grants only member access.

For policy and recovery changes, also read [sso-policy.AGENTS.md](./sso-policy.AGENTS.md).
