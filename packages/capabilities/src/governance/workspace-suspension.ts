import { workspaceSuspensionStatuses } from '@b2b-saas-starter/db/enums'
import { Context, type Effect, Schema } from 'effect'
import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { WorkspaceSuspended, WorkspaceSuspensionUnauthorized } from '../errors.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

export const WorkspaceSuspensionStatus = Schema.Literals(workspaceSuspensionStatuses)
export type WorkspaceSuspensionStatus = typeof WorkspaceSuspensionStatus.Type

export const WorkspaceSuspension = Schema.Struct({
  workspaceId: Schema.String,
  status: WorkspaceSuspensionStatus,
  customerExplanation: Schema.NullOr(Schema.String),
  changedAt: Schema.NullOr(Schema.String),
  changedByUserId: Schema.NullOr(Schema.String)
})
export type WorkspaceSuspension = typeof WorkspaceSuspension.Type

export type WorkspaceSuspensionSummary = {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly suspension: WorkspaceSuspension
}

/** Operations that remain usable during suspension. Everything else is product work. */
export const workspaceSuspensionOperations = Schema.Literals([
  'product',
  'credential_recovery',
  'sso_recovery',
  'billing_recovery',
  'security_cleanup',
  'account_recovery'
]).literals
export type WorkspaceSuspensionOperation =
  (typeof workspaceSuspensionOperations)[number]

/** Conservative permission-to-operation mapping shared by HTTP and MCP. */
export function workspaceSuspensionOperationForPermission(
  request: PermissionRequest
): WorkspaceSuspensionOperation {
  // A mixed request must not inherit a recovery exception from one field.
  const resources = Object.keys(request)
  if (resources.length !== 1) {
    return 'product'
  }
  function actions(resource: keyof PermissionRequest): ReadonlyArray<string> {
    return request[resource] ?? []
  }
  const tokenActions = actions('apiToken')
  if (
    tokenActions.length > 0 &&
    tokenActions.every((action) => action === 'list' || action === 'revoke')
  ) {
    return 'credential_recovery'
  }
  if (actions('sso').length > 0) {
    return 'sso_recovery'
  }
  return 'product'
}

export type WorkspaceSuspensionActor = {
  readonly userId: string
  /** Set from the current session; an impersonated admin cannot transition suspension. */
  readonly impersonatedBy?: string | null | undefined
}

export type WorkspaceSuspensionTransitionInput = {
  readonly workspaceId: string
  readonly action: 'suspend' | 'unsuspend'
  readonly actor: WorkspaceSuspensionActor
  /** Retained for platform operators only; never included in customer notifications. */
  readonly internalReason?: string | undefined
  /** Safe explanation shown to workspace owners and admins. */
  readonly customerExplanation?: string | undefined
}

export type WorkspaceSuspensionInterface = {
  readonly list: Effect.Effect<
    ReadonlyArray<WorkspaceSuspensionSummary>,
    CapabilityUnavailable
  >
  readonly get: (
    workspaceId: string
  ) => Effect.Effect<WorkspaceSuspension, CapabilityUnavailable | WorkspaceSuspended>
  readonly requireAllowed: (
    workspaceId: string,
    operation: WorkspaceSuspensionOperation
  ) => Effect.Effect<void, CapabilityUnavailable | WorkspaceSuspended>
  readonly transition: (
    input: WorkspaceSuspensionTransitionInput
  ) => Effect.Effect<
    WorkspaceSuspension,
    CapabilityUnavailable | WorkspaceSuspensionUnauthorized | WorkspaceSuspended
  >
}

export class WorkspaceSuspensionService extends Context.Service<
  WorkspaceSuspensionService,
  WorkspaceSuspensionInterface
>()('@b2b-saas-starter/capabilities/WorkspaceSuspension') {}

export { WorkspaceSuspended, WorkspaceSuspensionUnauthorized }
