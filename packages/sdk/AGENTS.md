# @b2b-saas-starter/sdk

## Purpose & Scope

The Typed SDK (CONTEXT.md) for the REST Capability Interface. Derived, not generated: `makeStarterApiClient` derives Effect's `HttpApiClient` from `StarterApi` in `packages/api`, so every path, payload, and error schema type-checks against the contract (ADR 0058).

## Entry Points & Contracts

- `makeStarterApiClient` — Effect-native; needs an `HttpClient` the caller composes. The API Token rides every request through a `transformClient` bearer header: the contract's `BearerAuth` middleware declares the scheme, the credential stays the caller's.
- `createStarterClient` — promise client for non-Effect callers. Paged lists return one `Page<T>` and carry `.iterate(slug)`, walking `nextCursor` to exhaustion (ADR 0057). It accepts an injected `fetch`; that is how tests drive the worker's web handler with no network.
- Item types come off the derived client's own return types, never restated, so a changed served shape is a type error.

## Anti-patterns

- Never hand-write a path, query name, or response shape. Extend `StarterApi` instead.
- No second client beside the derived one, and no codegen from `/openapi.json` (ADR 0058).
- The async iterator is the one sanctioned promise boundary (`effect/noAsyncFunction` and `no-await-in-loop` are disabled around `paged()`). Don't widen that disable.

## Patterns & Pitfalls

- `exactOptionalPropertyTypes` makes an absent key differ from explicit `undefined`, so the plain client assembles `query` objects field by field instead of spreading optionals.

## Dependencies & Edges

Runtime dependency on `packages/api` only; tests also reach `apps/api`, `capabilities`, `db`. Publishing externally means extracting the contract's schemas first (ADR 0048). Served by [`apps/api`](../../apps/api/AGENTS.md).
