import { Effect, type Scope } from 'effect'
import {
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
