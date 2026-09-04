import { Auth } from '@b2b-saas-starter/auth'
import { handleWebRequest } from 'effectful-better-auth'
import { authRuntime } from '@/lib/auth-runtime'
import { withWebRequestScope } from '@/lib/observability'

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) lives at the origin root
 * with the issuer's path inserted — `/.well-known/oauth-authorization-server/api/auth`
 * for an issuer of `…/api/auth` — which is outside the `/api/auth/*` catchall.
 * Better Auth's provider answers the document from a request hook as long as
 * the request reaches its handler, so this route hands it over untouched: no
 * rate-limit bucket (the document is public and static), no audit row (nothing
 * happens), one wide event.
 */
export function serveOAuthDiscovery(request: Request): Promise<Response> {
  return authRuntime.runPromise(
    withWebRequestScope(
      { event: 'auth.discovery' },
      handleWebRequest(Auth.Tag, request)
    )
  )
}
