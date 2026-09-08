# apps/api

Cloudflare Worker for external REST clients and MCP. Serves the `StarterApi` contract from [`packages/api`](../../packages/api/AGENTS.md) through `HttpRouter.toWebHandler` (ADR 0039, 0003). `apps/web` never calls it. Transport, auth, rate limits, observability only.

## Contracts

- `src/operations.ts` catalogs workspace reads and mutations. REST handlers and the permission matrix use both; MCP tools and discovery use explicitly opted-in rows (ADR 0072).

## Changes

- Change the contract in `packages/api` first, then the handler. An endpoint's error channel stays a subset of its contract errors.
- Yield stable capability services once in the handler layer. Resolve `WorkspaceContext`, actor, request origin, and log scope per request. Translate expected domain errors at the route boundary; let contract schemas encode declared failures.
- A handler is `observed(...)` around `enforcePermission(permission, slug)` plus one capability call. Auth and the bucket come from `BearerAuth`, so no handler reads `Authorization`.
- Endpoints name permissions, never scopes. [`authz`](../../packages/authz/AGENTS.md) owns the scope-to-permission map, so a token and a web session resolve through one `authorize()`.
- `provideWorkspace` builds the only request-scoped service, `WorkspaceContext`; the rest are isolate-level, reached through `HttpRouter.provideRequest`.
- MCP JWTs use OAuth verification; other credentials use API Token verification (ADR 0068). Tokens authorize by scopes; OAuth writes require explicit `mcp:write`, current matching consent, and Member re-resolved per call. Both use the `mcp` bucket; each write also consumes `rest_write` and `guardFailureResponse`. Router middleware gates the transport; `CurrentMcpCaller` travels through Effect RPC request-fiber context to each tool. Preserve `api_token` versus OAuth `user` audit provenance.

## Boundaries

- Do not accept a JWT on a REST route; OAuth is the interactive surface only.
- Supported workspace mutations have REST/MCP parity. Keep the typed projection in `mcp-mutations.ts` exhaustive, use canonical JSON payload schemas, and call the existing catalog operation. Every write checks its permission and declares all four MCP hints (ADR 0072). Hints never guarantee approval.
- Do not add a membership or invitation endpoint: Better Auth `organization` writes are `requireHeaders: true` and a bearer token is no session (ARCHITECTURE.md, #64). That surface stays in `apps/web`, so this worker wires no `EmailDispatcher` and no `EMAIL` binding.
- No OTLP exporter at isolate level (ADR 0050): a Worker may not do I/O for a request that already ended. `withHttpInvocation` builds it per request; only `WideEventLoggerLive` is isolate-level.

## Dependencies

- [`capabilities`](../../packages/capabilities/AGENTS.md) (behavior), assistant (ADR 0008), [`authz`](../../packages/authz/AGENTS.md), [`logger`](../../packages/logger/AGENTS.md) (ADR 0007, 0050). Bucket names and fallback limits come from `@b2b-saas-starter/infra`, read alike by the generated `wrangler.jsonc` and Alchemy.
- The OAuth issuer is `apps/web`'s `@better-auth/mcp` server; `WEBHOOK_QUEUE` is consumed by [`apps/background`](../background/AGENTS.md).

## Pitfalls

- Provide the same capability layer through both `HttpRouter.provideRequest` and `Layer.provide`: `BearerAuth` and handler construction need the build context. Gate rejections emit their own wide event before the handler runs.
- A gated group with no bucket row fails closed with 503; `permission-matrix.test.ts` asserts none is missing.
- `POST /mcp` has no route permission: every credential clears `mcp:read`; enforce per tool. Keep sessions in isolate memory, initialization's `mcp-session-id`, `GET /mcp` 405, and discovery at `GET /mcp/discovery`.
- Export-download refusals are all one 404 (ADR 0055), rate-limited by client IP so signatures cannot be brute-forced.

- Token creation uses the shared `requireTokenScopes` guard. Keep requested grants bounded by caller authority on both REST and MCP.
- MCP export links use invocation origin values, never captured HTTP request objects. Queue failures are tool errors even when a pending delivery committed first; no automatic mutation retries.
