import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { Option, Schema } from 'effect'

/**
 * The contract's error half: the tagged error schemas the API worker serves,
 * the `GuardFailure` union a non-contract surface can raise before it reaches
 * its own wire format, and the annotation-derived HTTP encoding of those
 * failures. The groups, the `StarterApi` contract itself, and the gate
 * machinery (`BearerAuth`, `ApiPrincipal`, the rate-limit tables) stay in
 * `index.ts`, which re-exports everything here.
 */

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class InternalError extends Schema.TaggedError<InternalError>()(
  'InternalError',
  { traceId: Schema.String },
  { httpApiStatus: 500 }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class RateLimited extends Schema.TaggedError<RateLimited>()(
  'RateLimited',
  { bucket: Schema.String },
  { httpApiStatus: 429 }
) {}

/**
 * The failures a *non-contract* surface can raise before it reaches its own
 * wire format — today only the MCP protocol route at `POST /mcp`, which speaks
 * JSON-RPC and therefore encodes its own responses. It composes the same
 * guards the contract's `BearerAuth` middleware does, so it can fail in exactly
 * these four ways.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const GUARD_FAILURE_SCHEMAS = [
  Unauthorized,
  AuthorizationDenied,
  RateLimited,
  CapabilityUnavailable
] as const

export const GuardFailure = Schema.Union(GUARD_FAILURE_SCHEMAS)
export type GuardFailure = typeof GuardFailure.Type

const encodeGuardFailure = Schema.encodeSync(GuardFailure)

/**
 * The annotations a guard failure must carry to be encodable: its tag (the
 * `identifier` every `Schema.TaggedError` sets) and the status
 * `HttpApiBuilder` gives it. Annotations are an open `unknown` bag, so they
 * are decoded here rather than read on faith.
 */
const StatusAnnotations = Schema.Struct({
  identifier: Schema.String,
  httpApiStatus: Schema.Number
})

const decodeStatusAnnotations = Schema.decodeUnknownOption(StatusAnnotations)

/**
 * Status by tag, read off the error schemas rather than restated: the
 * `httpApiStatus` annotation each class already carries is the one
 * `HttpApiBuilder` uses to encode the REST response, so there is no second
 * table for a non-contract surface to drift from. A class that somehow lost
 * its annotation gets no row, and `guardFailureResponse` answers 500 — the
 * honest status for "this failure has no declared encoding".
 */
const GUARD_FAILURE_STATUS: ReadonlyMap<string, number> = new Map(
  GUARD_FAILURE_SCHEMAS.flatMap((schema: Schema.Top) =>
    Option.match(decodeStatusAnnotations(schema.ast.annotations), {
      onNone: (): ReadonlyArray<[string, number]> => [],
      onSome: (annotations) => [[annotations.identifier, annotations.httpApiStatus]]
    })
  )
)

/**
 * The HTTP encoding of a guard failure outside the contract's error channel:
 * the status from the schema's annotation, the body from the schema's own
 * encoding. Both halves come from the same declarations `HttpApiBuilder` reads,
 * so `POST /mcp` answers a rejected request byte-for-byte the way a REST route
 * would.
 */
export type GuardFailureResponse = {
  readonly status: number
  readonly body: typeof GuardFailure.Encoded
}

export function guardFailureResponse(error: GuardFailure): GuardFailureResponse {
  return {
    status: GUARD_FAILURE_STATUS.get(error._tag) ?? 500,
    body: encodeGuardFailure(error)
  }
}

/**
 * The export named by a download-link request is not one this workspace can
 * hand out right now: unknown, pending, failed, or past its retention horizon.
 * One answer for every case, so a probing caller learns nothing about which.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WorkspaceExportNotDownloadable extends Schema.TaggedError<WorkspaceExportNotDownloadable>()(
  'WorkspaceExportNotDownloadable',
  { exportId: Schema.String },
  { httpApiStatus: 404 }
) {}
