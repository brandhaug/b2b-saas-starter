import { type Session } from '@b2b-saas-starter/auth'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { type AuthExchange } from './auth-audit/exchanges'
import { isOrganizationProductAction } from './auth-organization-suspension'
import { impersonationForbiddenAction } from './impersonation-guard'

// Remaining credential paths beyond the shared account-action classification.
const ADDITIONAL_FACTOR_CHANGES = new Set([
  '/passkey/generate-register-options',
  '/set-password',
  '/unlink-account'
])
const URGENT_ADMIN_ACTIONS = new Set([
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/stop-impersonating'
])

/** Only protocol transport is public; connection management belongs to the
 * workspace capability routes, where authorization and audit context exist. */
function isSsoProductAction(path: string): boolean {
  if (!path.startsWith('/sso/')) {
    return false
  }
  return !(
    path === '/sso/callback' ||
    path.startsWith('/sso/callback/') ||
    path === '/sso/saml2/sp/metadata' ||
    path.startsWith('/sso/saml2/sp/acs/') ||
    path.startsWith('/sso/saml2/sp/slo/') ||
    path.startsWith('/sso/saml2/logout/')
  )
}

function authPath(exchange: AuthExchange) {
  return exchange.pathname.replace(/^\/api\/auth/, '')
}

export function needsStrongAuthenticationContext(exchange: AuthExchange): boolean {
  const path = authPath(exchange)
  const action = impersonationForbiddenAction(exchange)
  return (
    path.startsWith('/admin/') ||
    (action !== null && action !== 'delete_account') ||
    ADDITIONAL_FACTOR_CHANGES.has(path)
  )
}

function deny(code = 'strong_authentication_required') {
  return new Response(JSON.stringify({ code }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

/** The HTTP organization plugin has no capability audit/authorization context. */
export async function strongAuthenticationHttpResponse(
  exchange: AuthExchange,
  session: Session | undefined
): Promise<Response | null> {
  const path = authPath(exchange)
  if (
    isOrganizationProductAction(exchange) ||
    isSsoProductAction(path) ||
    path === '/delete-user' ||
    path === '/delete-user/callback'
  ) {
    return deny('capability_route_required')
  }
  if (!session || !needsStrongAuthenticationContext(exchange)) {
    return null
  }
  if (URGENT_ADMIN_ACTIONS.has(path)) {
    return null
  }
  const status = await runCapabilities(
    Effect.flatMap(StrongAuthentication, (authentication) =>
      authentication.status({ userId: session.user.id, sessionId: session.session.id })
    )
  )
  if (path.startsWith('/admin/')) {
    return status.qualified ? null : deny()
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
