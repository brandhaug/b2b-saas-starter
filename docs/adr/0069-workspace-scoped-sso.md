# ADR 0069: Workspace-scoped SSO with owner-configured connections

- Status: Accepted
- Date: 2026-09-03
- Deciders: Starter maintainers
- Tags: auth, governance, better-auth

## Context

B2B buyers increasingly refuse shared-password access to their vendors' tools: they want their identity provider (Okta, Entra ID, a regional IdP) to govern who gets in. The starter's sign-in surface was credential-only — the **Local Auth Path** — with no way for a **Workspace** owner to route their team's sign-ins through an IdP.

The constraints that shaped the decision:

1. SSO configuration is an _owner_ decision, not an operator one. A workspace owner adds, tests, and retires connections from workspace settings. There is deliberately no env var for connections — an `SSO_ISSUERS` style var would make every new customer a deploy change.
2. Better Auth's `sso` plugin (`@better-auth/sso`) already owns the hard parts: OIDC discovery and token exchange, SAML metadata parsing and assertion validation, user provisioning on first sign-in, and account linking. Reimplementing any of that in a capability would duplicate a security-critical protocol stack.
3. The repo's architecture rules still apply: business behaviour lives in `packages/capabilities` with a structural binding port onto plugin writes (ADR 0051's pattern), `packages/auth` owns only the plugin list and its schema mapping, and authorization lives in `packages/authz`.

## Decision

### 1. The `sso` plugin, mapped onto the starter's vocabulary

`packages/auth` registers `sso()` with `schema.ssoProvider.modelName = 'workspaceSsoConnections'` and `fields: { organizationId: 'workspaceId' }` — the same rename the organization plugin's `member`/`invitation` models get. The starter's own columns (`enabled`, `requireSso`, `defaultWorkspaceRole`, `createdAt`) are plugin `additionalFields`, so the plugin's register/update endpoints accept and return them. `organizationProvisioning.getRole` reads the connection's `defaultWorkspaceRole`, narrowed through `ssoProvisionedRoles` (`member | admin` — an SSO sign-in can never mint the `owner` that configures it; a bogus stored value falls back to `member`).

The plugin's `organizationId` is the Better Auth organization that backs the Workspace (ADR 0051), so provisioning joins the SSO user to that workspace with the connection's default **Workspace Role**.

### 2. The domain-routing rule

> An email whose domain matches an **enabled** connection is routed to that connection's IdP at sign-in.

- `SsoConnections.resolveRouting(email)` is identity-keyed (like `WorkspaceInvitations.find` — the asker is on the public sign-in page and is a member of nothing yet). Only `enabled` connections route, and the rule is enforced, not just honoured by the page: the plugin's `POST /sign-in/sso` would serve any stored connection, so the auth gate (`refuseDisabledConnection`, same module) refuses a request whose email, domain or provider id resolves to a **disabled** one. A disabled row persists for the settings UI without intercepting sign-ins — which is what makes the seeded example connection safe.
- The `/sign-in` page asks `resolveSsoRoutingServerFn` first and redirects to the IdP through Better Auth's `/sign-in/sso` when it answers.
- "Require SSO for this domain" is enforced server-side: `enforceSsoRequired` (in `apps/web/src/lib/server/sso-sign-in-gate.ts`) runs ahead of the auth handler on `POST /sign-in/email` and refuses the credential path with `sso_required` — the page-level routing is UX, the gate is the guarantee. Both gate refusals speak Better Auth's own error-body convention (`{ code, message }`), which is the shape the sign-in page probes.

### 3. OIDC registrations are fully hydrated at create

The plugin's register-time discovery requires the IdP's discovery URL origin to appear in `trustedOrigins` — an operator env change per customer. Instead, the app's validation step (`sso-discovery.ts`, using the plugin's own exported `fetchDiscoveryDocument`/`validateDiscoveryDocument`, which keep the SSRF guards) resolves the endpoints, and registration passes them with `skipDiscovery`. No sign-in path re-runs discovery, and adding an IdP stays an owner-only settings action. Internal IdPs on private hosts remain possible through `trustedOrigins`, documented as the escape hatch.

### 4. The capability layer and its binding

`governance/workspace-sso-connections` owns the lifecycle (`create`/`update`/`remove` via the `WorkspaceSsoBinding` port — the app's adapter in `sso-binding.ts` reaches the plugin's session-gated endpoints through `sessionCall`), the sanitized read (the OIDC client secret never composes a read path; the DTO carries the client id's last four), and `resolveRouting`/`resolveProvider`. The "test the connection" step lives in the app effects: OIDC re-resolves the issuer's discovery document, SAML re-parses the stored metadata, and a failed test notifies the workspace's owners through `NotificationFeed.record` — a broken connection is something an owner should hear about before sign-ins fail.

### 5. Governance

- **Audit Events:** `workspace_sso.connection_created` / `_updated` / `_removed` (workspace-scoped, written by the capability below its interface) and `auth.sso_sign_in` / `auth.sso_sign_in_failed` (written by the auth catchall after an SSO callback, attributed by reading the session cookie the response just set — the exchange-table rows cannot express a workspace-scoped, redirect-answered event).
- **Permissions:** a new `sso` statement (`list`, `create`, `update`, `remove`). Owner and admin hold all four; `member` holds none (connections are security posture, like the audit log); the `read` token scope reaches only `sso:list` — no token scope may rewrite how humans authenticate, the same escalation logic that keeps `apiToken:create` out of `write`.

### 6. What we deliberately did not do

- **DNS TXT domain verification** (`domainVerification`) stays off. Domain control is instead established by the owner role itself: only a workspace owner/admin can register a connection for a domain, and the plugin's own org-admin check enforces the same on its endpoints. DNS verification is a real enterprise feature (it prevents one customer claiming a domain another workspace believes it owns in a shared deployment) and a documented follow-up.
- **`defaultSSO`** (env-configured providers) stays unused — that is the operator-gated shape this ADR exists to avoid.
- **SAML single logout** stays off (`saml.enableSingleLogout` default false).

## Consequences

- One new plugin-owned table (`workspace_sso_connections`), added additively with a migration; three new permission statements; two audit namespaces.
- Connection writes are plugin-backed, so their audit events follow the write rather than committing with it — the same accepted divergence ADR 0051 records for membership and invitations.
- The plugin's session-gated endpoints double-check org admin independently of our guard; the two agree because both derive from the same role table.
- Forks wanting DNS verification can switch `domainVerification` on later; the `enabled` flag and the routing rule stay the controlling surface either way.

## References

- [ADR 0051](./0051-workspace-membership-on-better-auth-organization-plugin.md) — the organization-plugin mapping this follows and the binding-port pattern
- `packages/auth/src/index.ts` — the plugin registration
- `packages/capabilities/src/governance/workspace-sso-connections.ts` — the contract and the routing rule
- `apps/web/content/docs/governance/single-sign-on.mdx` — the user-facing walkthrough
