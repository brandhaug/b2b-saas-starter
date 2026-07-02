import { Effect, Result, type Scope } from 'effect'
import { ApiTokenRegistry, type ApiTokenScope } from '@b2b-saas-starter/capabilities'
import { annotateWide } from '@b2b-saas-starter/logger'
import { json } from './http.ts'

export const bearerToken = (request: Request): string | null => {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

/**
 * Bearer gate. Resolves to a short-circuit `Response` on failure, `null` on
 * success:
 * - `401 missing_bearer_token` / `401 invalid_token` — unauthenticated.
 * - `403 insufficient_scope` — authenticated, missing the required scope.
 * - `403 token_workspace_mismatch` — the token is valid but bound to a
 *   different workspace than the one in the URL (`expectedWorkspaceSlug`).
 *   Without this check any workspace's token would unlock every workspace.
 * - `503 capability_unavailable` — the token store itself is unreachable.
 */
export const authorize = (
  request: Request,
  requiredScope: ApiTokenScope,
  expectedWorkspaceSlug?: string
): Effect.Effect<Response | null, never, ApiTokenRegistry | Scope.Scope> => {
  const token = bearerToken(request)
  if (!token) {
    return annotateWide({ outcome: 'missing_bearer_token' }).pipe(
      Effect.as(json({ error: 'missing_bearer_token' }, { status: 401 }))
    )
  }
  return Effect.gen(function* () {
    const registry = yield* ApiTokenRegistry
    const verified = yield* Effect.result(
      registry.verifyBearerToken(token, requiredScope)
    )
    if (Result.isFailure(verified)) {
      const failure = verified.failure
      if (failure._tag === 'CapabilityUnavailable') {
        yield* annotateWide({
          outcome: 'capability_unavailable',
          capability: failure.capability
        })
        return json({ error: 'capability_unavailable' }, { status: 503 })
      }
      // `invalid_token` is an authentication failure (401); a known token
      // without the required scope is an authorization failure (403).
      const status = failure.reason === 'invalid_token' ? 401 : 403
      yield* annotateWide({
        outcome: status === 401 ? 'unauthorized' : 'forbidden',
        authReason: failure.reason
      })
      return json({ error: failure.reason }, { status })
    }
    if (
      expectedWorkspaceSlug !== undefined &&
      verified.success.workspaceSlug !== expectedWorkspaceSlug
    ) {
      yield* annotateWide({
        outcome: 'forbidden',
        authReason: 'token_workspace_mismatch',
        tokenWorkspaceSlug: verified.success.workspaceSlug
      })
      return json({ error: 'token_workspace_mismatch' }, { status: 403 })
    }
    yield* annotateWide({
      tokenId: verified.success.id,
      workspaceId: verified.success.workspaceId,
      tokenWorkspaceSlug: verified.success.workspaceSlug,
      tokenScopes: verified.success.scopes,
      requiredScope
    })
    return null
  })
}
