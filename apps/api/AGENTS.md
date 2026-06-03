# apps/api

Cloudflare Worker for external interfaces. Dev server on `:8787`. **Serves the `StarterApi` HttpApi contract (`@b2b-saas-starter/api`) directly** via `HttpRouter.toWebHandler` — no Hono, and no hand-maintained route table. The web app does **not** consume this; this is the surface for external clients and MCP.

## How it's wired

- `src/index.ts` — thin `fetch` that delegates to a per-isolate web handler (`getWebHandler(env)`).
- `src/http.ts` — assembles the app layer: `HttpApiBuilder.layer(StarterApi, { openapiPath: '/openapi.json' })` with the group handler layers provided in, the Scalar UI (`HttpApiScalar.layer`, `/reference`), a Workers-safe platform layer (`HttpPlatform` over a **no-op `FileSystem`** + posix `Path` + `Etag` — Workers have no Node FS), and the capability services via `HttpRouter.provideRequest`. Converted to a web handler with `HttpRouter.toWebHandler`.
- `src/handlers.ts` — one `HttpApiBuilder.group(...)` per contract group: health, workspace, api-token-registry, workspace-invitations, catalog, assistant, mcp.
- `src/env.ts` — the Cloudflare bindings type shared across the worker.

## Owned today

- **REST** — workspace-scoped routes (overview, modules, members, notifications, api-tokens, webhooks, integrations, reports, audit-events) plus token create/revoke, invitations, catalog, assistant. Paths, params, payloads, success/error schemas, and status codes all come from `packages/api` — the worker cannot drift from its own OpenAPI document.
- **Per-request `WorkspaceContext`** — workspace handlers provide `selectWorkspaceLayer(env, slug)` inline; `WorkspaceNotFound` flows through as the contract's 404. Capability methods still never receive a slug parameter.
- **OpenAPI + Scalar** — `/openapi.json` is emitted by `HttpApiBuilder` from the contract; `/reference` is served by `HttpApiScalar.layer`. No `openapi.ts`/`reference.ts` files.
- **Bearer auth** — `enforceScope(request, scope)` in `handlers.ts` reads `Authorization: Bearer …`, calls `ApiTokenRegistry.verifyBearerToken`, and fails with `Unauthorized` (401, missing token) or `AuthorizationDenied` (403, bad/insufficient token). Both are declared on every protected endpoint in the contract.
- **Rate limiting** — `enforceRateLimit(request, bucket)` over the five `src/rate-limit.ts` buckets (`rest_read`, `rest_write`, `invitations`, `assistant`, `mcp`). Failures become the contract's `RateLimited` (429).
- **MCP discovery** — `/mcp` is a contract endpoint returning a discovery document only. Do not advertise tool execution until handlers are wired through the capability layer.

## Conventions

- Behavior lives in `@b2b-saas-starter/capabilities`. Don't reach to Drizzle from this worker — call a capability. REST and MCP are interfaces over the same capability layer.
- **To add or change a route, edit the `StarterApi` contract in `packages/api` first**, then add/adjust its handler in `handlers.ts`. The contract is the single source of truth; there is no regex router to keep in sync.
- Each handler wraps its body in `observed(...)` (one canonical wide event per request via `withRequestScope`) and composes the `enforceRateLimit` / `enforceScope` guards. A guard adds only the errors it can raise, so each endpoint's error channel must be a subset of its declared contract errors.
- Cross-cutting requirements (capabilities, rate limiter, assistant, email) are request-scoped in HttpApi; provide them with `HttpRouter.provideRequest`, not `Layer.provide`.
- Local fallback: when a rate-limit binding is missing, `src/rate-limit.ts` direct-dispatches. Mirror this pattern for any new binding-dependent feature.
- Tests (`src/index.test.ts`) drive `buildWebHandler(env)` with web-standard `Request`s — the fastest way to assert routing, auth, status codes, and the served OpenAPI.
