# Architecture overview

```text
Browser ── SSR / server functions / auth ──> apps/web
External clients ── REST / MCP ───────────> apps/api
Queues / cron ───────────────────────────> apps/background
                                              │
All three Workers ──> packages/capabilities ────┤
                                              └──> D1 / optional providers
```

## Components

| Area                                                | Responsibility                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Web Worker](apps/web/AGENTS.md)                    | Public content, authenticated UI, server functions, and Better Auth endpoints. Calls capabilities in-process.                       |
| [API Worker](apps/api/AGENTS.md)                    | REST, OpenAPI/Scalar reference, and stateful streamable-HTTP MCP. Both interfaces dispatch through the workspace operation catalog. |
| [Background Worker](apps/background/AGENTS.md)      | Webhook delivery, workspace exports, billing reconciliation, and notification email.                                                |
| [Capabilities](packages/capabilities/AGENTS.md)     | Business use cases with Effect contracts and equivalent Seed/Live adapters.                                                         |
| [Billing](packages/billing/AGENTS.md)               | Stripe projections, checkout recovery, subscription lifecycle, and resource entitlements.                                           |
| [Database](packages/db/AGENTS.md)                   | Drizzle schema and migrations for shared D1 persistence.                                                                            |
| [Auth](packages/auth/AGENTS.md)                     | Better Auth configuration and structural callback ports.                                                                            |
| [Authorization](packages/authz/AGENTS.md)           | Permissions, workspace/system roles, token scope mapping, and guards. No database or auth-instance dependency.                      |
| [Email](packages/email/AGENTS.md)                   | Templates and the outbound sending boundary.                                                                                        |
| [Email delivery](packages/email-delivery/AGENTS.md) | Send claims and sanitized delivery evidence for auth, invitations, and notifications.                                               |
| [HTTP contract](packages/api/AGENTS.md)             | The `StarterApi` Effect HTTP contract every REST and MCP surface derives from.                                                      |
| [Environment](packages/env/AGENTS.md)               | `ServerEnv` as the one env schema, plus the pure required-env and transport-security audits.                                        |
| [Observability](packages/logger/AGENTS.md)          | Wide events, traces, RED metrics, and per-invocation OTLP export for all three Workers.                                             |
| [Localization](packages/i18n/AGENTS.md)             | Message catalogs, Paraglide compilation, and locale resolution for the web app and emails.                                          |

Auth and capabilities are siblings; neither imports the other. Apps provide structural bindings to plugin-backed capabilities. Route handlers and components gate access and adapt transport data; business behavior belongs in capabilities.

The public `/demo` preview renders shared application pages with synthetic data.
Its forms and dialogs are inspectable, but actions return a preview explanation
without calling authenticated operations. It does not read live privileged
records or persist simulated changes. See the [showcase decision](docs/adr/0016-homepage-as-architecture-showcase.md).

### Billing lifecycle and entitlements

Stripe owns the verified subscription and price; application membership determines Seat Quantity. D1 retains subscription, payment, cancellation, and synchronization evidence. Access uses the Effective Plan evaluated at request time, so stale stored state cannot extend paid access during an outage.

Previously paying subscriptions get a fixed seven-day renewal grace period. An unconverted trial expires without grace; unpaid or canceled subscriptions end paid access sooner. Recovery restores subscribed entitlements without lifting independent administrative suspension.

When the effective plan is Starter, members and stored resources remain. The
three-member seat rule is soft. API-token and webhook categories over their
Starter limits use a Resource Selection, an owner/admin-selected set of two
token slots and one webhook slot. The selection is a logical allow-list over
current eligible resources. Token verification, REST/MCP authorization, and
queued webhook dispatch re-check it at execution time, so existing credentials
and queued work cannot bypass a downgrade. Creation admission reads the same
deadline-aware Billing decision through Resource entitlements, which owns admission
counts as well as execution eligibility. Token admission counts current unrevoked,
unexpired replacement leaves. Webhook admission counts all stored endpoints,
while dispatch eligibility considers enabled endpoints. Lifecycle and audit/outbox
commits do not wait for notice delivery. See [billing decisions](docs/adr/0076-billing-lifecycle-and-entitlement-decisions.md)
and [operator procedures](docs/billing-operator-runbook.md).

