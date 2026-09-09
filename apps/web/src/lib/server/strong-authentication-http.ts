import { type Session } from '@b2b-saas-starter/auth'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { type AuthExchange } from './auth-audit/exchanges'
import { type AuthRequestClassification } from './auth-request-guard'

function deny(code = 'strong_authentication_required') {
  return new Response(JSON.stringify({ code }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

/** The HTTP organization plugin has no capability audit/authorization context. */
export async function strongAuthenticationHttpResponse(
  exchange: AuthExchange,
  session: Session | undefined,
  classification: AuthRequestClassification
): Promise<Response | null> {
  const { path } = classification
  if (
    classification.organizationProduct ||
    classification.ssoProduct ||
    path === '/oauth2/continue' ||
    path === '/oauth2/consent' ||
    path === '/delete-user' ||
    path === '/delete-user/callback'
  ) {
    return deny('capability_route_required')
  }
  const recent = classification.recentAuthentication
  if (!session || (!recent && !classification.strongAuthenticationContext)) {
    return null
  }
  if (classification.urgentAdminAction) {
    return null
  }
  const status = await runCapabilities(
    Effect.flatMap(StrongAuthentication, (authentication) =>
      authentication.status({ userId: session.user.id, sessionId: session.session.id })
    )
  )
  if (recent) {
    if (session.session.impersonatedBy) {
      return deny()
    }
    // Recovery is a short-lived, restricted session whose only useful
    // purpose is repairing the factors that will end recovery. It does not
    // satisfy unrelated recent-authentication requirements.
    if (status.recovering && classification.recoveryFactorAction) {
      return null
    }
    if (status.recent) {
      return null
    }
    return deny()
  }
  if (classification.adminAction) {
    return (
      exchange.method === 'POST' ? status.recent && status.qualified : status.qualified
    )
      ? null
      : deny()
  }
  if (session.session.impersonatedBy) {
    return deny()
  }
  if (status.qualified || status.recovering) {
    return null
  }
  if (status.hasFactors) {
    return deny()
  }
  if (path.startsWith('/passkey/')) {
    return status.passwordVerified ? null : deny()
  }
  // Initial TOTP enrollment and password management retain Better Auth's own
  // credential verification; an unqualified session still has no privileged access.
  return null
}
