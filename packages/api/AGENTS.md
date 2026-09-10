# @b2b-saas-starter/api

The HTTP contract and nothing that serves it: paths, payloads, statuses, error unions (ADR 0039). [`apps/api`](../../apps/api/AGENTS.md) implements one handler group per contract group, and any typed client derives from the same definition through Effect's `HttpApiClient`.

## Contracts

- `BearerAuth` proves _who_; `requirePermission` in the worker decides _what_ (ADR 0026). Handlers read `ApiPrincipal`, never the header.
- `rateLimitBucketFor` declares the gate; the worker keeps the mechanism (ADR 0030). `apps/api/src/permission-matrix.test.ts` asserts every `BearerAuth` group has a `GROUP_BUCKETS` row.
- `ListPageQuery` / `PageDto` are the paging vocabulary (ADR 0057). The capability layer clamps the limit; the contract accepts any number rather than answering 400.
- `guardFailureResponse` (`./errors`) serves surfaces owning their wire format, today only `POST /mcp`: one tag→status table (401/403/429/503) matching each schema's `httpApiStatus`.

## Changes

- Change this package first, then the handler. Import capability schemas; declare only wire-only DTOs.
- Non-contract routes beside the contract (ADR 0055, 0068) are the worker's: no OpenAPI entry, no matrix row.

## Boundaries

- Never append an endpoint after a group's `.middleware(BearerAuth)` call. It compiles and ships ungated.
- Never add a group without `BearerAuth` and a `GROUP_BUCKETS` row. `health` alone is public.
- Never put an error in a group's tuple that no handler constructs: a declared status no client can receive is a documented lie, and the schema is dead weight.
- Never re-declare a capability schema. A status may be restated outside `httpApiStatus` in exactly one place: the `guardFailureResponse` tag table, whose rows `errors.test.ts` pins to the annotations.
- No versioning of the surface (ADR 0048).

## Pitfalls

- Divergence documented on both sides: the Effect v4 query codec reads an undecodable optional as absent, so `?limit=abc` serves the default page, while the MCP tools' Effect `PAGED_TOOL_INPUT` (`apps/api/src/mcp.ts`) rejects it with an invalid-params tool-call error. Keep both in sync.
