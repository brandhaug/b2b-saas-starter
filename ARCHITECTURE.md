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

Better Auth factory with email/password, username, GitHub OAuth readiness, TanStack Start cookies, and admin plugin support.

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
- **Logging:** Effect's `Logger` with the wide-events pattern (one canonical event per request per service). `packages/logger` exposes `withRequestScope` (opens a `Scope`, seeds annotations with `service`/`traceId`/environment/metadata, and emits a single wide event via `Effect.addFinalizer` so handler annotations propagate through), `annotateWide` (alias of `Effect.annotateLogsScoped` — handlers add business context that lands on the same wide event), `readWideEventEnvironment` (pulls `commitHash`/`serviceVersion`/`region`/`environment` from worker env + cf hints), and `WideEventLoggerLive` (a `Layer` wrapping `Logger.consoleJson`). The `TRACE_HEADER` constant + `readTraceHeader` helper keep `x-trace-id` consistent for inbound/outbound propagation (the background worker forwards it on webhook dispatches). Workers don't assemble that envelope by hand: `withHttpRequestScope({ service, event, request, env })` owns the whole HTTP recipe (trace header, env + cf-colo enrichment, `pathname`/`method` metadata) and `withTriggerScope` does the same for cron/queue triggers — a logging-format change edits `packages/logger` once. Workers build a module-scoped `ManagedRuntime` from `Layer.mergeAll(WideEventLoggerLive, …)` so the logger and rate-limiter state persist across requests within an isolate.

## Security

The auth surface spans three layers: browser session auth (Better Auth), Worker-to-Worker API tokens (scoped), and infrastructure-level allowlists (CORS + trusted origins). Several pieces are scaffolded but not yet enforced — flagged below.

### Browser auth — Better Auth

- **Library:** Better Auth, factory in [`packages/auth`](./packages/auth).
- **Plugins:** email/password, `username()`, `admin()` (system role `admin`), `tanstackStartCookies()`. GitHub OAuth is conditionally registered when `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` are set.
- **Adapter:** Drizzle SQLite over the shared D1. Schema tables: `user`, `session`, `account`, `verification` in [`packages/db/src/schema.ts`](./packages/db/src/schema.ts).
- **Cookies:** session cookie bridged through `tanstackStartCookies()`; Better Auth signs with `BETTER_AUTH_SECRET`.
- **Catchall route:** [`apps/web/src/routes/api.auth.$.ts`](./apps/web/src/routes/api.auth.$.ts) dispatches every `/api/auth/*` request to Better Auth. Rate limits are enforced through the Cloudflare `RateLimit` bindings `RATE_LIMITER_AUTH_WRITE` (POST 20 req/min) and `RATE_LIMITER_AUTH_READ` (GET 60 req/min), keyed by `cf-connecting-ip`. See [`apps/web/src/lib/rate-limit.ts`](./apps/web/src/lib/rate-limit.ts) — the per-isolate `HashMap` brake remains as a fallback for local dev.

### API tokens — workspace-scoped

- **Storage:** [`apiTokens`](./packages/db/src/schema.ts) holds `tokenHash` (never the plaintext), JSON `scopes` array, `revokedAt`, `lastUsedAt`, and `createdByUserId`. Soft-revocation via timestamp; the registry filters `isNull(revokedAt)`.
- **Scopes:** `read | write | admin` — single source of truth in [`packages/capabilities/src/developer-platform/api-token-registry.ts`](./packages/capabilities/src/developer-platform/api-token-registry.ts) (`ApiTokenScope` schema).
- **Issuance / verification:** `ApiTokenRegistry` exposes `list`, `create`, `revoke`, and `verifyBearerToken`. The API worker parses `Authorization: Bearer …`, enforces per-route scopes, and records token lifecycle audit events. Workspace REST endpoints also use per-bucket Cloudflare `RateLimit` bindings (`RATE_LIMITER_REST`, `RATE_LIMITER_REST_WRITE`, etc.) keyed by `cf-connecting-ip`.

### CORS & trusted origins

