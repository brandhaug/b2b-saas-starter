# @b2b-saas-starter/sdk

## Purpose & Scope

The Typed SDK (CONTEXT.md): the client external callers use against the REST Capability Interface. It is **derived, not generated** — `makeStarterApiClient` builds Effect's `HttpApiClient` from the shared `StarterApi` definition in `packages/api`, so every path, query parameter, payload, success schema, and error schema the API worker serves is the one this client encodes and decodes at type-check time (ADR 0058). There is no codegen step, no generated file, and no `/openapi.json` in the build path.

## Owned today

- **`makeStarterApiClient(options)`** — the Effect-native factory: base URL plus API Token in, a `StarterApiClient` (the derived `HttpApiClient.ForApi<typeof StarterApi>`) out. Its methods are Effects failing with the contract's tagged error classes. Requires an `HttpClient` service — compose `FetchHttpClient.layer` (or a custom transport) where you run it. The API Token rides every request through a `transformClient` bearer header, because the contract's `BearerAuth` middleware declares the security scheme while the credential is a caller concern.
- **`createStarterClient(options)`** — the plain promise-based client for callers not running Effect: `health`, `workspace.overview`, and one paged list per workspace read. Each list (`members`, `notifications`, `apiTokens`, `webhooks`, `auditEvents`) is callable for one `Page<T>` (`items` + `nextCursor`) and carries `.iterate(slug)` — an async iterator that follows `nextCursor` to exhaustion (ADR 0057). It resolves the derived client lazily, accepts an injected `fetch` (how the tests drive the worker's web handler without a network), and rejects with the contract's tagged error bodies.
- **`packages/sdk/src/index.live.test.ts`** — the acceptance harness: provisions the shared live D1 (`@b2b-saas-starter/capabilities/testing/live-harness`), inserts a real hashed API Token row, builds the API worker's `buildWebHandler` over it, and proves the walk is stable across an insert between page fetches. `src/index.test.ts` runs the same client against the Seed-backed worker with no D1.

## Conventions

- Dependency direction: this package depends on `@b2b-saas-starter/api` (the contract) and nothing else at runtime. Tests additionally reach `api` (the worker), `capabilities`, and `db`. Publishing the SDK externally would mean extracting the contract's schemas first — a decision that has not fired (ADR 0048).
- Never hand-write a path, a query name, or a response shape here. If the client is missing something, extend the `StarterApi` contract and let the derivation pick it up.
- The request shapes treat absent keys differently from explicit `undefined` (`exactOptionalPropertyTypes`): the plain client assembles `query` objects per field rather than spreading optionals.

## Anti-patterns

- Don't add a second client implementation beside the derived one — a hand-rolled fetch wrapper drifts from the contract the first time a route changes.
- Don't codegen from `/openapi.json`. The document is for humans and third-party generators; this package's source of truth is the `StarterApi` definition itself (ADR 0058).

## External references

- Contract: `packages/api` — the `StarterApi` definition this package derives from.
- API worker: [`apps/api/AGENTS.md`](../../apps/api/AGENTS.md) — the surface that serves it.
- Pagination: [ADR 0057](../../docs/adr/0057-keyset-cursor-pagination-for-list-endpoints.md) — the Page/Cursor semantics `.iterate()` walks.