## Data stores

- D1 holds application and authentication state for every Workspace. Restores affect the whole service.
- Cloudflare Queues carry webhook, export, billing, and instant-notification work. Webhooks and billing have dead-letter consumers. Durable application records retain outcomes and support recovery.
- Optional R2 stores gzipped JSON workspace exports with seven-day retention. There is no general file-upload workflow.
- Checked-in MDX supplies public articles and navigation metadata. LLM summaries are static public files maintained alongside the articles.

## Deployment & Infrastructure

[alchemy.run.ts](alchemy.run.ts) provisions Workers, D1, queues, optional providers, and bindings. [infra/bindings.ts](infra/bindings.ts) owns resource names, rate-limit specifications, and cron schedules. Generated Wrangler configs support local development and database commands; change the source specifications and run `pnpm run infra:wrangler`.

Each stage has isolated resources. `pr-<number>` stages disable optional providers and use public demo credentials; they must contain only synthetic data. The [preview workflow](.github/workflows/preview.yml) deploys and removes them with the PR lifecycle. Production deploys after CI/E2E on `master`, or through manual dispatch. See [deployment setup](docs/deploying.md).

### Observability

[packages/logger](packages/logger/AGENTS.md) owns one wide event per request or job, trace propagation, and request metrics. Handlers add business context to the existing scope. Queue messages carry trace context across the asynchronous boundary.

Console logging stays available without providers. Configured OTLP export is scoped per invocation so background export work does not outlive the Worker request. Sentry supplies independent operational alerts; PostHog supplies optional analytics. [Monitoring](docs/monitoring.md) owns metric names, monitor configuration, and response thresholds.

### Recovery operations

The [operations runbook](docs/operations.md) covers system-wide maintenance, shared-D1 recovery, independent encrypted backups and security evidence, and external-state reconciliation before reopening. Backups and queue monitors run outside the application Workers. Customer deployments require an isolated drill; repository reset and migration-squash policies apply only to disposable data.

Routine record cleanup follows the approved [retention policy](docs/retention.md). Administrative workspace suspension is an independent access control; its rules are documented in the [workspace suspension policy](docs/workspace-suspension.md).

## Security

Request boundaries authenticate the caller, resolve workspace membership, and check permissions before calling capabilities. UI visibility is never the enforcement boundary.

### Browser auth

Better Auth provides password, username, magic-link, email-code, passkey, social, and workspace SSO sign-in; TOTP; and MCP OAuth consent. The [auth intent node](packages/auth/AGENTS.md) owns plugin ordering and session constraints.

System Admin and Workspace owner/admin access require session-bound password plus verified TOTP, or server-verified user-verifying passkey authentication. Enforcement rereads current session and factor evidence, including for privileged MCP clients. See [privileged authentication and recovery](docs/strong-authentication.md).

The auth catchall applies rate limiting, Turnstile where configured, SSO enforcement, impersonation restrictions, and audit capture. Cloudflare rate-limit bindings use `cf-connecting-ip`; local development and tests use the in-memory fallback. Production required-env checks reject insecure auth configuration.

SSO connections belong to Workspaces. The app enforces enabled/required status at the auth boundary. Provisioning can assign member or admin, never owner. See [SSO decision](docs/adr/0069-workspace-scoped-sso.md) for domain-verification limitations.

### API tokens and MCP OAuth

API Tokens belong to one Workspace. Only token hashes are stored; verification checks revocation, expiry, and resource entitlements. REST is token-only.

