# Effect HTTP API over Hono

The API worker should prefer Effect's HTTP API stack for REST contracts and routing instead of Hono. This keeps REST definitions aligned with Effect schemas, typed errors, AtomHttpApi clients, and shared capabilities; Contributor's Hono and Scalar setup can inform the reference docs, but the starter should avoid maintaining a parallel routing model unless a specific integration requires it.

## Update: the contract is served directly (no parallel router)

The worker originally generated its OpenAPI document from `StarterApi` but routed requests through a hand-written regex `matchRoute` table that mirrored the contract's paths — a second source of truth that could silently drift from the OpenAPI document (and did: token create/revoke returned 201/202 the spec didn't declare, and `audit-events` could 404 without declaring `WorkspaceNotFound`).

`apps/api` now serves the contract itself: `HttpApiBuilder.layer(StarterApi)` + per-group handler layers, converted to a Cloudflare-compatible web handler with `HttpRouter.toWebHandler`. Routing, request/response schema decoding, status codes, OpenAPI (`/openapi.json`), and the Scalar UI (`/reference`) are all derived from the one contract. On Workers — which have no Node runtime — the platform dependency is satisfied with a no-op `FileSystem` + posix `Path` + `Etag`.

Cross-cutting concerns are composed into the handlers rather than a parallel table: a per-request wide-event scope (`observed`), bearer auth (`enforceScope` → `Unauthorized`/`AuthorizationDenied`), and rate limiting (`enforceRateLimit` → `RateLimited`). Auth (403) and assistant (503) outcomes were added to the contract's error sets so the served behavior and the OpenAPI document agree. Capability/rate-limiter services are provided per request with `HttpRouter.provideRequest`.

A related fix: `withRequestScope` in `packages/logger` emitted its canonical event from a scope finalizer that ran _after_ scoped annotations were restored (LIFO), so handler-set `annotateWide(...)` context was dropped from every wide event. It now emits via `Effect.onExit`, capturing handler annotations on all three workers.
