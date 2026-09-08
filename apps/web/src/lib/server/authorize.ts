import {
  authorize,
  needsStrongAuthentication,
  memberPrincipal,
  type PermissionRequest
} from '@b2b-saas-starter/authz/client'
import { requirePermission } from '@b2b-saas-starter/authz/guard'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import {
  WorkspaceSuspensionService,
  workspaceSuspensionOperationForPermission,
  type WorkspaceSuspensionOperation
} from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { Effect } from 'effect'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { requireRequestSession } from './auth'

/**
 * The web app's enforcement point, and the session counterpart of the API
 * worker's `enforcePermission`. It reads the actor the `WorkspaceContext` layer
 * already resolved for this request and asks the one `authorize()` path in
 * `@b2b-saas-starter/authz` — so a session here and a bearer token in the API
 * worker reach the same decision from the same role table.
 *
 * Compose it inside the effect handed to `runWorkspaceCapabilities`, before the
 * capability call it guards. Capabilities do not check authorization
 * themselves; this is where a server function does it.
 *
 * A context with no actor denies (`no_principal`). Trusted server-side reads —
 * the public showcase loader — pass no actor and must not call this at all.
 */
export function requireWorkspacePermission(
  permission: PermissionRequest,
  operation: WorkspaceSuspensionOperation = workspaceSuspensionOperationForPermission(
    permission
  )
) {
  return Effect.gen(function* () {
    const ctx = yield* WorkspaceContext
    yield* requirePermission(
      ctx.actor ? memberPrincipal(ctx.actor.role) : null,
      permission
    )
    yield* requireWorkspaceAccess(operation)
  })
}

/** Recovery retains normal RBAC; SSO repair during suspension is owner-only. */
function requireWorkspaceAccess(operation: WorkspaceSuspensionOperation) {
  return Effect.gen(function* () {
    const ctx = yield* WorkspaceContext
    const suspension = yield* WorkspaceSuspensionService
    if (
      ctx.actor !== null &&
      operation !== 'credential_recovery' &&
      needsStrongAuthentication({
        systemRole: ctx.actor.systemRole,
        workspaceRole: ctx.actor.role
      })
    ) {
      const session = yield* Effect.promise(requireRequestSession)
      const authentication = yield* StrongAuthentication
      yield* authentication.require({
        userId: ctx.actor.userId,
        sessionId: session.session.id
      })
    }
    const canRepairSso =
      ctx.actor !== null &&
      authorize(memberPrincipal(ctx.actor.role), { organization: ['delete'] }).success
    yield* suspension.requireAllowed(
      ctx.workspace.id,
      operation === 'sso_recovery' && !canRepairSso ? 'product' : operation
    )
  })
}

/**
 * The read counterpart of the guard: runs `effect` only if the actor may, and
 * yields `null` when they may not.
 *
 * A denied *action* is an error the caller must see, which is what
 * `requireWorkspacePermission` raises. A denied *read* is not — the page still
 * renders, minus the segment. Returning `null` instead of failing is what lets
 * one loader assemble a payload whose shape follows the actor's permissions, so
 * a member's serialized loader data never carries the numbers the matrix denies
 * them. Hiding the section in the component alone would still ship them.
 *
 * The decision comes from the same pure `authorize()` the guard uses, so there
 * is no second permission path. No actor is a denial, like the guard.
 */
export function whenPermitted<A, E, R>(
  permission: PermissionRequest,
  effect: Effect.Effect<A, E, R>
) {
  return Effect.gen(function* () {
    if (!(yield* permitted(permission))) {
      return null
    }
    return yield* effect
  })
}

/**
 * The bare decision behind `whenPermitted`, for a read that shapes itself by
 * permission rather than being dropped whole — the onboarding checklist skips
 * two of its steps for an actor without `apiToken:list` and `webhook:list`.
 * Same pure `authorize()`, same no-actor denial.
 */
export function permitted(permission: PermissionRequest) {
  return Effect.gen(function* () {
    const ctx = yield* WorkspaceContext
    if (
      ctx.actor === null ||
      !authorize(memberPrincipal(ctx.actor.role), permission).success
    ) {
      return false
    }
    return yield* requireWorkspaceAccess(
      workspaceSuspensionOperationForPermission(permission)
    ).pipe(
      Effect.as(true),
      Effect.catchTag('WorkspaceSuspended', () => Effect.succeed(false))
    )
  })
}
