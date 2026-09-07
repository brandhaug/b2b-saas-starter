# ADR 0069: Workspace-scoped SSO with owner-configured connections

Workspace owners configure OIDC or SAML connections in settings. Better Auth's `sso` plugin handles discovery, exchanges, assertion validation, and account linking. Its provider model maps to `workspaceSsoConnections`, with `organizationId` mapped to `workspaceId`.

Protocol registration, credential updates, and deletion go through `WorkspaceSsoBinding`. OIDC registration supplies validated endpoints with `skipDiscovery`, so a new public IdP does not require an operator to change trusted origins. The validation path uses the plugin's discovery helpers and SSRF checks. SAML single logout remains disabled.

Connections start disabled. Metadata validation helps diagnose configuration errors but does not prove that a person can authenticate. Activation requires domain verification and a completed IdP login. Owners control configuration; admins receive sanitized reads. Client secrets and raw credential configuration never appear in the connection DTO.

[ADR 0077](./0077-workspace-sso-policy-and-domain-claims.md) defines exact-domain claims, workspace-scoped enforcement, admission, atomic replacement, and recovery. It replaces the original domain-based password gate and unrestricted SSO auto-provisioning from this decision.

Protocol-write audit records follow successful plugin calls, retaining ADR 0051's accepted audit trade-off. Starter-owned policy changes commit with their audit records in D1 batches.

See [the organization-plugin binding decision](./0051-workspace-membership-on-better-auth-organization-plugin.md) and [the SSO guide](../../apps/web/content/docs/governance/single-sign-on.mdx).
