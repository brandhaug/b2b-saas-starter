# apps/api

Cloudflare Worker for external interfaces. Dev server on `:8787`. **Serves the `StarterApi` HttpApi contract (`@b2b-saas-starter/api`) directly** via `HttpRouter.toWebHandler` — no Hono, and no hand-maintained route table. The web app does **not** consume this; this is the surface for external clients and MCP.

## How it's wired

- `src/index.ts` — thin `fetch` that delegates to a per-isolate web handler (`getWebHandler(env)`).
- `src/env.ts` — Cloudflare bindings + env type, plus `starterEnv(env)` for module-aware capability config.
- `src/http.ts` — assembles the app layer: `HttpApiBuilder.layer(StarterApi, { openapiPath: '/openapi.json' })`, the Scalar UI (`/reference`), Workers-safe platform services, and request-scoped capabilities via `HttpRouter.provideRequest`.
- `src/handlers.ts` — one `HttpApiBuilder.group(...)` per contract group: health, workspace, api-token-registry, webhook-endpoints, workspace-invitations, catalog, assistant, mcp.

## Owned today

- **REST** — workspace routes for overview, modules, members, notifications, api-tokens, webhooks, integrations, reports, audit-events, plus token create/revoke/delete, webhook create, invitations, catalog, assistant, and MCP discovery. Paths, params, payloads, success/error schemas, and status codes come from `packages/api`.
- **Per-request `WorkspaceContext`** — workspace handlers provide `selectWorkspaceLayer(starterEnv(env), slug)` inline; `WorkspaceNotFound` flows through as the contract's 404. Capability methods still never receive a slug parameter.
- **OpenAPI + Scalar** — `/openapi.json` is emitted by `HttpApiBuilder` from the contract; `/reference` is served by `HttpApiScalar.layer`. No `openapi.ts`/`reference.ts` files.
- **Bearer auth and permissions** — `enforcePermission(request, permission, expectedWorkspaceSlug?)` in `handlers.ts` reads `Authorization: Bearer ...`, calls `ApiTokenRegistry.verifyBearerToken(token)` to authenticate, then asks `requirePermission` from [`@b2b-saas-starter/authz`](../../packages/authz/AGENTS.md) whether the token's scopes cover the route's permission. Unknown or revoked tokens map to `Unauthorized` (401), a denied permission and a workspace mismatch to `AuthorizationDenied` (403), and capability outages to `CapabilityUnavailable` (503). Workspace routes pass the URL slug so a workspace-A token cannot unlock workspace B.
- **Endpoints name permissions, not scopes.** `enforcePermission(request, { apiToken: ['create'] }, params.slug)`, never `'admin'`. The scope-to-permission mapping lives in one place — `authz`'s role table — so a bearer token here and a session in the web app resolve through the same `authorize()` call.
- **Webhook fan-out** — after audit-worthy mutations (token create/revoke, webhook create, invitation send), handlers call `WebhookPublisher.publish`. Publishing is best-effort: queue outage annotates the wide event but never fails the response. The producer binding is `WEBHOOK_QUEUE`; without it the publisher no-ops.
- **Rate limiting** — `src/rate-limit.ts` is a config shim over `@b2b-saas-starter/rate-limit`. Five buckets are bound in `wrangler.jsonc`: `rest_read`, `rest_write`, `invitations`, `assistant`, `mcp`.
- **MCP discovery** — `/mcp` returns a discovery response only. Do not advertise tool execution until handlers are wired through the capability layer.

## Conventions

- Behavior lives in `@b2b-saas-starter/capabilities`. Don't reach to Drizzle from this worker.
- To add or change a route, edit the `StarterApi` contract in `packages/api` first, then add or adjust its handler in `handlers.ts`. The contract is the single source of truth.
- Each handler wraps its body in `observed(...)` and composes `enforceRateLimit` / `enforcePermission` guards. A guard adds only the errors it can raise, so each endpoint's error channel must be a subset of its declared contract errors.
- `observed(...)` is also where OpenTelemetry lives: it continues the inbound `traceparent`/`b3`, opens the server span, and provides `makeOtlpLayer('api', env)` with `Effect.provide(..., { local: true })` — a fresh exporter per request, never per isolate (ADR 0050). `http.ts` provides only `WideEventLoggerLive` at the isolate level, since it writes to the console and needs no I/O. When a handler needs a trace id to hand back to a caller (e.g. `InternalError.traceId`), read `currentTraceId` — never mint a fresh one.
- Request payload shapes come from the contract. Tighten schemas in `packages/api` or `packages/capabilities`; do not hand-roll local validation.
- Cross-cutting requirements (capabilities, rate limiter, assistant, email) are provided to the request effect with `HttpRouter.provideRequest`, not `Layer.provide`. Note what that does and does not mean: the layer is **built once** when the app layer is built, and its context is then provided to every request effect. It does not rebuild per request. Anything that must genuinely be per invocation — the OTLP exporters — goes through `Effect.provide(..., { local: true })` inside `observed` instead.
- Both route assembly and workspace routes build capability env through `starterEnv(env)` (`src/env.ts`), which attaches `moduleConfig` from `makeStarterEnvModuleConfig(env)` (`@b2b-saas-starter/env`, ADR 0035). The email sender var is `CLOUDFLARE_EMAIL_FROM` end to end, with `EMAIL_FROM_ADDRESS` accepted only as a local/back-compat alias.
- Tests (`src/index.test.ts`) drive `buildWebHandler(env)` with web-standard `Request`s — the fastest way to assert routing, auth, status codes, and the served OpenAPI.
