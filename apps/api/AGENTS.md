# apps/api

Cloudflare Worker for external interfaces. Dev server on `:8787`. Built on Effect HTTP API contracts (`@b2b-saas-starter/api`) — no Hono. The web app does **not** consume this; this is the surface for external clients and MCP.

## Owned today

- **REST** — workspace-scoped routes for overview, modules, members, notifications, api-tokens, webhooks, integrations, reports, audit-events (`src/index.ts`). Workspace routes are dispatched through `runWorkspaceRoute`, which provides a `WorkspaceContext` layer (`selectWorkspaceLayer(env, slug)` from `@b2b-saas-starter/capabilities`) and converts `WorkspaceNotFound` to a 404 once at the seam — handlers don't see the slug after dispatch.
- **OpenAPI + Scalar** — `StarterApi` from `packages/api` is rendered via `src/openapi.ts`; reference UI mounted at `/reference` (`src/reference.ts`).
- **Bearer auth** — `authorize(request, requiredScope)` parses `Authorization: Bearer …`, calls `ApiTokenRegistry.verifyBearerToken(token, requiredScope)`, and short-circuits with `401 missing_bearer_token` or `403 invalid_or_insufficient_token`. All outcomes are wide-event annotated.
- **Rate limiting** — `src/rate-limit.ts` declares five buckets bound in `wrangler.jsonc`: `rest_read`, `rest_write`, `invitations`, `assistant`, `mcp`. Choose the bucket per route, not per handler.
- **MCP discovery** — `/mcp` returns a discovery response only. Do not advertise tool execution until handlers are wired through the capability layer.

## Conventions

- Behavior lives in `@b2b-saas-starter/capabilities`. Don't reach to Drizzle from this worker — call a capability. REST and MCP are two interfaces over the same capability layer.
- Prefer Effect HTTP API contracts from `@b2b-saas-starter/api`; avoid Hono unless a specific integration forces it. The contracts in `packages/api` drive the OpenAPI document; the regex `matchRoute` here mirrors those endpoint paths.
- Workspace routes use `runWorkspaceRoute` so capability methods see `WorkspaceContext` directly and never receive a slug parameter. The slug→workspace resolution + `WorkspaceNotFound` → 404 mapping live in one place at the seam.
- Standalone routes use `runStandaloneRoute` with `selectCapabilitiesLayer(env)`. Errors handled inline via `Effect.catchTag` / `Effect.matchEffect` over `AuthorizationDenied` / `CapabilityUnavailable`. Keep mapping consistent with the `httpApiStatus` on each tagged error.
- Local fallback: when a rate-limit binding is missing, `src/rate-limit.ts` direct-dispatches. Mirror this pattern for any new binding-dependent feature.
