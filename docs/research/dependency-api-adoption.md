# API dependency adoption

## Failure cases (before implementation)

- MCP lists must not advertise operations denied by current token scopes or member permissions. OAuth read-only grants must hide writes; revoked consent, changed membership, mismatched immutable workspace identity, suspension and missing strong authentication must not disclose registrations.
- Reusing a session with another credential must not reuse discovery authority. Hidden operations must remain denied when called by name. Discovery must not consume mutation admission or execute capability writes.
- REST failures must use `application/problem+json`, retain distinct types for errors sharing a status, and decode through the same contract used by generated clients. OpenAPI must describe the actual wire shape.
- Storage/provider reasons and request validation internals must never enter problem details. Validation failures must be generic. Existing domain error identity and safe client extension fields must survive decoding.

## Implementation

### Recommendation 7

`apps/api/src/mcp.ts` installs Effect 4.1 `McpServer.visibility` around the
registrations. List requests resolve `CurrentMcpRequest` and run the existing
`provideWorkspace` and `authorizeMcpOperation` checks for each catalog operation.
That includes immutable workspace identity, current membership, token permissions,
OAuth consent binding and scopes, suspension, and authentication assurance.
Failed authorization hides the registration. Unknown list targets fail closed.

Calls retain the existing handler checks and typed tool errors. The visibility
middleware requires request authority on calls but leaves execution admission to
the handlers. Listing does not call mutations or consume `rest_write`. The REST
discovery endpoint filters the same catalog for its API-token principal. Stable
capability services are captured at construction; caller authority stays in the
request. No new service or process-wide visibility cache was added.

The HTTP integration assertions cover read-only API-token lists and REST parity,
OAuth read-only scopes, missing/recent assurance, changed membership, mismatched
workspace identity, and revoked/reduced/replaced consent in the same session.
Existing direct-call refusal and audit-state assertions still run after listing.
Resource lists become empty when the OAuth grant is invalid.

### Recommendation 8

`packages/api/src/problems.ts` projects every declared REST error, including
authentication middleware and private conversation errors, to Problem Details.
It uses `HttpApiError.Problem`'s standard members, preserves declared extension
schemas, derives HTTP status from the original annotation, and decodes back to
the original domain error class. The unique type URI is
`urn:b2b-saas-starter:problem:<ErrorTag>`. The existing `_tag` remains a documented
extension. Infrastructure/provider `reason` strings are replaced with a fixed
public message. No capability error definitions or business behavior moved.

`HttpApiSchema.asProblem` alone cannot preserve these required extension fields:
its installed signature accepts a zero-argument error constructor and its wire
schema contains only type/status/title. The projection therefore uses the native
Problem member schemas with a typed codec back to the existing capability class.
This preserves existing `HttpApiClient` consumers and safe reason/identifier fields.

The contract opts into `HttpApiMiddleware.ProblemDetails`; its implementation keeps
`includeDetails` disabled. Malformed requests receive generic 400 problems without
submitted values or schema paths. Response encoding errors receive generic 500
problems. A REST-scoped router middleware reports unexpected defects and renders
the native `InternalServerErrorProblem`, preserving the protocol behavior of MCP.

MCP HTTP gate failures and export-download guard failures use the same problem
encoder and content type. MCP JSON-RPC errors, readiness probes, signed-download
404 concealment, OAuth metadata and unmatched router routes remain their separate
protocols; they are not declared REST contract errors. Private conversation SSE
success remains unchanged.

Public REST, typed-client and MCP docs were updated. No web runtime/client change
is needed: the web Worker calls capabilities in-process, and derived REST clients
continue to receive the original error classes.

## Consent and optional Effect decisions

- Retain the consent-query adapter. Installed Better Auth 1.7.14 exports
  `verifyOAuthQueryParams(query, secret)` and calls it inside the actual
  `oauth2Continue` and `oauth2Consent` flows used by
  `apps/web/src/lib/server/mcp-consent.effects.ts`. It verifies the canonical
  signature, rejects multiple signatures, and checks expiry. The browser-safe
  `signedOAuthQuery` helper only reconstructs signed parameters after TanStack
  serialization; it cannot replace server verification or receive the secret.
  The existing provider verification already uses the recommended helper.
  The adapter still checks the selected workspace and suspension before consent.
  No bypass was established and no web edit is requested. Existing reconstruction
  and real-provider consent/PKCE integration tests pass, as recorded below.
