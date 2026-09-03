# governance/workspace-sso-connections

## Purpose

Workspace-scoped **SSO Connection** lifecycle and the **Domain Routing** rule (ADR 0055). A connection is one workspace's identity-provider configuration for one email domain — OIDC or SAML — owned by the workspace, configured by an owner in settings, never by an operator env var.

The `sso` plugin (`@better-auth/sso`) owns the protocol work and the rows; this capability owns the workspace-scoped contract on top:

- `list` / `get` — the sanitized read. The DTO carries the client id's **last four** and nothing else: the OIDC client secret and SAML key material never compose a read path. "Secrets are write-only" is enforced here, not in the UI.
- `describe` — the connection plus its testable protocol detail (OIDC endpoints, SAML metadata XML + entry point), for the app's test step. Still secret-free.
- `create` / `update` / `remove` — through the `WorkspaceSsoBinding` port. Every plugin endpoint it wraps is session-gated and org-admin-checked; the app's adapter (`apps/web/src/lib/server/sso-binding.ts`) supplies the session via `sessionCall`. Like membership and invitations, the audit event follows the write and cannot commit with it (ADR 0051's accepted divergence).
- `resolveRouting(email)` — **identity-keyed** (no `WorkspaceContext`, like `WorkspaceInvitations.find`): the connection an email resolves to, if any. Only `enabled` connections route. A disabled row persists for the settings UI without intercepting sign-ins — the seeded example connection depends on exactly this.
- `resolveProvider(providerId)` — the auth-catchall audit's lookup: one connection's workspace + domain.

## Rules both adapters enforce

- New connections are born `enabled: false` and `requireSso: false`. An owner tests, then enables. A half-configured IdP therefore never intercepts sign-ins.
- OIDC credentials only update an OIDC connection (`protocol_mismatch`); the live plugin refuses the same call with a 400, which `callBinding` classifies as `MembershipChangeRejected`.
- Domain matching is exact and case-insensitive over a comma-separated domain list, mirroring the plugin's own `domainMatches` (`matchesEmailDomain` here).
- Routing picks the lowest `providerId` when several enabled connections match — deterministic, and the plugin's own provisioning path makes the same choice.

## Audit events

`workspace_sso.connection_created` / `.connection_updated` / `.connection_removed`, target type `workspace_sso_connection`, written through `AuditEventLog` (via `recordInWorkspace` in Live; the Seed adapter records into the shared fixture log). SSO sign-in events (`auth.sso_sign_in`) are NOT written here — they belong to the auth catchall (`apps/web/src/lib/server/auth-audit/sso-sign-in.ts`), which is the only place that can attribute a redirect-answered callback.

## Anti-patterns

- Don't read `oidcConfig` / `samlConfig` raw into a DTO. Sanitize through `toConnection`/`toDetail`; the secret stays behind the parse.
- Don't call `resolveRouting` with a `WorkspaceContext` in hand — it is identity-keyed by design and runs before any membership exists.
- Don't enable a connection in `create`. The enable toggle is the owner's tested decision, not a create-time default.
- Don't import `@better-auth/sso` here. The protocol flows stay in the plugin and the app (`sso-discovery.ts`); the binding port is structural, and this package never names Better Auth.

## Tests

- `workspace-sso-connections.test.ts` — the Seed adapter, the routing rule's pure halves, and the audit writes.
- `workspace-sso-connections.live.test.ts` — the Live adapter against real D1: scoping, sanitization, binding calls with the resolved workspace, read-backs, audits, routing.
- `packages/auth/src/sso.test.ts` — the plugin's own provisioning and role assignment over a mocked OIDC round trip.
