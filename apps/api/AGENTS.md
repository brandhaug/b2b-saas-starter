# apps/api

Cloudflare Worker for external interfaces. Dev server on `:8787`. Built on Effect HTTP API contracts (`@b2b-saas-starter/api`) — no Hono. The web app does **not** consume this; this is the surface for external clients and MCP.

## Source layout

- `src/index.ts` — worker `Env`, `starterEnv(env)`, the route runners (`runWorkspaceRoute` / `runStandaloneRoute` plus the shared `guardRoute` rate-limit → auth preamble), `handleRequest`, and the `fetch` export.
- `src/routes.ts` — the declarative `routes` table (`{ kind, method, pattern, event, bucket, scope, make }`) and `matchRoute`, a single find-loop over it. One entry per contract endpoint: `POST …/:tokenId/revoke` and `DELETE …/:tokenId` are two explicit entries — never widen an entry to accept a method/path cross-product the contract doesn't define.
- `src/handlers/workspace.ts` — the `workspaceResources` map (GET-able resources; the route table derives its path alternation from its keys), the mutation effects (token create/revoke, webhook create, invitation send), and `publishWebhookEvent`.
- `src/handlers/standalone.ts` — catalog, MCP discovery, and assistant handlers.
- `src/http.ts` — `json`, `respond`, `decodeBodyOr400` + `InvalidInput` (single 400 seam: the decode reason doubles as the wide-event `outcome` and error body), `catchInvalidInput`, `catchCapabilityUnavailable`.
- `src/auth.ts` — `bearerToken` + `authorize`.
- `src/openapi.ts` / `src/reference.ts` — OpenAPI document + Scalar reference UI.

## Owned today

- **REST** — workspace-scoped routes for overview, modules, members, notifications, api-tokens (list/create/revoke), webhooks (list/create), integrations, reports, audit-events, invitations. Workspace routes are dispatched through `runWorkspaceRoute`, which provides a `WorkspaceContext` layer (`selectWorkspaceLayer(env, slug)` from `@b2b-saas-starter/capabilities`) and converts `WorkspaceNotFound` to a 404 once at the seam — handlers don't see the slug after dispatch. GET routes require the `read` scope; mutations require `write` (webhook create) or `admin` (token create/revoke, invitations).
- **OpenAPI + Scalar** — `StarterApi` from `packages/api` is rendered via `src/openapi.ts`; reference UI mounted at `/reference` (`src/reference.ts`). Shared error statuses (401/403/429/500/503) live on the `BearerAuth` middleware's `error` union in `packages/api`; endpoints declare only endpoint-specific errors (`WorkspaceNotFound`, `InvalidWebhookUrl`).
- **Bearer auth** — `authorize(request, requiredScope, expectedWorkspaceSlug?)` (`src/auth.ts`) parses `Authorization: Bearer …`, calls `ApiTokenRegistry.verifyBearerToken(token, requiredScope)`, and short-circuits with `401 missing_bearer_token`, `401 invalid_token`, `403 insufficient_scope`, or `503 capability_unavailable`. Workspace routes additionally pass the URL slug: a valid token bound to a different workspace is rejected with `403 token_workspace_mismatch` — never let a workspace-A token unlock workspace B. All outcomes are wide-event annotated.
- **Webhook fan-out** — after audit-worthy mutations (token create/revoke, webhook create, invitation send) the handler calls `WebhookPublisher.publish` with an eventType matching the audit event type string. Publishing is best-effort (`publishWebhookEvent`): a queue outage annotates the wide event but never fails the response. The producer binding is `WEBHOOK_QUEUE` (wrangler.jsonc + alchemy.run.ts); without it the publisher no-ops.
- **Rate limiting** — `src/rate-limit.ts` is a thin config shim (bucket union, fallback limits, binding map) over `@b2b-saas-starter/rate-limit`, which owns the mechanism: binding dispatch, module-scope in-memory fallback (survives per-request layer rebuilds), degraded-mode wide-event telemetry, and `clientKey`. Five buckets bound in `wrangler.jsonc`: `rest_read`, `rest_write`, `invitations`, `assistant`, `mcp`. Choose the bucket per route-table entry, not per handler.
- **MCP discovery** — `/mcp` returns a discovery response only. Do not advertise tool execution until handlers are wired through the capability layer.

## Conventions

- Behavior lives in `@b2b-saas-starter/capabilities`. Don't reach to Drizzle from this worker — call a capability. REST and MCP are two interfaces over the same capability layer.
- Prefer Effect HTTP API contracts from `@b2b-saas-starter/api`; avoid Hono unless a specific integration forces it. The contracts in `packages/api` drive the OpenAPI document; the route table in `src/routes.ts` mirrors those endpoint paths, and `src/contract-sync.test.ts` walks every contract endpoint against the table (and the table against the contract) and fails on any path/method/scope drift — a new contract endpoint without a matching route is a red test, not a production 404.
- Request payload shapes come from the contract, not the worker: `CreateApiTokenPayload` / `CreateWebhookEndpointPayload` (from `@b2b-saas-starter/capabilities`) and `SendInvitationPayload` (from `@b2b-saas-starter/api`) are decoded via `decodeBodyOr400` — don't hand-roll a local schema or add imperative validation after decoding; tighten the schema instead so OpenAPI advertises the real rules.
- The workspace `overview` resource serves the shared `workspaceOverview` projection from `@b2b-saas-starter/capabilities` — the web dashboard composes the same projection, so don't fork the overview shape here.
- Workspace routes use `runWorkspaceRoute` so capability methods see `WorkspaceContext` directly and never receive a slug parameter. The slug→workspace resolution + `WorkspaceNotFound` → 404 mapping live in one place at the seam.
- Standalone routes use `runStandaloneRoute` with `selectCapabilitiesLayer(starterEnv(env))`. Errors handled at the runner seam (`catchInvalidInput`, `catchCapabilityUnavailable`). Keep mapping consistent with the `httpApiStatus` on each tagged error.
- Both route runners build the capabilities env through `starterEnv(env)` (`src/index.ts`), which attaches `moduleConfig` from `makeStarterEnvModuleConfig(env)` (`@b2b-saas-starter/env`, ADR 0035) so REST `modules`/`integrations` status reflects this worker's real env instead of stored fixture state. The email sender var is `CLOUDFLARE_EMAIL_FROM` end to end (alchemy, wrangler, this worker) — no remapping.
- Local fallback: when a rate-limit binding is missing, the shared rate-limit package direct-dispatches in memory. Mirror this pattern for any new binding-dependent feature.
