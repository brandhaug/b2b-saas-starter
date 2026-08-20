import { Effect, type Scope } from 'effect'
import {
  authorize,
  memberPrincipal,
  requirePermission,
  type AuthorizationDenied,
  type PermissionRequest
} from '@b2b-saas-starter/authz'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities'

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
  permission: PermissionRequest
): Effect.Effect<void, AuthorizationDenied, WorkspaceContext | Scope.Scope> {
  return Effect.gen(function* () {
    const ctx = yield* WorkspaceContext
    return yield* requirePermission(
      ctx.actor ? memberPrincipal(ctx.actor.role) : null,
      permission
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
): Effect.Effect<A | null, E, R | WorkspaceContext> {
  return Effect.gen(function* () {
    const ctx = yield* WorkspaceContext
    if (!ctx.actor) return null
    if (!authorize(memberPrincipal(ctx.actor.role), permission).success) return null
    return yield* effect
  })
}
