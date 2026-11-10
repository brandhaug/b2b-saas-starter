import { workspaceSuspensionStatuses } from '@b2b-saas-starter/db/enums'
import { Context, type Effect, Schema } from 'effect'
import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { WorkspaceSuspended, WorkspaceSuspensionUnauthorized } from '../errors.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

export const WorkspaceSuspensionStatus = Schema.Literals(workspaceSuspensionStatuses)
export type WorkspaceSuspensionStatus = typeof WorkspaceSuspensionStatus.Type

/**
 * The owner of the `workspaces.suspensionStatus` machine (ADR 0077). The
 * legal set is the two-way `active <-> suspended`; a transition to the
 * current status is refused — a same-state request changes nothing, writes
 * nothing, audits nothing, and notifies nobody. Both adapters derive their
 * target from {@link nextWorkspaceSuspensionStatus} and gate product work
 * on {@link isSuspendedWorkspace}.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - the column births `active` via its `DEFAULT` (migration
 *   `20260907201125_modern_screwball`).
 * - the `assistant_workspace_suspension` trigger fires `AFTER UPDATE OF
 *   suspensionStatus ... WHEN OLD.suspensionStatus <> NEW.suspensionStatus`
 *   (migration `20260915114634_friendly_madame_hydra`): exactly the legal,
 *   non-refused transitions declared here advance assistant policy
 *   revisions and delete suspended members' personal data exports.
 */

/** The status a workspace births with — the column's own `DEFAULT 'active'`. */
export const initialWorkspaceSuspensionStatus: WorkspaceSuspensionStatus = 'active'

/** The actions an operator can request. */
export type WorkspaceSuspensionAction = 'suspend' | 'unsuspend'

/**
 * The declared transition map: the only legal moves are the two directions
 * between `active` and `suspended`. A same-status entry is `null` — the
 * refused no-op.
 */
const workspaceSuspensionTransitions = {
  active: { suspend: 'suspended', unsuspend: null },
  suspended: { suspend: null, unsuspend: 'active' }
} as const satisfies Record<
  WorkspaceSuspensionStatus,
  Record<WorkspaceSuspensionAction, WorkspaceSuspensionStatus | null>
>

/**
 * The status an action produces from the stored one; `null` refuses it —
 * suspending a suspended workspace (or reactivating an active one) is a
 * no-op that must leave the row, the audit log, and the owners' feeds
 * exactly as they were.
 */
export function nextWorkspaceSuspensionStatus(
  status: WorkspaceSuspensionStatus,
  action: WorkspaceSuspensionAction
): WorkspaceSuspensionStatus | null {
  return workspaceSuspensionTransitions[status][action]
}

/** Whether product work is currently refused for this workspace. */
export function isSuspendedWorkspace(status: WorkspaceSuspensionStatus): boolean {
  return status === 'suspended'
}

/**
 * The audit event a committed transition records — the one piece of audit
 * vocabulary keyed on the stored status, shared by both adapters.
 */
export function workspaceSuspensionAuditEvent(
  status: WorkspaceSuspensionStatus
): 'workspace.suspended' | 'workspace.unsuspended' {
  if (isSuspendedWorkspace(status)) {
    return 'workspace.suspended'
  }
  return 'workspace.unsuspended'
}

/**
 * The customer-facing explanation a committed transition leaves on the row:
 * suspension keeps the operator-supplied explanation, reactivation clears
 * it. Internal reasons never pass through here — they stay on the row and
 * out of public shapes.
 */
export function workspaceSuspensionExplanation(
  status: WorkspaceSuspensionStatus,
  explanation: string
): string | null {
  if (isSuspendedWorkspace(status)) {
    return explanation
  }
  return null
}

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
  readonly action: WorkspaceSuspensionAction
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
