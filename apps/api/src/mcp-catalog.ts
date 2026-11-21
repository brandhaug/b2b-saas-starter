import { WebhookDeliveryId, WebhookEndpointId } from '@b2b-saas-starter/db/ids'
import { Effect, Schema, SchemaIssue } from 'effect'
import {
  InvalidParams,
  type ToolJson,
  ToolJson as ToolJsonCodec
} from 'effect/ai/McpSchema'
import { type mcpMutationOperations } from './mcp-mutations.ts'
import {
  mirroredRestPath,
  type CapabilityRead,
  type WorkspaceReadOperation
} from './operations.ts'

/**
 * The operation catalog projected onto MCP wire descriptors: names,
 * descriptions and input schemas shared by tool registration and the
 * discovery document, so `tools/list` and `GET /mcp/discovery` cannot drift.
 */

export const MCP_SERVER_NAME = 'b2b-saas-starter-mcp'
export const OVERVIEW_RESOURCE_URI = 'workspace://overview'

/**
 * Every tool reads like its REST mirror: paged list tools take the same
 * optional `cursor`/`limit` the REST route accepts (ADR 0057), the one
 * parameterized read (deliveries for one endpoint) takes exactly that path
 * parameter, and the overview read takes no input. The Effect schema is what
 * a tool call decodes its arguments against, and the JSON Schema the
 * discovery document advertises is generated from it — so an operation's
 * input is declared once, in one schema system.
 *
 * The paging input every list tool takes: the same optional `cursor`/`limit`
 * the REST route accepts (ADR 0057), whose contract-side owner is
 * `ListPageQuery` in `@b2b-saas-starter/api`. Known behavioral divergence,
 * documented on both declarations: REST's query codec treats an undecodable
 * optional as absent — `?limit=abc` decodes the field away and the read
 * serves the default page — while this schema rejects a non-number `limit`
 * with an invalid-params tool-call error. Same vocabulary, one edge case
 * apart. Exported so `mcp.test.ts` can pin the advertised shape against
 * drift.
 */
export const PAGED_TOOL_INPUT = Schema.Struct({
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Finite)
})
const ENDPOINT_ID_TOOL_INPUT = Schema.Struct({
  endpointId: WebhookEndpointId.pipe(
    Schema.annotate({
      description: 'The webhook endpoint id whose deliveries to list.'
    })
  )
})

/** The protocol's own check on what a tool descriptor may advertise. */
const decodeToolJson = Schema.decodeUnknownSync(ToolJsonCodec)

/**
 * The advertised JSON Schema for a registered input: the input schema run
 * through Effect's JSON Schema generator, decoded against the protocol's own
 * `ToolJson` so what ships is exactly what the protocol accepts. A
 * struct with no fields generates no object root, so the empty input
 * advertises the literal object shape.
 */
function advertisedInputSchema(schema: Schema.Constraint): ToolJson {
  return decodeToolJson(Schema.toJsonSchemaDocument(schema).schema)
}

const NO_TOOL_INPUT_SCHEMA: ToolJson = decodeToolJson({
  type: 'object',
  properties: {}
})
const PAGED_INPUT_SCHEMA = advertisedInputSchema(PAGED_TOOL_INPUT)
const DELIVERY_ID_TOOL_INPUT = Schema.Struct({ deliveryId: WebhookDeliveryId })
const DELIVERY_ID_INPUT_SCHEMA = advertisedInputSchema(DELIVERY_ID_TOOL_INPUT)
const ENDPOINT_ID_INPUT_SCHEMA = advertisedInputSchema(ENDPOINT_ID_TOOL_INPUT)

/**
 * The advertised JSON Schema per row shape, keyed by the row's discrimination —
 * each generated from the schema a tool call decodes against (the same
 * declarations, right above), so the two cannot drift apart.
 */
const TOOL_INPUTS = {
  collection: NO_TOOL_INPUT_SCHEMA,
  paged: PAGED_INPUT_SCHEMA,
  deliveryId: DELIVERY_ID_INPUT_SCHEMA,
  endpointId: ENDPOINT_ID_INPUT_SCHEMA
}