- **Web (`/api/auth/*`):** Better Auth's `trustedOrigins` list, sourced from `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated). Default fallback is `BETTER_AUTH_URL`. Parsed in [`apps/web/src/lib/server-context.ts`](./apps/web/src/lib/server-context.ts).
- **API worker:** no CORS middleware — the API is intended for Worker-to-Worker and authenticated server calls. If you expose it to browsers, add explicit `Access-Control-*` handling and an allowlist (mirror Better Auth's pattern).
- **Production deploys:** override `BETTER_AUTH_TRUSTED_ORIGINS` in [`alchemy.run.ts`](./alchemy.run.ts). Never deploy with the default placeholder.

### Authorization model

- **Workspace roles:** `owner | admin | member` — held in `workspace_members.role`.
- **System roles:** `admin | user` — held in `user.role`, surfaced via Better Auth's `admin()` plugin.
- **Status:** modeled in schema and exposed through [`WorkspaceMembership`](./packages/capabilities/src/governance/workspace-membership.ts), but **no route-level enforcement yet**. Web server functions and API endpoints don't gate on role; add middleware before shipping multi-tenant.

### Audit log

- **Schema:** [`auditEvents`](./packages/db/src/schema.ts) — `eventType`, `targetType`, `actorUserId`, `metadata` JSON.
- **Capability:** [`AuditEventLog`](./packages/capabilities/src/governance/audit-event-log.ts) exposes `list`, `listGlobal`, and `record(input)`. API-token lifecycle and webhook endpoint mutations already write audit events. Before production, add producers for sign-in failures, member role changes, billing actions, and system-admin actions.

### Secret matrix

| Secret                                        | Required    | Consumers                                             | Default if unset                                        |
| --------------------------------------------- | ----------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                          | yes         | web                                                   | `replace-before-production` placeholder — must override |
| `BETTER_AUTH_URL`                             | yes         | web                                                   | `https://b2b-saas-starter.example.com` placeholder      |
| `BETTER_AUTH_TRUSTED_ORIGINS`                 | recommended | web                                                   | falls back to `BETTER_AUTH_URL`                         |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`   | optional    | web (OAuth), web + api module status                  | OAuth disabled, integration shows needs-config          |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | optional    | web + api module status                               | billing integration shows needs-config                  |
| `SENTRY_DSN`, `POSTHOG_KEY`, `POSTHOG_HOST`   | optional    | web + api module status                               | observability module shows needs-config                 |
| `CLOUDFLARE_EMAIL_FROM`                       | optional    | deploy (alchemy), api, email, web + api module status | `SendEmail` binding skipped, email module needs-config  |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | optional    | web + api module status                               | captcha disabled, integration shows needs-config        |
| `WORKERS_AI_ENABLED`, `OPENAI_API_KEY`        | optional    | api, background                                       | AI module inactive                                      |

Secrets are wrapped in `effect/Redacted` in [`alchemy.run.ts`](./alchemy.run.ts) so they never appear in logs or stack traces. Optional providers are validated module-aware in [`packages/env/src/server.ts`](./packages/env/src/server.ts) — missing config degrades the module to inactive instead of failing startup. "Module status" consumers run `moduleConfigStatus(readServerEnv(env))` over their worker env (`apps/web/src/lib/capabilities.ts`, `apps/api/src/index.ts`) and overlay the result onto `StarterModuleCatalog` and `IntegrationSurfaces` via `withModuleEnvStatus` ([`packages/capabilities/src/layers.ts`](./packages/capabilities/src/layers.ts)), so the workspace dashboard and REST module/integration status reflect the deployed env — only var _names_ ever surface, never values.

In GitHub Actions the OAuth secrets are stored as `GH_OAUTH_CLIENT_ID` / `GH_OAUTH_CLIENT_SECRET` (GitHub forbids secret names starting with `GITHUB_`) and mapped to the `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` env vars in the deploy job of [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## Explicit Non-Goals

- No initial Durable Objects.
- No initial PWA/offline service worker.
- No initial R2/file upload workflow.
- No initial i18n framework.
- No initial realtime WebSocket/SSE transport.
