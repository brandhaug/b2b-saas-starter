# Architecture Overview

```text
Browser
  |
  | SSR / server functions / auth cookies
  v
apps/web — TanStack Start Worker
  |                         \
  | D1                       \ public REST / MCP
  v                          v
Cloudflare D1 <--------- apps/api — Cloudflare Worker
  ^                          |
  | queue                     | shared use cases
  |                          v
apps/background ------> packages/capabilities
       |
       v
Cloudflare Queues / Email / optional providers
```

## Components

### `apps/web`

TanStack Start web application for public showcase pages, docs, blog, FAQ, pricing, auth, workspace dashboards, settings, admin UI, and Better Auth routes. It uses shadcn/ui, Tailwind CSS v4 tokens, and seed-backed starter data in the first vertical slice.

### `apps/api`

Separate Cloudflare Worker for public REST and MCP capability interfaces. It exposes a health check, workspace reads and writes, an OpenAPI document with a Scalar reference UI, and a strictly stateless-only MCP server at `POST /mcp` (Cloudflare Agents SDK `createMcpHandler`; modern 2026-07-28 protocol only) whose tools dispatch through the same capability layer as the REST routes. The durable behavior should move through `packages/capabilities`.

### `apps/background`

Cloudflare Worker for queue-backed outbound webhook delivery. Queue handlers emit wide events and will persist delivery history through D1.

### `packages/capabilities`

Effect application layer for workspace and starter use cases. This keeps web, API, MCP, background, and tests aligned.

### `packages/db`

Drizzle ORM schema for one shared Cloudflare D1 database. Includes Better Auth/admin tables and starter-specific tables.

### `packages/auth`

Better Auth factory with email/password, username, TanStack Start cookies, and the `admin()` and `organization()` plugins. The organization plugin backs workspace membership and invitations, remapped onto the starter's `workspace` vocabulary — ADR 0051, details in [`packages/auth/AGENTS.md`](./packages/auth/AGENTS.md).

### `packages/authz`

Statements, static roles, the API-token scope mapping, and the `requirePermission` guard. Pure — no database, no auth instance — so it sits below both `auth` and `capabilities` and neither of those two imports the other. See [`packages/authz/AGENTS.md`](./packages/authz/AGENTS.md).

### `packages/email`

React Email templates and Cloudflare Email Service sending boundary. Outbound email only.

## Data Stores

- **D1** — shared relational persistence.
- **Cloudflare Queues** — retryable webhook delivery and future background fan-out. Backed by a dead-letter queue (`b2b-saas-starter-webhooks-dlq`) so messages exceeding `maxRetries` land somewhere replayable.
- **Checked-in MDX/content** — public knowledge content, search, sitemap, and LLM docs artifacts.

## Deployment & Infrastructure