MCP also accepts OAuth access tokens issued by the web Worker. The API verifies issuer and audience, re-resolves membership, and checks the immutable Workspace ID and current consent before reads, resources, and writes. Consent binds a client to one Workspace. Both credentials use the same operation catalog and permission checks. [Interactive isolation coverage](docs/security-workspace-isolation.md) records tested operations and evidence limits. See [API tokens](docs/adr/0026-workspace-api-tokens.md) and [MCP OAuth](docs/adr/0068-oauth-for-interactive-mcp-clients-beside-api-tokens.md).

### CORS & trusted origins

Better Auth uses `BETTER_AUTH_TRUSTED_ORIGINS`, falling back to `BETTER_AUTH_URL`. Configure the deployed browser origin. The API has no CORS middleware and targets authenticated server clients; browser access requires an explicit origin allowlist and CORS handling.

### Authorization model

Workspace roles are owner, admin, and member. System admin is a separate role and grants no workspace bypass. Impersonation uses the target user's permissions and blocks credential changes.

[authz](packages/authz/AGENTS.md) owns one permission decision for sessions, API tokens, and MCP principals. Every endpoint names a permission. Workspace resolution conceals unknown and inaccessible workspaces with the same error.

Loaders gate their primary read and omit unauthorized secondary reads before execution. Their actor-specific payload types live in the web app. Components use the same permissions for presentation; server functions recheck every mutation.

Plugin-backed workspace mutations require session bindings. The API cannot substitute a bearer token for the plugin's required session headers; unsupported operations remain outside its catalog.

### Audit log

[AuditEventLog](packages/capabilities/src/governance/audit-event-log.AGENTS.md) persists security and business events. D1-backed mutations batch their state change with the audit event. Plugin-backed mutations cannot share that transaction, so their audit write may diverge; [ADR 0051](docs/adr/0051-workspace-membership-on-better-auth-organization-plugin.md) records the trade-off. The boundary inventory is:

- D1-owned capability writes use `auditedMutations`: the state statements and audit insert are one D1 batch, so an audit failure rolls back the mutation.
- Better Auth plugin writes for memberships, invitations, workspace lifecycle, SSO, account deletion, and MCP consent complete first and then use `recordCompletedAudit`. A failed audit is reported as `audit_write_gap` with safe operation and identity references; the completed plugin result remains the caller-visible result.
- Auth catchall exchanges and provider callbacks use their existing best-effort audit ports. Their failure outcome is `dropped` with `authAuditError` or `authAuditBodyError` on the wide event, and the application logs the dropped record.

The post-action paths do not promise reconstruction from the application audit table. Operators use the mutation's provider or plugin state, request or trace references, and the `audit_write_gap` signal to investigate; they append a corrected event only when the completed action can be established, otherwise they record an uncertain gap and restrict access where the action was security-sensitive.

Independent deletion and revocation evidence prevents a database restore from silently reopening revoked access. [Recovery procedures](docs/operations.md#independent-security-evidence-store) define its external contract and gap handling.

### Secret matrix

[packages/env/src/server.ts](packages/env/src/server.ts) owns validated server configuration and provider activation. [.env.example](.env.example) provides local defaults; the [provider guide](apps/web/content/docs/getting-started/optional-providers.mdx) explains configuration, and [deployment](docs/deploying.md) covers CI secret forwarding.

Alchemy wraps secrets in `Redacted`. Production auth requires a secure `BETTER_AUTH_SECRET` and HTTPS `BETTER_AUTH_URL`; runtime checks reject placeholders. Deployments outside Alchemy must set `ENVIRONMENT=production` to enable production enforcement. Optional providers remain inactive when unconfigured. Configured-provider failures retain their typed failure behavior rather than silently switching to demo data.

## Internationalization

[packages/i18n](packages/i18n) shares English and Norwegian Bokmål catalogs across web and email. Public URLs identify locale; account preferences govern authenticated pages, recipient email, and time-zone display. Request-local state isolates concurrent renders. See [contribution rules](docs/i18n.md).

## Explicit Non-Goals

No Durable Objects without a coordination need, PWA/offline service worker, general uploads, or realtime WebSocket/SSE transport. Revisit these only for a concrete Starter use case.
