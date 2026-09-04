# Workspace SSO Connections

## Purpose & Scope

Workspace-owned SSO connection lifecycle and the domain routing rule (ADR 0069): a workspace's OIDC or SAML configuration for one email domain, set by an owner in settings rather than an operator env var. The `sso` plugin owns the protocol work and the rows; writes go through the `WorkspaceSsoBinding` port, whose adapter supplies the session those endpoints need.

## Entry Points & Contracts

- Secrets are write-only, enforced here rather than in the UI: `list` / `get` expose the client id's last four and nothing else, and `describe` adds testable protocol detail while staying secret-free.
- `resolveRouting(email)` is identity-keyed and routes enabled connections only, so a disabled row renders in settings without intercepting sign-ins. The seeded example connection depends on that.
- `resolveSignInTarget` is the raw resolution, disabled answers included; the web app's `sso-sign-in-gate.ts` reads it so a disabled connection is refused at the boundary, not merely hidden.
- Audits `workspace_sso.connection_created` / `.connection_updated` / `.connection_removed`. Sign-in events (`auth.sso_sign_in`) belong to the auth catchall, the only place that can attribute a redirect-answered callback.

## Patterns & Pitfalls

- New connections are born `enabled: false, requireSso: false`, so a half-configured IdP never intercepts sign-ins. Enabling is the owner's tested decision, never a create default.
- OIDC credentials update only an OIDC connection (`protocol_mismatch`); the plugin answers the same call 400, which `callBinding` maps to `MembershipChangeRejected`.
- Domain matching is exact and case-insensitive across a comma-separated list, mirroring the plugin. An exact column value beats a list entry, ties breaking on the lowest provider id.

## Anti-patterns

- No raw `oidcConfig` / `samlConfig` in a DTO; sanitize through `toConnection` / `toDetail`.
- No `WorkspaceContext` around `resolveRouting`; it runs before any membership exists.
- No `@better-auth/sso` import here; protocol flows stay in the plugin and the app.
