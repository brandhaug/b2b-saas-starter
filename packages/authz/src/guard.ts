import { Effect, type Scope } from 'effect'
import { AUTHORIZATION_DENIED_REASONS, AuthorizationDenied } from './errors.ts'
import {
  authorize,
  type PermissionRequest,
  type Principal,
  type RequestedActions
} from './principal.ts'

/**
 * The enforcement point. Handlers compose it beside `enforceRateLimit` and
 * `enforceScope`, which is why it takes its inputs as arguments and requires
 * only a `Scope` — it stays usable from a web server function, a route loader,
 * and an API worker handler without any of them sharing a context service.
 *
 * The principal is passed in rather than read from a context service on
 * purpose: this package sits below `capabilities`, so it cannot see
 * `WorkspaceContext`. Callers resolve the actor once per request and hand it
 * over — a session actor via `memberPrincipal`, a verified bearer token via
 * `tokenPrincipal`.
 */

function actionsOf(requested: RequestedActions): ReadonlyArray<string> {
  if ('actions' in requested) {
    return requested.actions
  }
  return requested
}

/** `apiToken:list+create webhook:create` — one field on the wide event. */
function describe(request: PermissionRequest): string {
  const parts: Array<string> = []
  for (const [resource, requested] of Object.entries(request)) {
    parts.push(`${resource}:${actionsOf(requested).join('+')}`)
  }
  return parts.join(' ')
}

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
