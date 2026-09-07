import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { WorkspaceSuspended } from '@b2b-saas-starter/capabilities/errors'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Schema } from 'effect'

/**
 * The contract's error half: the tagged error schemas the API worker serves,
 * the `GuardFailure` union a non-contract surface can raise before it reaches
 * its own wire format, and the HTTP encoding of those failures. The groups,
 * the `StarterApi` contract itself, and the gate machinery (`BearerAuth`,
 * `ApiPrincipal`, the rate-limit tables) stay in `index.ts`, which re-exports
 * everything here.
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
  WorkspaceSuspended,
  RateLimited,
  CapabilityUnavailable
] as const

export const GuardFailure = Schema.Union(GUARD_FAILURE_SCHEMAS)
export type GuardFailure = typeof GuardFailure.Type

const encodeGuardFailure = Schema.encodeSync(GuardFailure)

/**
 * Status by tag: the same status each schema's `httpApiStatus` annotation
 * gives the REST surface. Keyed by `GuardFailure`'s own tags, so a failure
 * added to the union without a row here is a compile error, not a 500 at
 * runtime.
 */
const GUARD_FAILURE_STATUS = {
  Unauthorized: 401,
  AuthorizationDenied: 403,
  WorkspaceSuspended: 403,
  RateLimited: 429,
  CapabilityUnavailable: 503
} satisfies Record<GuardFailure['_tag'], number>

/**
 * The HTTP encoding of a guard failure outside the contract's error channel:
 * status by tag (the table above), body from the schema's own encoding — the
 * same body `HttpApiBuilder` serves — so `POST /mcp` answers a rejected
 * request byte-for-byte the way a REST route would.
 */
export type GuardFailureResponse = {
  readonly status: number
  readonly body: typeof GuardFailure.Encoded
}

export function guardFailureResponse(error: GuardFailure): GuardFailureResponse {
  return {
    status: GUARD_FAILURE_STATUS[error._tag],
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
