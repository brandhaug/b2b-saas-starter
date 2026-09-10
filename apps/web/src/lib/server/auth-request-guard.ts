import { type Session } from '@b2b-saas-starter/auth'
import { type ImpersonationForbiddenAction } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { Effect } from 'effect'

import { needsPreHandlerActor, type AuthExchange } from './auth-audit/exchanges'
import { type AuthAuditContext } from './auth-audit/shared'
import { authRefusal } from './auth-refusal'
import { sessionFromHeaders, type SessionReadFailed } from './auth-session-read'
import {
  impersonationForbiddenAction,
  impersonationGuardResponse
} from './impersonation-guard'
import { enforceSsoRequired, refuseDisabledConnection } from './sso-sign-in-gate'
import { strongAuthenticationHttpResponse } from './strong-authentication-http'

const RECENT_AUTHENTICATION_ACTIONS = new Set([
  '/change-password',
  // `/change-email` is deliberately absent: `changeEmail` is not enabled in
  // `packages/auth`, so the endpoint answers nothing to gate.
  '/set-password',
  '/unlink-account',
  '/link-social',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey'
])
const RECOVERY_FACTOR_ACTIONS = new Set([
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey'
])
/**
 * Containment actions an operator reaches for while an incident is running:
 * they revoke access rather than grant any, so the five-minute
 * recent-authentication step aside is waived — the twelve-hour strong
 * authentication every other `/admin/*` action needs still is not.
 */
const CONTAINMENT_ADMIN_ACTIONS = new Set([
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions'
])
/**
 * Leaving an impersonation is the one `/admin/*` action a session that is
 * never qualified must reach: the capability reports every impersonation
 * session as unqualified by construction (ADR 0054), so demanding strong
 * authentication here would trap the operator inside the impersonation it
 * ends.
 */
const IMPERSONATION_EXIT_ACTION = '/admin/stop-impersonating'
const CAPABILITY_ROUTE_ACTIONS = new Set([
  '/oauth2/continue',
  '/oauth2/consent',
  '/delete-user',
  '/delete-user/callback'
])

/** Only protocol transport is public; connection management remains gated. */
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

/**
 * The organization endpoints that were never the app's to own: creating a
 * workspace, listing the caller's own workspaces and invitations, and picking
 * the active one carry no workspace state a suspension or a permission could
 * govern. Everything else under `/organization/` does.
 */
const SAFE_ORGANIZATION_ACTIONS = new Set([
  '/organization/create',
  '/organization/list',
  '/organization/set-active',
  '/organization/list-user-invitations'
])

/** Whether the plugin path addresses workspace state the app owns elsewhere. */
function isOrganizationProductAction(path: string): boolean {
  return path.startsWith('/organization/') && !SAFE_ORGANIZATION_ACTIONS.has(path)
}

export type AuthRequestClassification = {
  readonly auditContext: boolean
  readonly impersonationAction: ImpersonationForbiddenAction | null
  readonly strongAuthentication: StrongAuthenticationAction
}

/** What an `/admin/*` exchange must prove about the operator's session. */
export type AdminAuthenticationRequirement =
  /** A read: current strong authentication (twelve hours). */
  | 'qualified'
  /** A mutation: strong authentication, re-proven in the last five minutes. */
  | 'qualified-and-recent'
  /** Nothing — the impersonation exit, which no impersonation session could satisfy. */
  | 'none'

export type StrongAuthenticationAction =
  | { readonly kind: 'capability-route' }
  | {
      readonly kind: 'recent'
      readonly recoveryFactorAction: boolean
    }
  | {
      readonly kind: 'admin'
      readonly requirement: AdminAuthenticationRequirement
    }
  | { readonly kind: 'passkey' }
  | { readonly kind: 'none' }

function adminRequirement(
  path: string,
  method: AuthExchange['method']
): AdminAuthenticationRequirement {
  if (path === IMPERSONATION_EXIT_ACTION) {
    return 'none'
  }
  if (CONTAINMENT_ADMIN_ACTIONS.has(path)) {
    return 'qualified'
  }
  return method === 'POST' ? 'qualified-and-recent' : 'qualified'
}

/** Request facts used by every pre-handler guard, computed once per exchange. */
export function classifyAuthRequest(exchange: AuthExchange): AuthRequestClassification {
  const path = exchange.pathname.replace(/^\/api\/auth/, '')
  const impersonationAction = impersonationForbiddenAction(exchange)
  const recentAuthentication =
    exchange.method === 'POST' && RECENT_AUTHENTICATION_ACTIONS.has(path)
  const ssoProduct = isSsoProductAction(path)
  let strongAuthentication: StrongAuthenticationAction = { kind: 'none' }
  if (
    isOrganizationProductAction(path) ||
    ssoProduct ||
    CAPABILITY_ROUTE_ACTIONS.has(path)
  ) {
    // Workspace, SSO-connection and account-deletion state is the app's to
    // change through its own server functions, which carry the authorization,
    // suspension and audit context the plugin's HTTP surface has none of.
    strongAuthentication = { kind: 'capability-route' }
  } else if (recentAuthentication) {
    strongAuthentication = {
      kind: 'recent',
      recoveryFactorAction: RECOVERY_FACTOR_ACTIONS.has(path)
    }
  } else if (path.startsWith('/admin/')) {
    strongAuthentication = {
      kind: 'admin',
      requirement: adminRequirement(path, exchange.method)
    }
  } else if (path === '/passkey/generate-register-options') {
    strongAuthentication = { kind: 'passkey' }
  }
  return {
    auditContext:
      needsPreHandlerActor(exchange) || exchange.pathname.endsWith('/unlink-account'),
    impersonationAction,
    strongAuthentication
  }
}

