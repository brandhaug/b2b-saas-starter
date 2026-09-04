# @b2b-saas-starter/api

## Purpose & Scope

The HTTP contract and nothing that serves it: paths, payloads, statuses, error unions (ADR 0039). [`apps/api`](../../apps/api/AGENTS.md) implements one handler group per contract group; [`packages/sdk`](../sdk/AGENTS.md) derives its client from the same definition (ADR 0058).

## Entry Points & Contracts

- `.` is the contract, `./errors` its error half; the root does not re-export `./errors`.
- `BearerAuth` proves _who_; `requirePermission` in the worker decides _what_ (ADR 0026). Handlers read `ApiPrincipal`, never the header.
- `rateLimitBucketFor` declares the gate; the worker keeps the mechanism (ADR 0030). `apps/api/src/permission-matrix.test.ts` asserts every `BearerAuth` group has a `GROUP_BUCKETS` row.
- `ListPageQuery` / `PageDto` are the paging vocabulary (ADR 0057). The capability layer clamps the limit; the contract accepts any number rather than answering 400.
- `guardFailureResponse` (`./errors`) serves surfaces owning their wire format, today only `POST /mcp`, reading each schema's `httpApiStatus` annotation so no second status table can drift.

## Usage Patterns

- Change this package first, then the handler. Import capability schemas; declare only wire-only DTOs.
- Non-contract routes beside the contract (ADR 0055, 0068) are the worker's: no OpenAPI entry, no matrix row.

## Anti-patterns

- Never append an endpoint after a group's `.middleware(BearerAuth)` call. It compiles and ships ungated.
- Never add a group without `BearerAuth` and a `GROUP_BUCKETS` row. `health` alone is public.
- Never re-declare a capability schema, or restate a status outside `httpApiStatus`.
- No versioning of the surface (ADR 0048).

## Dependencies & Edges

Only `apps/api` and `packages/sdk` depend on this package; keep that edge one-way. ADRs 0026, 0030, 0039, 0048, 0055, 0057, 0058, 0068.

## Patterns & Pitfalls

- Divergence documented on both sides: the Effect v4 query codec reads an undecodable optional as absent, so `?limit=abc` serves the default page, while the MCP tools' Effect `PAGED_TOOL_INPUT` (`apps/api/src/mcp.ts`) rejects it with an invalid-params tool-call error. Keep both in sync.
