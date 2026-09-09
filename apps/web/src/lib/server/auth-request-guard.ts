import { Auth, type Session } from '@b2b-saas-starter/auth'
import { type ImpersonationForbiddenAction } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { Effect } from 'effect'

import { authRuntime } from '../auth-runtime'
import { withWebRequestScope } from '../observability'
import { needsPreHandlerActor, type AuthExchange } from './auth-audit/exchanges'
import { type AuthAuditContext } from './auth-audit/shared'
import {
  isOrganizationProductAction,
  suspendedOrganizationResponse
} from './auth-organization-suspension'
import {
  impersonationForbiddenAction,
  impersonationGuardResponse
} from './impersonation-guard'
import { enforceSsoRequired, refuseDisabledConnection } from './sso-sign-in-gate'
import { strongAuthenticationHttpResponse } from './strong-authentication-http'

const ADDITIONAL_FACTOR_CHANGES = new Set([
  '/passkey/generate-register-options',
  '/set-password',
  '/unlink-account'
])
const RECENT_AUTHENTICATION_ACTIONS = new Set([
  '/change-password',
  '/change-email',
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
const URGENT_ADMIN_ACTIONS = new Set([
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/stop-impersonating'
])
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

export type AuthRequestClassification = {
  readonly path: string
  readonly auditContext: boolean
  readonly organizationProduct: boolean
  readonly ssoProduct: boolean
  readonly impersonationAction: ImpersonationForbiddenAction | null
  readonly strongAuthentication: StrongAuthenticationAction
}

export type StrongAuthenticationAction =
  | { readonly kind: 'capability-route' }
  | {
      readonly kind: 'recent'
      readonly recoveryFactorAction: boolean
    }
  | {
      readonly kind: 'admin'
      readonly method: AuthExchange['method']
      readonly urgent: boolean
    }
  | { readonly kind: 'passkey' }
  | { readonly kind: 'additional-factor' }
  | { readonly kind: 'none' }

/** Request facts used by every pre-handler guard, computed once per exchange. */
export function classifyAuthRequest(exchange: AuthExchange): AuthRequestClassification {
  const path = exchange.pathname.replace(/^\/api\/auth/, '')
  const impersonationAction = impersonationForbiddenAction(exchange)
  const organizationProduct = isOrganizationProductAction(exchange)
  const recentAuthentication =
    exchange.method === 'POST' && RECENT_AUTHENTICATION_ACTIONS.has(path)
  const ssoProduct = isSsoProductAction(path)
  let strongAuthentication: StrongAuthenticationAction = { kind: 'none' }
  if (organizationProduct || ssoProduct || CAPABILITY_ROUTE_ACTIONS.has(path)) {
    strongAuthentication = { kind: 'capability-route' }
  } else if (recentAuthentication) {
    strongAuthentication = {
      kind: 'recent',
      recoveryFactorAction: RECOVERY_FACTOR_ACTIONS.has(path)
    }
  } else if (path.startsWith('/admin/')) {
    strongAuthentication = {
      kind: 'admin',
      method: exchange.method,
      urgent: URGENT_ADMIN_ACTIONS.has(path)
    }
  } else if (path.startsWith('/passkey/')) {
    strongAuthentication = { kind: 'passkey' }
  } else if (ADDITIONAL_FACTOR_CHANGES.has(path)) {
    strongAuthentication = { kind: 'additional-factor' }
  }
  return {
    path,
    auditContext:
      needsPreHandlerActor(exchange) || exchange.pathname.endsWith('/unlink-account'),
    organizationProduct,
    ssoProduct,
    impersonationAction,
    strongAuthentication
  }
}

function readPreHandlerSession(request: Request): Promise<Session | null> {
  return authRuntime
    .runPromise(
      withWebRequestScope(
        { event: 'auth.session' },
        Effect.flatMap(Auth.Tag, (auth) =>
          auth.api.getSession({ headers: request.headers })
        )
      )
    )
    .catch(() => null)
}

async function readPreHandlerContext(
  request: Request,
  classification: AuthRequestClassification
): Promise<{
  readonly session: Session | undefined
  readonly audit: AuthAuditContext | undefined
}> {
  const needsContext =
    classification.auditContext ||
    classification.impersonationAction !== null ||
    (classification.strongAuthentication.kind !== 'none' &&
      classification.strongAuthentication.kind !== 'capability-route') ||
    classification.organizationProduct
  if (!needsContext) {
    return { session: undefined, audit: undefined }
  }
  const requestClone = request.clone()
  const session = await readPreHandlerSession(request)
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
  const { session, audit: context } = yield* Effect.promise(() =>
    readPreHandlerContext(request, classification)
  )

  const strongAuthResponse = yield* Effect.promise(() =>
    strongAuthenticationHttpResponse(session, classification.strongAuthentication)
  )
  if (strongAuthResponse !== null) {
    yield* Effect.annotateLogsScoped({ outcome: 'strong_authentication_required' })
    return refused(strongAuthResponse, context)
  }

  const suspensionResponse = classification.organizationProduct
    ? yield* Effect.promise(() => suspendedOrganizationResponse(request, session))
    : null
  if (suspensionResponse !== null) {
    yield* Effect.annotateLogsScoped({ outcome: 'workspace_suspended' })
    return refused(suspensionResponse, context)
  }

  const guardResponse = yield* impersonationGuardResponse(
    session?.session,
    classification.impersonationAction
  )
  if (guardResponse !== null) {
    yield* Effect.annotateLogsScoped({
      outcome: 'impersonation_blocked',
      statusCode: guardResponse.status
    })
    return refused(guardResponse, context)
  }

  const ssoRequiredResponse = yield* enforceSsoRequired(request, exchange)
  if (ssoRequiredResponse !== null) {
    yield* Effect.annotateLogsScoped({ outcome: 'sso_required' })
    return refused(ssoRequiredResponse, context)
  }
  const disabledSsoResponse = yield* refuseDisabledConnection(request, exchange)
  if (disabledSsoResponse !== null) {
    yield* Effect.annotateLogsScoped({ outcome: 'sso_connection_disabled' })
    return refused(disabledSsoResponse, context)
  }

  const response = yield* handlePluginRequest(request)
  return allowed(response, context)
})