- Keep MCP protocol `2025-11-25`. Effect's cache hints require `v2026_07_28` and
  can let clients retain stale discovery. No protocol/client compatibility change
  was requested or established. Current lists recheck authority without a cache.
- `McpTest.makeClient` is already used in `apps/api/src/test-utils.ts`. It remains
  useful for registration/codec assertions; HTTP and local-D1 tests remain the
  authorization evidence. No duplicate in-memory test framework was introduced.
- No `buildPerTest` migration. The affected authority tests build their own
  mutable fixture per test; live suites deliberately own scoped D1 fixtures.
  The passing suites established no shared-layer leak needing this API.
- No circuit breaker was added. These operations need current authorization and
  do not have an identified outbound dependency with a breaker policy. An
  isolate-local breaker would not establish a Workers-wide outage policy.
- Keep the already-adopted family-specific crypto services and existing `jose`
  OAuth verification. Effect 4.1.1's experimental JOSE and header-only timeout
  additions are outside installed 4.1.0 and do not justify replacing current
  verification or whole-operation deadlines.

## Sources inspected

- [Effect 4.1.0 release](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.0),
  including request-scoped visibility, RPC middleware ordering, Problem Details,
  and McpTest notes.
- [Tagged HttpApiError source](https://github.com/Effect-TS/effect/blob/effect%404.1.0/packages/effect/src/http-api/HttpApiError.ts).
  Also inspected installed source and distributed declarations for
  `ai/McpServer`, `http-api/HttpApiSchema`, `HttpApiMiddleware`, `HttpApiError`,
  `http/HttpRouter`, `ProblemDetails`, `FetchHttpClient`, and Schema transformations.
  Internal source-only functions were not used as public exports.
- Installed `@better-auth/oauth-provider@1.7.14` declarations and implementation,
  specifically `verifyOAuthQueryParams` and its authorization/consent call sites.
- Root/scoped guidance, architecture, the complete agreed plan and original audit.
  Pinned Effect schema/service/testing/HTTP references and the codebase-design and
  effect-service-design instructions were read. Offline verification passed for
  all three supporting skill installations.

## Repeatable verification

Observed on 2026-11-01. Run from the repository root:

| Command                                                                                      | Observed result                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `pnpm run skills:verify -- effect codebase-design effect-service-design`                     | All three verified                               |
| `pnpm exec tsrs --noEmit -p apps/api/tsconfig.json`                                          | Passed                                           |
| `pnpm exec tsrs --noEmit -p packages/api/tsconfig.json`                                      | Passed                                           |
| `vp lint apps/api/src packages/api/src`                                                      | Passed                                           |
| `vp test run apps/api packages/api`                                                          | 23 files, 168 tests passed                       |
| `vp test run apps/web/src/lib/oauth-query.test.ts apps/web/src/lib/oauth-query.live.test.ts` | 2 files, 8 tests passed                          |
| `pnpm --filter web docs:generate`                                                            | Refreshed public exports for 28 English articles |
| `pnpm --filter web docs:check`                                                               | Export verification and all 5 tests passed       |

The API run includes real HTTP handler serialization, native Problem Details
validation and defect rendering, a derived `HttpApiClient` round trip, OpenAPI
media-type assertions, MCP HTTP/OAuth tests, and existing local-D1 isolation,
suspension, issuer, token-lifecycle and export tests. A codec test injects a
secret-looking infrastructure reason and asserts it is absent from the wire.

Full command logs are session-local under
`/private/var/folders/vw/bbmd8nsx5bq2_4l17l8qrjsc0000gn/T/opencode/`:
`api-skills.log`, `api-types.log`, `api-contract-types.log`, `api-lint.log`,
`api-suite.log`, `api-consent-assessment.log`, `api-public-docs.log`, and
`api-public-docs-check.log`. This document and the checked-in
test commands are the durable reproduction artifact.

Earlier runs exposed middleware-ordering problems in the in-memory MCP client and
old exact-body expectations in the live REST isolation test. Both were corrected;
the final API suite above passed. No deployment, real-provider inference test,
latency benchmark or independent review was performed by this implementation
worker. Root `check`, `validate` and review/PR work
belong to the parent session.