- **Cloud:** Cloudflare (Workers, D1, Queues, Email Service, Rate Limiting).
- **IaC:** Alchemy v2 declared in the root [`alchemy.run.ts`](./alchemy.run.ts). Provisions the D1 database, the webhook queue + dead-letter queue, the `QueueConsumer` (with `maxRetries`, `batchSize`, `maxConcurrency`, `retryDelay`, DLQ), the `SendEmail` binding (with `allowedSenderAddresses`), and three Workers (`web`, `api`, `background`) with their bindings, redacted env, Workers Observability enabled, and `placement.mode = smart` on the worker-only services (`api`, `background`). The native `ratelimit` bindings are attached via the Worker resource's escape-hatch `bind` API since Alchemy v2 does not yet expose them as typed inputs. `bun run deploy` and `bun run destroy` invoke it directly.
- **Wrangler configs:** [`apps/{api,background,web}/wrangler.jsonc`](./apps) mirror the alchemy bindings for `wrangler dev` and `wrangler d1 migrations apply`. The specs that must agree between the two — rate-limit buckets, queue names, and queue-consumer settings — live once in [`infra/bindings.ts`](./infra/bindings.ts): alchemy imports them directly, and [`infra/bindings.test.ts`](./infra/bindings.test.ts) parses each `wrangler.jsonc` and fails red on drift. Change a spec in `infra/bindings.ts`, then update the matching `wrangler.jsonc` until the drift test passes. The `database_id: "placeholder"` literal is replaced by `wrangler ... --remote` at command time.
- **Rate limiting:** Cloudflare's native `RateLimit` binding (one per bucket, specs in [`infra/bindings.ts`](./infra/bindings.ts), attached by alchemy and mirrored in wrangler under the drift test). The runtime layer ([`apps/api/src/rate-limit.ts`](./apps/api/src/rate-limit.ts), [`apps/web/src/lib/rate-limit.ts`](./apps/web/src/lib/rate-limit.ts)) calls `binding.limit({ key })` when the binding is present and falls back to a per-isolate `HashMap` brake when it isn't (local dev/tests). Distributed limits are eventually-consistent across regions — swap to a Durable Object if you need strong consistency.
- **Webhook delivery:** The background worker's `queue` handler processes batches with `Promise.all`, calls `message.retry({ delaySeconds })` on failure (no manual `WEBHOOK_QUEUE.send` requeue), and Cloudflare delivers to `b2b-saas-starter-webhooks-dlq` after `maxRetries` (6).
- **Observability:** one seam, [`packages/logger`](./packages/logger/src/index.ts), covering wide events, traces, and metrics (ADR 0050).
  - **Wide events.** One canonical line per request per service. `withRequestScope` opens a span plus a `Scope`, seeds annotations with `service`/`traceId`/`otelTraceId`/`otelSpanId`/environment/metadata, and emits the event from `Effect.onExit` — not a scope finalizer, which runs after `annotateLogsScoped` has already restored the previous annotations and would silently drop everything handlers added. `Effect.annotateLogsScoped` (alias of `Effect.annotateLogsScoped`) is how handlers add business context to that same event. The level is `info` on success and `error` on failure, with the `Cause` attached; there is no third level. `readWideEventEnvironment` pulls `commitHash`/`serviceVersion`/`region`/`environment` from worker env + cf hints. Workers never assemble the envelope by hand: `withHttpRequestScope({ service, event, request, env })` owns the HTTP recipe and `withTriggerScope` the queue one, so a format change edits one file.
  - **Traces.** W3C `traceparent` (and B3) in and out, via `HttpTraceContext`. Inbound headers become the request span's parent; Effect's `HttpClient` injects the headers on every outbound call and spans D1 queries on the way through, so a page load is one trace from the browser request down to `sql.execute`. The queue is bridged explicitly: `WebhookPublisher` stamps `currentTraceparent` onto the message and the background consumer continues that trace instead of starting a new one. `x-trace-id` survives as the human-quotable correlation key and now defaults to the OTel trace id, so one value resolves in both the log stream and the trace backend.
  - **Metrics.** `starter.requests` (counter) and `starter.request.duration` (histogram) come off the same scope that emits the wide event, attributed by `service`/`event`/`status` only — high-cardinality dimensions belong on the event and the span.
  - **Export.** `makeOtlpLayer(service, env)` exports all three signals over OTLP/HTTP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and is `Layer.empty` when it isn't. It is provided per invocation, never per isolate — see ADR 0050. `WideEventLoggerLive` (console JSON + the tracer logger) stays isolate-level in all three workers. `apps/web` opens exactly one such scope per request in a global TanStack Start request middleware ([`src/start.ts`](./apps/web/src/start.ts)); loaders and server functions join it through `withWebRequestScope` rather than each opening their own.

## Security

