import { type Session } from '@b2b-saas-starter/auth'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { authRefusal } from './auth-refusal'
import { type StrongAuthenticationAction } from './auth-request-guard'

function deny(code = 'strong_authentication_required') {
  return authRefusal(403, code)
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
  if (action.kind === 'admin' && action.requirement === 'none') {
    // The impersonation exit only: no impersonation session is qualified, and
    // ending one grants nothing (see the classification's own note).
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
    if (!status.qualified) {
      return deny()
    }
    // A containment action waives only the five-minute step aside.
    return action.requirement === 'qualified' || status.recent ? null : deny()
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
  // The remaining kind is the passkey enrollment ceremony's options request
  // for an account with no factors yet: a freshly verified password is the
  // only evidence left that the session's holder owns the account.
  return status.passwordVerified ? null : deny()
}
