import { apiTokenScopeAccess, type ApiTokenScope } from './roles.ts'
import { Effect, type Scope } from 'effect'
import { AUTHORIZATION_DENIED_REASONS, AuthorizationDenied } from './errors.ts'
import { authorize, type PermissionRequest, type Principal } from './principal.ts'

/**
 * Fails with `AuthorizationDenied` unless the principal may perform the
 * request. A missing principal is a denial, not a pass: an unresolved actor
 * means the caller has not proved anything, and trusted server-side reads do
 * not call this guard at all.
 */
export function requirePermission(
  principal: Principal | null,
  request: PermissionRequest
): Effect.Effect<void, AuthorizationDenied, Scope.Scope> {
  return Effect.gen(function* () {
    if (!principal) {
      yield* Effect.annotateLogsScoped({
        outcome: 'forbidden',
        authReason: 'no_principal',
        permission: describe(request)
      })
      return yield* Effect.fail(
        new AuthorizationDenied({ reason: AUTHORIZATION_DENIED_REASONS.noPrincipal })
      )
    }

    const decision = authorize(principal, request)
    if (decision.success) {
      return
    }

    yield* Effect.annotateLogsScoped({
      outcome: 'forbidden',
      authReason: 'insufficient_permission',
      authDetail: decision.error,
      permission: describe(request)
    })
    return yield* Effect.fail(
      new AuthorizationDenied({
        reason: AUTHORIZATION_DENIED_REASONS.insufficientPermission
      })
    )
  })
}

/** A minted credential cannot grant any permission its creator lacks. */
export function requireTokenScopes(
  principal: Principal | null,
  scopes: ReadonlyArray<ApiTokenScope>
): Effect.Effect<void, AuthorizationDenied, Scope.Scope> {
  return Effect.gen(function* () {
    for (const scope of scopes) {
      for (const [resource, actions] of Object.entries(
        apiTokenScopeAccess[scope].statements
      )) {
        if (actions.length > 0) {
          yield* requirePermission(principal, { [resource]: actions })
        }
      }
    }
  })
}

/** `apiToken:list+create webhook:create` in one wide-event field. */
function describe(request: PermissionRequest): string {
  return Object.entries(request)
    .map(([resource, requested]) => `${resource}:${requested.join('+')}`)
    .join(' ')
}