function needsPreHandlerContext(classification: AuthRequestClassification): boolean {
  return (
    classification.auditContext ||
    classification.impersonationAction !== null ||
    (classification.strongAuthentication.kind !== 'none' &&
      classification.strongAuthentication.kind !== 'capability-route')
  )
}

type PreHandlerContext = {
  readonly session: Session | undefined
  readonly audit: AuthAuditContext | undefined
}

function readPreHandlerContext(
  request: Request,
  classification: AuthRequestClassification
): Effect.Effect<PreHandlerContext, SessionReadFailed> {
  if (!needsPreHandlerContext(classification)) {
    return Effect.succeed({ session: undefined, audit: undefined })
  }
  const requestClone = request.clone()
  return sessionFromHeaders(request.headers).pipe(
    Effect.map((session): PreHandlerContext => {
      if (session === null) {
        return { session: undefined, audit: undefined }
      }
      return {
        session,
        audit: classification.auditContext
          ? {
              actorUserId: session.user.id,
              actorEmail: session.user.email,
              request: requestClone
            }
          : undefined
      }
    })
  )
}

export type AuthRequestGuardResult =
  | {
      readonly outcome: 'refused'
      readonly response: Response
      readonly context: AuthAuditContext | undefined
    }
  | {
      readonly outcome: 'allowed'
      readonly response: Response
      readonly context: AuthAuditContext | undefined
    }

type PluginRequestHandler<E, R> = (request: Request) => Effect.Effect<Response, E, R>

function refused(
  response: Response,
  context: AuthAuditContext | undefined
): AuthRequestGuardResult {
  return { outcome: 'refused', response, context }
}

function allowed(
  response: Response,
  context: AuthAuditContext | undefined
): AuthRequestGuardResult {
  return { outcome: 'allowed', response, context }
}

/**
 * Runs every refusal that must happen before Better Auth sees an auth request.
 * The continuation is part of the seam: a refusal result cannot accidentally
 * run the plugin or the route's successful-response processing.
 */
export const runAuthRequestGuards = Effect.fn('AuthRequestGuard.run')(function* <E, R>(
  request: Request,
  exchange: AuthExchange,
  handlePluginRequest: PluginRequestHandler<E, R>
) {
  const classification = classifyAuthRequest(exchange)
  // A read that failed proves nothing about the caller. Passing the request on
  // would run every guard below as if it were anonymous — the strong
  // authentication and impersonation guards both let an anonymous request
  // through to Better Auth's own 401 — so the exchange stops here instead.
  const context = yield* readPreHandlerContext(request, classification).pipe(
    Effect.catch((error) =>
      Effect.as(
        Effect.annotateLogsScoped({
          outcome: 'session_unavailable',
          sessionReadError: error.reason
        }),
        null
      )
    )
  )
  if (context === null) {
    return refused(authRefusal(503, 'session_unavailable'), undefined)
  }
  const { session, audit } = context

  // The impersonation refusal comes first: every path it governs is also a
  // recent-authentication path, and that check denies an impersonated session
  // too — with the generic code. Running this first is what makes the refusal
  // name the account action it refused (ADR 0054) instead of reporting a
  // missing factor the operator could never supply.
  const guardResponse = yield* impersonationGuardResponse(
    session?.session,
    classification.impersonationAction
  )
  if (guardResponse !== null) {
    yield* Effect.annotateLogsScoped({
      outcome: 'impersonation_blocked',
      statusCode: guardResponse.status
    })
    return refused(guardResponse, audit)
  }

  const strongAuthResponse = yield* Effect.promise(() =>
    strongAuthenticationHttpResponse(session, classification.strongAuthentication)
  )
  if (strongAuthResponse !== null) {
    yield* Effect.annotateLogsScoped({ outcome: 'strong_authentication_required' })
    return refused(strongAuthResponse, audit)
  }

  const ssoRequiredResponse = yield* enforceSsoRequired(request, exchange)
  if (ssoRequiredResponse !== null) {
    yield* Effect.annotateLogsScoped({ outcome: 'sso_required' })
    return refused(ssoRequiredResponse, audit)
  }
  const disabledSsoResponse = yield* refuseDisabledConnection(request, exchange)
  if (disabledSsoResponse !== null) {
    yield* Effect.annotateLogsScoped({ outcome: 'sso_connection_disabled' })
    return refused(disabledSsoResponse, audit)
  }

  const response = yield* handlePluginRequest(request)
  return allowed(response, audit)
})
