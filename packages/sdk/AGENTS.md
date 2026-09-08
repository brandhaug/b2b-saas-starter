# @b2b-saas-starter/sdk

The Typed SDK (CONTEXT.md) for the REST Capability Interface. Derived, not generated: `makeStarterApiClient` derives Effect's `HttpApiClient` from `StarterApi` in `packages/api`, so every path, payload, and error schema type-checks against the contract (ADR 0058).

## Contracts

- `makeStarterApiClient` needs an `HttpClient` the caller composes. The API Token rides every request through a `transformClient` bearer header: the contract's `BearerAuth` middleware declares the scheme, the credential stays the caller's.
- `createStarterClient` is the promise client for non-Effect callers. Paged lists return one `Page<T>` and carry `.iterate(slug)`, walking `nextCursor` to exhaustion (ADR 0057). It accepts an injected `fetch`; that is how tests drive the worker's web handler with no network.

## Boundaries

- Never hand-write a path, query name, or response shape. Extend `StarterApi` instead.
- No second client beside the derived one, and no codegen from `/openapi.json` (ADR 0058).
- The async iterator is the one sanctioned promise boundary (`effect/noAsyncFunction` and `no-await-in-loop` are disabled around `paged()`). Don't widen that disable.

## Pitfalls

- `exactOptionalPropertyTypes` makes an absent key differ from explicit `undefined`, so the plain client assembles `query` objects field by field instead of spreading optionals.