The auth surface spans three layers: browser session auth (Better Auth), Worker-to-Worker API tokens (scoped), and infrastructure-level allowlists (CORS + trusted origins). Authentication and authorization are separate concerns here — who is asking is settled at the request boundary, and whether they may is settled by the guard described under [Authorization model](#authorization-model).

### Browser auth — Better Auth

- **Library:** Better Auth, factory in [`packages/auth`](./packages/auth).
- **Plugins:** email/password, `username()`, `admin()` (system role `admin`), `organization()` (workspace membership and invitations, ADR 0051), `tanstackStartCookies()` — which must stay last so other plugins' cookies reach the framework store.
- **Adapter:** Drizzle SQLite over the shared D1, using the promise-based client (`packages/db/src/client.ts`) — `drizzleAdapter` cannot take the Effect-native `Database` service. Better Auth owns seven tables in [`packages/db/src/schema.ts`](./packages/db/src/schema.ts): `user`, `session`, `account`, `verification`, plus `workspaces`, `workspace_members`, and `workspace_invitations`, which the organization plugin reaches through `modelName` overrides. Those three carry the plugin's shape — camelCase columns, epoch-integer dates, surrogate `id` keys — so a new column there needs a matching `additionalFields` entry.
- **Cookies:** session cookie bridged through `tanstackStartCookies()`; Better Auth signs with `BETTER_AUTH_SECRET`.
- **Catchall route:** [`apps/web/src/routes/api.auth.$.ts`](./apps/web/src/routes/api.auth.$.ts) dispatches every `/api/auth/*` request to Better Auth. Rate limits are enforced through the Cloudflare `RateLimit` bindings `RATE_LIMITER_AUTH_WRITE` (POST 20 req/min), `RATE_LIMITER_AUTH_SIGN_IN` (credential sign-in POST 5 req/min) and `RATE_LIMITER_AUTH_READ` (GET 60 req/min), keyed by `cf-connecting-ip`. See [`apps/web/src/lib/rate-limit.ts`](./apps/web/src/lib/rate-limit.ts) — the per-isolate `HashMap` brake remains as a fallback for local dev.

### API tokens — workspace-scoped

- **Storage:** [`apiTokens`](./packages/db/src/schema.ts) holds `tokenHash` (never the plaintext), JSON `scopes` array, `revokedAt`, `lastUsedAt`, and `createdByUserId`. Soft-revocation via timestamp; the registry filters `isNull(revokedAt)`.
- **Scopes:** `read | write | admin` — single source of truth in [`packages/capabilities/src/developer-platform/api-token-registry.ts`](./packages/capabilities/src/developer-platform/api-token-registry.ts) (`ApiTokenScope` schema).
- **Issuance / verification:** `ApiTokenRegistry` exposes `list`, `create`, `revoke`, and `verifyBearerToken`. The API worker parses `Authorization: Bearer …`, authenticates the token, checks the route's permission against the token's scopes, and records token lifecycle audit events. Workspace REST endpoints also use per-bucket Cloudflare `RateLimit` bindings (`RATE_LIMITER_REST`, `RATE_LIMITER_REST_WRITE`, etc.) keyed by `cf-connecting-ip`.

### CORS & trusted origins

- **Web (`/api/auth/*`):** Better Auth's `trustedOrigins` list, sourced from `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated). Default fallback is `BETTER_AUTH_URL`. Parsed in [`apps/web/src/lib/auth-runtime.ts`](./apps/web/src/lib/auth-runtime.ts).
- **API worker:** no CORS middleware — the API is intended for Worker-to-Worker and authenticated server calls. If you expose it to browsers, add explicit `Access-Control-*` handling and an allowlist (mirror Better Auth's pattern).
- **Production deploys:** override `BETTER_AUTH_TRUSTED_ORIGINS` in [`alchemy.run.ts`](./alchemy.run.ts). Never deploy with the default placeholder.

### Authorization model

- **Workspace roles:** `owner | admin | member` — held in `workspace_members.role`, a table Better Auth's organization plugin owns and writes (ADR 0051). Membership mutations go through the plugin's endpoints via a structural binding the app supplies; reads go direct through Drizzle so dashboard projections can join member data without an HTTP hop.
- **System roles:** `admin | user` — held in `user.role`, surfaced via Better Auth's `admin()` plugin.
- **Permissions:** [`@b2b-saas-starter/authz`](./packages/authz/AGENTS.md) owns the statement set, the static role table, the API-token scope mapping, and the `requirePermission` guard. Sessions and bearer tokens reach one `authorize()` decision.
- **Enforcement points:** `requireWorkspacePermission` (`apps/web/src/lib/server/authorize.ts`) for session-backed server functions, and `enforcePermission` (`apps/api/src/handlers.ts`) for bearer-token routes. Each endpoint names the permission it needs (`{ apiToken: ['create'] }`), never a role or a scope. Denials are `AuthorizationDenied` (403); the web boundary re-raises them as `ForbiddenError` so the calling form can show a message.
- **Reads gate as well as mutations.** A workspace loader hard-gates the page's own read permission and wraps each further segment in `whenPermitted(permission, effect)`, which yields `null` rather than failing — so a `member`'s settings payload contains no API-token count, no webhook count and no invitation list, and the dashboard payload no webhook endpoints. The read never runs, so nothing is withheld only in the markup. The payload's shape is therefore per-actor, which is why those types live in `apps/web` and not in `capabilities`.
- **The UI asks the same question.** The payload carries `viewer: { role }`; components call `viewerCan(viewer, permission)` (`apps/web/src/lib/permissions.ts`) over `@b2b-saas-starter/authz/client`, the pure client-safe entry point. A section whose data the actor cannot read is absent; an action inside a visible section is replaced by a one-line reason. Presentation only — the server still refuses the mutation.
- **No system-admin bypass:** `user.role === 'admin'` is a separate axis and confers nothing inside a workspace. The `/admin` surface keeps its own gate.
- **Still open:** the API worker cannot reach the plugin's session-bound endpoints — `removeMember`, `updateMemberRole`, and every invitation endpoint are `requireHeaders: true`, and a bearer token is no session (issue #64).
- **Decision record:** [ADR 0051](./docs/adr/0051-workspace-membership-on-better-auth-organization-plugin.md) — why the plugin, why the naming override, and where enforcement lives.

### Audit log

- **Schema:** [`auditEvents`](./packages/db/src/schema.ts) — `eventType`, `targetType`, `actorUserId`, `metadata` JSON.
- **Capability:** [`AuditEventLog`](./packages/capabilities/src/governance/audit-event-log.ts) exposes `list`, `listGlobal`, and `record(input)`. API-token lifecycle, webhook endpoint mutations, workspace lifecycle (`workspace.created` / `.renamed` / `.deleted`), membership changes (`workspace_member.added` / `.removed` / `.role_changed`), invitation lifecycle (`workspace_invitation.sent` / `.canceled` / `.accepted`) all write audit events. The auth catchall audits its own surface through one path→event table in `apps/web/src/lib/server/auth-audit.ts`: the account lifecycle (`auth.sign_in` over email or username, `auth.sign_up`, password reset, email verification, plus failures) and session end (`auth.sign_out`, `auth.session_revoked`, actor read from the request session before the handler runs), alongside the Better Auth admin mutations as `system_admin.*` success/failure pairs. The web app surfaces the trail at `/workspaces/$slug/audit`, gated by `auditLog: ['read']`. Billing writes its own events through the same capability: `billing.checkout_started` (the member who opened checkout) and `billing.plan_changed` (a system event with no user actor, written by the Stripe webhook handler alongside the `workspaces.planId` update).
- **Atomicity:** most mutating capabilities commit the row and its audit event together via `batch(db, …)`. The plugin-backed membership and invitation writes cannot — the write is an HTTP call and D1 rejects an explicit `BEGIN` — so those two audit events can diverge from their write. Accepted trade, recorded in ADR 0051.

### Secret matrix

| Secret                                             | Required    | Consumers                              | Default if unset                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ----------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                               | yes         | web                                    | local-mode default in dev; production gate refuses insecure values (below)                                                                                                                                                                                |
| `BETTER_AUTH_URL`                                  | yes         | web                                    | local-mode default in dev; production gate refuses placeholder URLs (below)                                                                                                                                                                               |
| `BETTER_AUTH_TRUSTED_ORIGINS`                      | recommended | web                                    | falls back to `BETTER_AUTH_URL`                                                                                                                                                                                                                           |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`      | optional    | deploy (alchemy)                       | checkout and the inbound webhook route stay inactive until both are set; plan display and entitlement gating work without them                                                                                                                            |
| `SENTRY_DSN`, `POSTHOG_KEY`, `POSTHOG_HOST`        | optional    | deploy (alchemy), web, api, background | env-gated providers: Sentry errors from failed wide events across all three workers + the browser (`@sentry/cloudflare`/`@sentry/react`); PostHog analytics per wide-event scope + browser (`posthog-node`/`posthog-js`). Unset, both initialize disabled |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                      | optional    | all three workers                      | no OTLP export; wide events go to Workers Logs only                                                                                                                                                                                                       |
| `OTEL_EXPORTER_OTLP_HEADERS`                       | optional    | all three workers                      | OTLP requests carry no vendor auth header                                                                                                                                                                                                                 |
| `SERVICE_VERSION`, `GIT_COMMIT_SHA`, `ENVIRONMENT` | recommended | all three workers                      | wide events and OTel resources omit the deploy identity; unset `ENVIRONMENT` also disables the required-env gate (treated as local dev)                                                                                                                   |
| `CLOUDFLARE_EMAIL_FROM`                            | optional    | deploy (alchemy), api, email, web      | `SendEmail` binding skipped, email falls back to log dispatch                                                                                                                                                                                             |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`      | optional    | deploy (alchemy), web                  | sign-up renders no widget and runs no verification (provider-light)                                                                                                                                                                                       |
| `WORKERS_AI_ENABLED`, `OPENAI_API_KEY`             | optional    | api, web, background                   | assistant answers from the mock provider: the REST/MCP endpoint stays up, the web page hides its form behind honest copy                                                                                                                                  |

Secrets are wrapped in `effect/Redacted` in [`alchemy.run.ts`](./alchemy.run.ts) so they never appear in logs or stack traces. Optional providers are validated by the schema in [`packages/env/src/server.ts`](./packages/env/src/server.ts) — missing config keeps the relevant provider inactive instead of failing startup.

The two required vars get a runtime gate: `auditRequiredEnv` ([`packages/env/src/server.ts`](./packages/env/src/server.ts)) checks `BETTER_AUTH_SECRET` for absence, known placeholder values (the local-dev default, the test-shim default, Better Auth's own fallback), or sub-32-char length, and `BETTER_AUTH_URL` for absence or placeholder hosts (`.example.com`, `localhost`). The web worker — auth's only consumer — runs it once per isolate on the first request ([`apps/web/src/lib/server/env-gate.ts`](./apps/web/src/lib/server/env-gate.ts)): with `ENVIRONMENT=production` an insecure value fails every request with `InsecureProductionEnvError`; with any other `ENVIRONMENT` value it emits one `config.insecure` wide event (key names and reasons only) and keeps serving. An unset `ENVIRONMENT` means local development and stays silent — a deployment that bypasses alchemy must set `ENVIRONMENT` to get the gate. Deploying via alchemy already fails up front when a required var is missing (`requiredEnv`); the gate catches the values alchemy cannot judge.

## Explicit Non-Goals

- No initial Durable Objects.
- No initial PWA/offline service worker.
- No initial R2/file upload workflow.
- No initial i18n framework.
- No initial realtime WebSocket/SSE transport.
