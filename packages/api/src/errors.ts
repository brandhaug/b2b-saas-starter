import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { WorkspaceSuspended } from '@b2b-saas-starter/capabilities/errors'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Schema } from 'effect'
import { publicProblem } from './problems.ts'

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

// Non-contract routes encode these guard failures in their own wire format.
const GUARD_FAILURE_SCHEMAS = [
  Unauthorized,
  AuthorizationDenied,
  WorkspaceSuspended,
  RateLimited,
  CapabilityUnavailable
] as const

export const GuardFailure = Schema.Union(GUARD_FAILURE_SCHEMAS)
export type GuardFailure = typeof GuardFailure.Type

const GuardProblem = Schema.Union(
  GUARD_FAILURE_SCHEMAS.map((schema) => publicProblem(schema))
)
const encodeGuardFailure = Schema.encodeSync(GuardProblem)

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
  readonly body: typeof GuardProblem.Encoded
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
