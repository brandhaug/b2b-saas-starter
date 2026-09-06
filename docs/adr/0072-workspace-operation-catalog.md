# Workspace operation catalog

`apps/api/src/operations.ts` now includes workspace mutations as well as reads.
This reverses its earlier "writes stay out" decision. Keeping writes in manual
REST bodies duplicated permissions and transport shaping in the permission
matrix, and made transport reuse depend on copying those bodies. Capability
business logic remains in `packages/capabilities`.

The catalog has read and mutation row shapes. Each row references its canonical
HTTP endpoint, which owns the method, path, input, success, and error schemas.
The row adds its permission, capability call, and MCP decision. Mutation request
types come from `HttpApiEndpoint.Request`, not a second payload or params shape.
Its inferred Effect error channel retains the capability's expected failures;
the download-link row translates an absent link into the contract's
`WorkspaceExportNotDownloadable`. Guard failures remain in the shared request
boundary. REST bindings preserve each row's input, success, and error types,
so `HttpApiBuilder` checks them against the explicit endpoint schemas. We keep
endpoint-to-row bindings explicit rather than erasing heterogeneous types with
a cast-based dispatcher. Adding a mutation requires a contract endpoint, a
catalog row, and its typed binding, but no handwritten handler body. The test
policy oracle must also cover the new permission. Stable services are captured
when building each mutation group; workspace
context, audit actor, request origin, and scoped log annotations remain per call.

MCP registration and discovery select the catalog's explicit `mcpTool` opt-ins.
All existing reads opt in and retain their schemas and `readOnlyHint: true`.
Every mutation currently opts out. Token creation/revocation and webhook secret
rotation affect credentials; webhook creation/update/deletion affect outbound
destinations; test/replay sends external traffic; export request/download-link
creates data or grants download access. None gains agent access merely because
it has a REST endpoint. Membership and invitation writes remain excluded from
this bearer-token worker, as required by its Better Auth session boundary.

A future MCP write tool requires a deliberate change to that row's opt-in
type and the shared tool projection, with reviewed input/output schemas and tests.
It must call the existing capability, enforce the row's permission on every
invocation, preserve API Token versus OAuth Member audit provenance, and declare
truthful `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`
annotations. Annotations are client hints, never authorization or confirmation.
Credential-bearing responses and externally visible side effects need explicit
review before exposure. No generic write dispatcher or automatic tool naming
is introduced. This catalog is not an automatic REST-and-MCP generator.

Effect is pinned to `4.0.0-rc.112`. `HttpApiBuilder.handleAll` accepts a mapped
handler record and checks each endpoint's input, success, errors, and remaining
requirements. It does not map heterogeneous catalog callbacks into that record.
Explicit bindings are a local choice to preserve those checks without assertions
or a custom mapped-record builder, not a claim that Effect requires handwritten
handler bodies. Contract references remove the avoidable method, path, and input
type duplication. Event prefixes remain explicit to preserve existing log names.

The pinned `Tool.make` and `McpServer.registerToolkit` can project schema-backed
tools, but their default result encoding differs from our existing JSON-text
results and typed-failure messages. We retain `McpServer.addTool` and the shared
decoder, authorization, and exhaustive failure mapper. MCP currently supports
three input shapes: no input, paging, and endpoint ID. A new shape needs a decoder
and projection change; flipping `mcpTool` alone cannot expose a mutation. Any
future write projection must invoke the existing row operation, not introduce a
second dispatch table. HTTP-specific response shaping, notably signed download
origins, needs explicit adaptation before reuse by a tool.

Capability schemas remain owned by `packages/capabilities`; HTTP wire schemas
remain in `packages/api` and are referenced through each row's endpoint. MCP JSON
argument codecs remain in `mcp.ts`. Their paging codec intentionally differs from
HTTP query decoding: an invalid optional HTTP limit is absent, while a non-number
MCP limit is invalid params. We do not claim one interchangeable wire codec.

The REST contract, SDK, error statuses, rate-limit buckets, MCP session protocol,
and per-tool authorization are unchanged. `POST /mcp` still has no route-level
permission check. The permission matrix derives mutation requests from rows and
compares coverage with the served OpenAPI contract, including the fail-closed
bucket rule. Those generated requests are coverage checks, not the permission
oracle. Independent expectations pin the complete permission policy and the
write-scope boundary. HTTP tests send independent denied mutation requests and
check that the audit trail and token registry stay unchanged. Protocol and
handler tests protect existing read behavior, mutation responses, error mapping,
and audit provenance.
