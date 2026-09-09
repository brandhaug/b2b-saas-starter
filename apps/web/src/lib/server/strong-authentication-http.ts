import { type Session } from '@b2b-saas-starter/auth'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { type StrongAuthenticationAction } from './auth-request-guard'

function deny(code = 'strong_authentication_required') {
  return new Response(JSON.stringify({ code }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

/** The HTTP organization plugin has no capability audit/authorization context. */
export async function strongAuthenticationHttpResponse(
  session: Session | undefined,
  action: StrongAuthenticationAction
): Promise<Response | null> {
  if (action.kind === 'capability-route') {
    return deny('capability_route_required')
  }
  if (action.kind === 'none' || !session) {
    return null
  }
  if (action.kind === 'admin' && action.urgent) {
    return null
  }
  const status = await runCapabilities(
    Effect.flatMap(StrongAuthentication, (authentication) =>
      authentication.status({ userId: session.user.id, sessionId: session.session.id })
    )
  )
  if (action.kind === 'recent') {
    if (session.session.impersonatedBy) {
      return deny()
    }
    // Recovery is a short-lived, restricted session whose only useful
    // purpose is repairing the factors that will end recovery. It does not
    // satisfy unrelated recent-authentication requirements.
    if (status.recovering && action.recoveryFactorAction) {
      return null
    }
    if (status.recent) {
      return null
    }
    return deny()
  }
  if (action.kind === 'admin') {
    return (
      action.method === 'POST' ? status.recent && status.qualified : status.qualified
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
  if (action.kind === 'passkey') {
    return status.passwordVerified ? null : deny()
  }
  // Initial TOTP enrollment and password management retain Better Auth's own
  // credential verification; an unqualified session still has no privileged access.
  return null
}