/** The advertised input schema an operation registers with, derived from its row shape. */
function toolInput(operation: WorkspaceReadOperation): ToolJson {
  if (operation.param !== undefined) {
    return TOOL_INPUTS[operation.input]
  }
  if (operation.paged) {
    return TOOL_INPUTS.paged
  }
  return TOOL_INPUTS.collection
}

/**
 * One tool descriptor, projected from one row of the shared operation table
 * (operations.ts) rather than hand-mirrored: same name, same permission, same
 * capability read as the REST endpoint it names. Only rows that declare a
 * read projection reach here. Mutations use typed JSON adapters beside the
 * catalog and share the same capability dispatch (ADR 0072).
 */
function toolDescription(operation: WorkspaceReadOperation): string {
  return `${operation.toolDescription} Mirrors GET /${mirroredRestPath(operation.endpoint.path)}.`
}

/**
 * The one projection of a row onto the wire: name, description, and input
 * schema in a single place, so the discovery document (`GET /mcp/discovery`)
 * and the `McpTool` a call registers answer `tools/list` with the same
 * fields and cannot drift apart.
 */
export function toolProjection(operation: WorkspaceReadOperation) {
  return {
    name: operation.toolName,
    description: toolDescription(operation),
    inputSchema: toolInput(operation)
  }
}

function mutationInputSchema(input: Schema.Constraint): ToolJson {
  if (Schema.toJsonSchemaDocument(input).schema.type === undefined) {
    return NO_TOOL_INPUT_SCHEMA
  }
  return advertisedInputSchema(input)
}

type McpMutationOperation = ReturnType<typeof mcpMutationOperations>[number]

/** The same single wire projection for a mutation row. */
export function mutationToolProjection(operation: McpMutationOperation) {
  return {
    name: operation.toolName,
    description: `${operation.toolDescription} Mirrors ${operation.endpoint.method} /${mirroredRestPath(operation.endpoint.path)}.`,
    inputSchema: mutationInputSchema(operation.input)
  }
}

/** The invalid-params error a tool call answers undecodable arguments with. */
const formatIssue = SchemaIssue.makeFormatterDefault()
export const invalidParams = Effect.mapError(
  (error: Schema.SchemaError) =>
    new InvalidParams({ message: formatIssue(error.issue) })
)
const decodePagedInput = Schema.decodeUnknownEffect(PAGED_TOOL_INPUT)
const decodeDeliveryIdInput = Schema.decodeUnknownEffect(DELIVERY_ID_TOOL_INPUT)
const decodeEndpointIdInput = Schema.decodeUnknownEffect(ENDPOINT_ID_TOOL_INPUT)

/**
 * Decodes a tool call's arguments against the row's input schema and hands
 * back the capability read, already bound to exactly the input shape the
 * operation takes. Decoding happens before the workspace layer and the
 * permission guard, so a schema violation is a protocol-level invalid-params
 * error for the caller, never a tool failure the model would try to read
 * around.
 */
export function decodeOperationInput(
  operation: WorkspaceReadOperation,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the protocol hands tool arguments over as opaque JSON; decoding them against the row's schema is this very function
  payload: unknown
): Effect.Effect<CapabilityRead, InvalidParams> {
  const input = payload ?? {}
  if (operation.param !== undefined) {
    if (operation.input === 'deliveryId') {
      return bindRead(decodeDeliveryIdInput(input), (args) =>
        operation.read(undefined, args)
      )
    }
    return bindRead(decodeEndpointIdInput(input), (args) =>
      operation.read(undefined, args)
    )
  }
  if (operation.paged) {
    return bindRead(decodePagedInput(input), (page) => operation.read(page))
  }
  return Effect.succeed(Effect.suspend(() => operation.read(undefined)))
}

/** The read, bound to its decoded input but not yet run. */
function bindRead<A>(
  decoded: Effect.Effect<A, Schema.SchemaError>,
  read: (input: A) => CapabilityRead
): Effect.Effect<CapabilityRead, InvalidParams> {
  return decoded.pipe(
    invalidParams,
    Effect.map((input) => Effect.suspend(() => read(input)))
  )
}
