# apps/api

## Purpose & Scope

Cloudflare Worker for external REST clients and MCP. Serves the `StarterApi` contract from [`packages/api`](../../packages/api/AGENTS.md) through `HttpRouter.toWebHandler` (ADR 0039, 0003). `apps/web` never calls it. Transport, auth, rate limits, observability only.

## Entry Points & Contracts

- `src/operations.ts` is the one table of workspace reads: REST handlers, MCP tools, the discovery document and the permission matrix derive from it.
- `src/request-guards.ts` holds every guard; compose these instead of a second auth path.

## Usage Patterns

- Change the contract in `packages/api` first, then the handler. An endpoint's error channel stays a subset of its contract errors.
- A handler is `observed(...)` around `enforcePermission(permission, slug)` plus one capability call. Auth and the bucket come from `BearerAuth`, so no handler reads `Authorization`.
- Endpoints name permissions, never scopes. [`authz`](../../packages/authz/AGENTS.md) owns the scope-to-permission map, so a token and a web session resolve through one `authorize()`.
- `provideWorkspace` builds the only request-scoped service, `WorkspaceContext`; the rest are isolate-level, reached through `HttpRouter.provideRequest`.
- Two credentials open `/mcp` (ADR 0068): a JWT goes to the OAuth verifier, anything else to the API Token path. A token authorizes as its scopes, an OAuth caller as the Member re-resolved per call, so removals and role changes apply at once. Both draw the `mcp` bucket and reject via `guardFailureResponse`. The gate is route-scoped router middleware around Effect `McpServer.layerHttp`'s routes (`mcp.ts`), because the transport owns the handlers; the verified caller travels to tool handlers as the `CurrentMcpCaller` reference, which Effect's RPC plumbing merges into every invocation from the request fiber.

## Anti-patterns

- No hand-rolled validation; tighten the schema. No minted trace ids; read `currentTraceId`.
- Do not accept a JWT on a REST route; OAuth is the interactive surface only.
- Do not add a membership or invitation endpoint: Better Auth `organization` writes are `requireHeaders: true` and a bearer token is no session (ARCHITECTURE.md, #64). That surface stays in `apps/web`, so this worker wires no `EmailDispatcher` and no `EMAIL` binding.
- No OTLP exporter at isolate level (ADR 0050): a Worker may not do I/O for a request that already ended. `withHttpInvocation` builds it per request; only `WideEventLoggerLive` is isolate-level.

## Dependencies & Edges

- [`capabilities`](../../packages/capabilities/AGENTS.md) (behavior), assistant (ADR 0008, 0071), [`authz`](../../packages/authz/AGENTS.md), [`logger`](../../packages/logger/AGENTS.md) (ADR 0007, 0050). Bucket names and fallback limits come from `@b2b-saas-starter/infra`, read alike by the generated `wrangler.jsonc` and Alchemy.
- The OAuth issuer is `apps/web`'s `@better-auth/mcp` server; `WEBHOOK_QUEUE` is consumed by [`apps/background`](../background/AGENTS.md).

## Patterns & Pitfalls

- The capability layer value is `HttpRouter.provideRequest`ed **and** `Layer.provide`d to the api layer, because `BearerAuth` resolves services from the group layers' build context. One value, one build, one shared instance. The gate runs before the handler body, so rejections emit their own wide event.
- A gated group with no bucket row fails closed with 503; `permission-matrix.test.ts` asserts none is missing.
- `POST /mcp` has no route-level permission check by design: every minted credential clears `mcp:read`, so a gate could never deny. Enforcement is per tool. The transport is sessionful (initialize mints an `mcp-session-id`; sessions live in isolate memory), `GET /mcp` answers 405, and the REST discovery document the contract serves is at `GET /mcp/discovery`.
- `makeOAuthTokenVerifierLayer` throws at layer build for a non-`https:` JWKS URL in production; layer construction has no Effect channel, so the throw is the gate. Unset OAuth env leaves the verifier inactive.
- Export-download refusals are all one 404 (ADR 0055), rate-limited by client IP so signatures cannot be brute-forced.
