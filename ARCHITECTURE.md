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
  | queue / cron             | shared use cases
  |                          v
apps/background ------> packages/capabilities
       |
       v
Cloudflare Queues / Email / optional providers
```

## Components

### `apps/web`

TanStack Start web application for public showcase pages, docs, blog, FAQ, pricing, auth, workspace dashboards, settings, admin UI, and Better Auth routes. It uses shadcn/ui, Tailwind CSS v4 tokens, next-themes, and seed-backed starter data in the first vertical slice.

### `apps/api`

Separate Cloudflare Worker for public REST and MCP capability interfaces. It exposes a health check, workspace overview, OpenAPI placeholder, and MCP skeleton. The durable behavior should move through `packages/capabilities`.

### `apps/background`

Cloudflare Worker for recurring catalog refresh and queue-backed outbound webhook delivery. Cron and queue handlers emit wide events and will persist run/delivery history through D1.

### `packages/capabilities`

Effect application layer for workspace and starter use cases. This keeps web, API, MCP, background, and tests aligned.

### `packages/db`

Drizzle ORM schema for one shared Cloudflare D1 database. Includes Better Auth/admin tables and starter-specific tables.

### `packages/auth`

Better Auth factory with email/password, username, GitHub OAuth readiness, TanStack Start cookies, and the `admin()` and `organization()` plugins. The organization plugin backs workspace membership and invitations, remapped onto the starter's `workspace` vocabulary — ADR 0051, details in [`packages/auth/AGENTS.md`](./packages/auth/AGENTS.md).

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
  - **Wide events.** One canonical line per request per service. `withRequestScope` opens a span plus a `Scope`, seeds annotations with `service`/`traceId`/`otelTraceId`/`otelSpanId`/environment/metadata, and emits the event from `Effect.onExit` — not a scope finalizer, which runs after `annotateLogsScoped` has already restored the previous annotations and would silently drop everything handlers added. `annotateWide` (alias of `Effect.annotateLogsScoped`) is how handlers add business context to that same event. The level is `info` on success and `error` on failure, with the `Cause` attached; there is no third level. `readWideEventEnvironment` pulls `commitHash`/`serviceVersion`/`region`/`environment` from worker env + cf hints. Workers never assemble the envelope by hand: `withHttpRequestScope({ service, event, request, env })` owns the HTTP recipe and `withTriggerScope` the cron/queue one, so a format change edits one file.
  - **Traces.** W3C `traceparent` (and B3) in and out, via `HttpTraceContext`. Inbound headers become the request span's parent; Effect's `HttpClient` injects the headers on every outbound call and spans D1 queries on the way through, so a page load is one trace from the browser request down to `sql.execute`. The queue is bridged explicitly: `WebhookPublisher` stamps `currentTraceparent` onto the message and the background consumer continues that trace instead of starting a new one. `x-trace-id` survives as the human-quotable correlation key and now defaults to the OTel trace id, so one value resolves in both the log stream and the trace backend.
  - **Metrics.** `starter.requests` (counter) and `starter.request.duration` (histogram) come off the same scope that emits the wide event, attributed by `service`/`event`/`status` only — high-cardinality dimensions belong on the event and the span.
  - **Export.** `makeOtlpLayer(service, env)` exports all three signals over OTLP/HTTP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and is `Layer.empty` when it isn't. It is provided per invocation, never per isolate — see ADR 0050. `WideEventLoggerLive` (console JSON + the tracer logger) stays isolate-level in all three workers. `apps/web` opens exactly one such scope per request in a global TanStack Start request middleware ([`src/start.ts`](./apps/web/src/start.ts)); loaders and server functions join it through `withWebRequestScope` rather than each opening their own.

## Security

The auth surface spans three layers: browser session auth (Better Auth), Worker-to-Worker API tokens (scoped), and infrastructure-level allowlists (CORS + trusted origins). Authentication and authorization are separate concerns here — who is asking is settled at the request boundary, and whether they may is settled by the guard described under [Authorization model](#authorization-model).

### Browser auth — Better Auth

- **Library:** Better Auth, factory in [`packages/auth`](./packages/auth).
- **Plugins:** email/password, `username()`, `admin()` (system role `admin`), `organization()` (workspace membership and invitations, ADR 0051), `tanstackStartCookies()` — which must stay last so other plugins' cookies reach the framework store. GitHub OAuth is conditionally registered when `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` are set.
- **Adapter:** Drizzle SQLite over the shared D1, using the promise-based client (`packages/db/src/client.ts`) — `drizzleAdapter` cannot take the Effect-native `Database` service. Better Auth owns seven tables in [`packages/db/src/schema.ts`](./packages/db/src/schema.ts): `user`, `session`, `account`, `verification`, plus `workspaces`, `workspace_members`, and `workspace_invitations`, which the organization plugin reaches through `modelName` overrides. Those three carry the plugin's shape — camelCase columns, epoch-integer dates, surrogate `id` keys — so a new column there needs a matching `additionalFields` entry.
- **Cookies:** session cookie bridged through `tanstackStartCookies()`; Better Auth signs with `BETTER_AUTH_SECRET`.
- **Catchall route:** [`apps/web/src/routes/api.auth.$.ts`](./apps/web/src/routes/api.auth.$.ts) dispatches every `/api/auth/*` request to Better Auth. Rate limits are enforced through the Cloudflare `RateLimit` bindings `RATE_LIMITER_AUTH_WRITE` (POST 20 req/min) and `RATE_LIMITER_AUTH_READ` (GET 60 req/min), keyed by `cf-connecting-ip`. See [`apps/web/src/lib/rate-limit.ts`](./apps/web/src/lib/rate-limit.ts) — the per-isolate `HashMap` brake remains as a fallback for local dev.

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
- **No system-admin bypass:** `user.role === 'admin'` is a separate axis and confers nothing inside a workspace. The `/admin` surface keeps its own gate.
- **Still open:** loaders do not call the guard, so the UI can still offer a member an action they will be refused (issue #67). The API worker cannot reach the plugin's session-bound endpoints — `removeMember`, `updateMemberRole`, and every invitation endpoint are `requireHeaders: true`, and a bearer token is no session (issue #64).
- **Decision record:** [ADR 0051](./docs/adr/0051-workspace-membership-on-better-auth-organization-plugin.md) — why the plugin, why the naming override, and where enforcement lives.

### Audit log

- **Schema:** [`auditEvents`](./packages/db/src/schema.ts) — `eventType`, `targetType`, `actorUserId`, `metadata` JSON.
- **Capability:** [`AuditEventLog`](./packages/capabilities/src/governance/audit-event-log.ts) exposes `list`, `listGlobal`, and `record(input)`. API-token lifecycle, webhook endpoint mutations, membership changes (`workspace_member.added` / `.removed` / `.role_changed`) and invitation lifecycle (`workspace_invitation.sent` / `.canceled` / `.accepted`) all write audit events. Before production, add producers for sign-in failures, billing actions, and system-admin actions.
- **Atomicity:** most mutating capabilities commit the row and its audit event together via `batch(db, …)`. The plugin-backed membership and invitation writes cannot — the write is an HTTP call and D1 rejects an explicit `BEGIN` — so those two audit events can diverge from their write. Accepted trade, recorded in ADR 0051.

### Secret matrix

| Secret                                             | Required    | Consumers                                             | Default if unset                                        |
| -------------------------------------------------- | ----------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                               | yes         | web                                                   | `replace-before-production` placeholder — must override |
| `BETTER_AUTH_URL`                                  | yes         | web                                                   | `https://b2b-saas-starter.example.com` placeholder      |
| `BETTER_AUTH_TRUSTED_ORIGINS`                      | recommended | web                                                   | falls back to `BETTER_AUTH_URL`                         |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`        | optional    | web (OAuth), web + api module status                  | OAuth disabled, integration shows needs-config          |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`      | optional    | web + api module status                               | billing integration shows needs-config                  |
| `SENTRY_DSN`, `POSTHOG_KEY`, `POSTHOG_HOST`        | optional    | web + api module status                               | reserved activation hooks; no SDK is wired              |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                      | optional    | all three workers                                     | no OTLP export; wide events go to Workers Logs only     |
| `OTEL_EXPORTER_OTLP_HEADERS`                       | optional    | all three workers                                     | OTLP requests carry no vendor auth header               |
| `SERVICE_VERSION`, `GIT_COMMIT_SHA`, `ENVIRONMENT` | recommended | all three workers                                     | wide events and OTel resources omit the deploy identity |
| `CLOUDFLARE_EMAIL_FROM`                            | optional    | deploy (alchemy), api, email, web + api module status | `SendEmail` binding skipped, email module needs-config  |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`      | optional    | web + api module status                               | captcha disabled, integration shows needs-config        |
| `WORKERS_AI_ENABLED`, `OPENAI_API_KEY`             | optional    | api, background                                       | AI module inactive                                      |

Secrets are wrapped in `effect/Redacted` in [`alchemy.run.ts`](./alchemy.run.ts) so they never appear in logs or stack traces. Optional providers are validated module-aware in [`packages/env/src/server.ts`](./packages/env/src/server.ts) — missing config degrades the module to inactive instead of failing startup. "Module status" consumers run `moduleConfigStatus(readServerEnv(env))` over their worker env (`apps/web/src/lib/capabilities.ts`, `apps/api/src/index.ts`) and overlay the result onto `StarterModuleCatalog` and `IntegrationSurfaces` via `withModuleEnvStatus` ([`packages/capabilities/src/layers.ts`](./packages/capabilities/src/layers.ts)), so the workspace dashboard and REST module/integration status reflect the deployed env — only var _names_ ever surface, never values.

In GitHub Actions the OAuth secrets are stored as `GH_OAUTH_CLIENT_ID` / `GH_OAUTH_CLIENT_SECRET` (GitHub forbids secret names starting with `GITHUB_`) and mapped to the `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` env vars in the deploy job of [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## Explicit Non-Goals

- No initial Durable Objects.
- No initial PWA/offline service worker.
- No initial R2/file upload workflow.
- No initial i18n framework.
- No initial realtime WebSocket/SSE transport.
