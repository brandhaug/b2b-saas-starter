import type { D1Database } from '@cloudflare/workers-types'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  createOperationsAuth,
  createOperationsAuthHandler,
  provisionLocalOperator,
  readOperatorSessionReference,
  OperatorTotpPresenceDenied,
  verifyOperatorTotpPresence
} from '@b2b-saas-starter/auth/operations'
import {
  GlobalOperationsAudit,
  MessagingGovernance,
  MessagingGovernanceDenied,
  MessagingWorkspaces,
  MessagingWorkspacesDenied,
  OperationsAuthorization,
  OperationsContractDenied,
  OperationsDiscovery,
  OperationsImpersonation,
  makeOperationsAuthorizationLayer,
  makeOperationsAuditLayer,
  makeOperationsDiscoveryLayer,
  makeOperationsImpersonationLayer,
  makeMessagingGovernanceLayer,
  makeMessagingWorkspacesLayer,
  decideSubscriptionRefund
} from '@b2b-saas-starter/capabilities/operations'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { clientKey, type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'
import { Effect, Schema } from 'effect'
import { makeOperationsAbuseProtection } from './operations-abuse-protection.ts'
import {
  parseOperationsConfig,
  type OperationsEnvironment
} from './operations-config.ts'
import { handleOperatorManagementRoutes } from './operator-management.ts'
import {
  createOperatorInvitationDelivery,
  readLocalOperatorInvitationEmail,
  type OperationsEmailBinding
} from './operations-email.ts'
import {
  handleOperatorEnrollmentRoutes,
  resumeOperatorEnrollment
} from './operator-enrollment.ts'
import { redirect } from './http-response.ts'

export type OperationsWorkerEnv = OperationsEnvironment & {
  readonly DB: D1Database
  readonly BOOKING_EVENTS_QUEUE?: Queue
  readonly EMAIL?: OperationsEmailBinding
  readonly RATE_LIMITER_OPERATIONS_READ?: CloudflareRateLimit
  readonly RATE_LIMITER_OPERATIONS_AUTHENTICATION?: CloudflareRateLimit
  readonly RATE_LIMITER_OPERATIONS_TOTP?: CloudflareRateLimit
  readonly RATE_LIMITER_OPERATIONS_SEARCH?: CloudflareRateLimit
  readonly RATE_LIMITER_OPERATIONS_MANAGEMENT?: CloudflareRateLimit
  readonly RATE_LIMITER_OPERATIONS_IMPERSONATION_START?: CloudflareRateLimit
  readonly RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE?: CloudflareRateLimit
}

export const localOperatorFixture = {
  id: 'opr_local_operations',
  name: 'Local System Operator',
  email: 'operator@operations.local',
  password: 'local-operations-password',
  // Better Auth stores raw string key material and Base32-encodes it for the
  // otpauth URI. Authenticator apps must receive this encoded setup key.
  totpSecret: 'JBSWY3DPEHPK3PXP',
  totpAuthenticatorKey: 'JJBFGV2ZGNCFARKIKBFTGUCYKA',
  roles: [
    'merchant-impersonator',
    'impersonation-auditor',
    'operator-manager',
    'messaging-reader',
    'messaging-controller',
    'messaging-finance',
    'messaging-reconciler',
    'messaging-incident-responder'
  ]
} as const

const formText = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

const OpenMessagingIncidentPayload = Schema.Struct({
  kind: Schema.Literals([
    'duplicate_delivery',
    'financial_uncertainty',
    'credential_compromise',
    'encryption_key_compromise',
    'privacy_exposure',
    'forged_callback'
  ]),
  severity: Schema.Literals(['low', 'medium', 'high', 'critical']),
  safeSummary: Schema.String,
  containmentScope: Schema.Literals([
    'merchant',
    'provider_channel',
    'callback_rule',
    'global'
  ]),
  environment: Schema.String,
  shopId: Schema.String,
  provider: Schema.Literals(['', 'meta', 'smso']),
  channel: Schema.Literals(['', 'whatsapp', 'sms']),
  reason: Schema.String
})

const MessagingRecoveryCheckPayload = Schema.Struct({
  kind: Schema.Literals(['health_probe', 'reconciliation']),
  reference: Schema.String,
  status: Schema.Literals(['passed', 'failed']),
  observedAt: Schema.String,
  reason: Schema.String
})

const discoveryErrorResponse = (error: unknown): Response => {
  if (error instanceof CapabilityUnavailable)
    return Response.json({ error: 'discovery_unavailable' }, { status: 503 })
  const reason =
    error instanceof OperationsContractDenied ? error.reason : 'discovery unavailable'
  if (reason.endsWith('not found'))
    return Response.json({ error: 'not_found' }, { status: 404 })
  if (reason.includes('invalid'))
    return Response.json({ error: 'invalid_search' }, { status: 400 })
  return Response.json({ error: 'forbidden' }, { status: 403 })
}

const auditErrorResponse = (error: unknown): Response => {
  if (error instanceof CapabilityUnavailable)
    return Response.json({ error: 'operations_audit_unavailable' }, { status: 503 })
  if (error instanceof OperationsContractDenied && error.reason.endsWith('not found'))
    return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ error: 'forbidden' }, { status: 403 })
}

const messagingErrorResponse = (error: unknown): Response => {
  if (!(error instanceof MessagingWorkspacesDenied))
    return Response.json({ error: 'messaging_unavailable' }, { status: 503 })
  if (error.reason === 'case_not_found')
    return Response.json({ error: 'not_found' }, { status: 404 })
  if (error.reason === 'operator_session_not_authorized')
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  if (error.reason.endsWith('_required'))
    return Response.json({ error: 'forbidden' }, { status: 403 })
  return Response.json({ error: 'messaging_unavailable' }, { status: 503 })
}

const messagingGovernanceErrorResponse = (error: unknown): Response => {
  if (!(error instanceof MessagingGovernanceDenied))
    return Response.json({ error: 'messaging_governance_unavailable' }, { status: 503 })
  if (error.reason.includes('required') || error.reason.includes('authorized'))
    return Response.json({ error: 'forbidden' }, { status: 403 })
  if (error.reason.includes('not_found'))
    return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ error: 'conflict' }, { status: 409 })
}

let localSeed: Promise<void> | undefined

const cookieValue = (request: Request, name: string): string => {
  const cookie = request.headers.get('cookie') ?? ''
  const acceptedNames = new Set([name, `__Secure-${name}`])
  for (const part of cookie.split(';')) {
    const [candidate, ...value] = part.trim().split('=')
    if (candidate && acceptedNames.has(candidate)) return value.join('=') || 'missing'
  }
  return 'missing'
}

const limited = (retryAfterSeconds: number): Response =>
  Response.json(
    { error: 'authentication_temporarily_unavailable', retryable: true },
    {
      status: 429,
      headers: {
        'retry-after': String(retryAfterSeconds),
        'cache-control': 'no-store'
      }
    }
  )

const authorize = async (
  db: ReturnType<typeof createDb>,
  reference: { readonly operatorSessionId: string }
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const authorization = yield* OperationsAuthorization
      return yield* authorization.authorize(reference)
    }).pipe(Effect.provide(makeOperationsAuthorizationLayer(db)))
  ).catch(() => null)

export const createOperationsWorker = () => ({
  async fetch(request: Request, env: OperationsWorkerEnv): Promise<Response> {
    let config
    try {
      config = parseOperationsConfig(env)
    } catch (error) {
      return Response.json(
        { error: 'operations_configuration_invalid', reason: String(error) },
        { status: 503 }
      )
    }
    const url = new URL(request.url)
    const invitationDelivery = createOperatorInvitationDelivery(env, config.production)
    if (request.method === 'GET' && url.pathname === '/ready') {
      return invitationDelivery.configured
        ? Response.json({ status: 'ready' })
        : Response.json(
            { error: 'operations_email_unavailable' },
            { status: 503, headers: { 'cache-control': 'no-store' } }
          )
    }
    if (
      config.localDevelopment &&
      request.method === 'GET' &&
      url.pathname === '/__local/operator-invitation-email'
    ) {
      const captured = readLocalOperatorInvitationEmail()
      return captured
        ? Response.json(captured)
        : Response.json({ error: 'no_local_invitation_email' }, { status: 404 })
    }
    const db = createDb(env.DB)
    const abuseProtection = makeOperationsAbuseProtection({
      db,
      bindings: {
        ...(env.RATE_LIMITER_OPERATIONS_READ
          ? { read: env.RATE_LIMITER_OPERATIONS_READ }
          : {}),
        ...(env.RATE_LIMITER_OPERATIONS_AUTHENTICATION
          ? { authentication: env.RATE_LIMITER_OPERATIONS_AUTHENTICATION }
          : {}),
        ...(env.RATE_LIMITER_OPERATIONS_TOTP
          ? { totp: env.RATE_LIMITER_OPERATIONS_TOTP }
          : {}),
        ...(env.RATE_LIMITER_OPERATIONS_SEARCH
          ? { search: env.RATE_LIMITER_OPERATIONS_SEARCH }
          : {}),
        ...(env.RATE_LIMITER_OPERATIONS_MANAGEMENT
          ? { management: env.RATE_LIMITER_OPERATIONS_MANAGEMENT }
          : {}),
        ...(env.RATE_LIMITER_OPERATIONS_IMPERSONATION_START
          ? { impersonationStart: env.RATE_LIMITER_OPERATIONS_IMPERSONATION_START }
          : {}),
        ...(env.RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE
          ? { handoffExchange: env.RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE }
          : {})
      },
      fallbackLimits: config.rateLimits.fallbackLimits,
      retryAfterSeconds: config.rateLimits.retryAfterSeconds
    })
    const consumeAbuse = (input: Parameters<typeof abuseProtection.consume>[0]) =>
      abuseProtection.consume(input).catch(() => ({
        allowed: false,
        retryAfterSeconds: config.rateLimits.retryAfterSeconds
      }))
    if (config.localSeed) {
      localSeed ??= provisionLocalOperator({
        db,
        secret: config.secret,
        mode: config.localDevelopment ? 'development' : 'production',
        operator: localOperatorFixture
      })
      await localSeed
    }
    const auth = createOperationsAuth({ db, ...config })
    const authHandler = createOperationsAuthHandler({ auth, db })
    const enrollmentResponse = await handleOperatorEnrollmentRoutes({
      request,
      config,
      db,
      auth,
      invitationDelivery
    })
    if (enrollmentResponse) return enrollmentResponse

    if (url.pathname.startsWith('/api/auth/')) {
      const authPath = url.pathname.slice('/api/auth'.length)
      if (authPath === '/sign-in/email') {
        let subjectKey = 'missing'
        try {
          const body = (await request.clone().json()) as { readonly email?: unknown }
          if (typeof body.email === 'string') {
            subjectKey = body.email.trim().toLocaleLowerCase('en-US') || 'missing'
          }
        } catch {
          // Malformed attempts share the same neutral missing-identity bucket.
        }
        const decision = await consumeAbuse({
          category: 'operator-authentication',
          subjectKey,
          sourceKey: clientKey(request),
          operation: 'password'
        })
        if (!decision.allowed) return limited(decision.retryAfterSeconds!)
      }
      if (
        authPath === '/two-factor/verify-totp' ||
        authPath === '/two-factor/verify-backup-code'
      ) {
        const decision = await consumeAbuse({
          category: 'operator-totp',
          subjectKey: cookieValue(request, 'operations.two_factor'),
          sourceKey: clientKey(request),
          operation: authPath === '/two-factor/verify-totp' ? 'totp' : 'backup-code'
        })
        if (!decision.allowed) return limited(decision.retryAfterSeconds!)
      }
      if (
        authPath !== '/sign-in/email' &&
        authPath !== '/two-factor/verify-totp' &&
        authPath !== '/two-factor/verify-backup-code'
      ) {
        const decision = await consumeAbuse({
          category: 'operator-session-read',
          subjectKey: cookieValue(request, 'operations.session_token'),
          sourceKey: clientKey(request),
          operation: 'session-read'
        })
        if (!decision.allowed) return limited(decision.retryAfterSeconds!)
      }
      return authHandler(request)
    }

    if (request.method === 'POST' && url.pathname === '/sign-in') {
      const form = await request.formData()
      const email = formText(form, 'email').trim().toLocaleLowerCase('en-US')
      const decision = await consumeAbuse({
        category: 'operator-authentication',
        subjectKey: email || 'missing',
        sourceKey: clientKey(request),
        operation: 'password'
      })
      if (!decision.allowed) return limited(decision.retryAfterSeconds!)
      const response = await authHandler(
        new Request(`${config.baseURL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { origin: config.baseURL, 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            password: formText(form, 'password')
          })
        })
      )
      if (response.status === 403) {
        const body = (await response
          .clone()
          .json()
          .catch(() => null)) as {
          readonly error?: unknown
          readonly operatorId?: unknown
        } | null
        if (
          body?.error === 'enrollment_required' &&
          typeof body.operatorId === 'string'
        ) {
          return resumeOperatorEnrollment({ operatorId: body.operatorId, db, config })
        }
      }
      if (!response.ok) return redirect('/sign-in?error=authentication_failed')
      return redirect('/verify-totp', response.headers.getSetCookie())
    }
    if (request.method === 'POST' && url.pathname === '/verify-totp') {
      const form = await request.formData()
      const decision = await consumeAbuse({
        category: 'operator-totp',
        subjectKey: cookieValue(request, 'operations.two_factor'),
        sourceKey: clientKey(request),
        operation: 'totp'
      })
      if (!decision.allowed) return limited(decision.retryAfterSeconds!)
      const response = await authHandler(
        new Request(`${config.baseURL}/api/auth/two-factor/verify-totp`, {
          method: 'POST',
          headers: {
            origin: config.baseURL,
            cookie: request.headers.get('cookie') ?? '',
            'content-type': 'application/json'
          },
          body: JSON.stringify({ code: formText(form, 'code'), trustDevice: false })
        })
      )
      if (!response.ok) return redirect('/verify-totp?error=invalid_code')
      return redirect('/', response.headers.getSetCookie())
    }

    const readDecision = await consumeAbuse({
      category: 'operator-session-read',
      subjectKey: cookieValue(request, 'operations.session_token'),
      sourceKey: clientKey(request),
      operation: 'session-read'
    })
    if (!readDecision.allowed) return limited(readDecision.retryAfterSeconds!)
    const reference = await readOperatorSessionReference({
      auth,
      headers: request.headers
    })
    const principal = reference ? await authorize(db, reference) : null
    if (!principal) return redirect('/sign-in')

    if (request.method === 'GET' && url.pathname === '/api/operations/session') {
      return Response.json({ principal })
    }

    const runDiscovery = <A>(
      use: (
        discovery: OperationsDiscovery['Service']
      ) => Effect.Effect<A, OperationsContractDenied | CapabilityUnavailable>
    ): Promise<A> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const discovery = yield* OperationsDiscovery
          return yield* use(discovery)
        }).pipe(Effect.provide(makeOperationsDiscoveryLayer(db)))
      )

    const runAudit = <A>(
      use: (
        audit: GlobalOperationsAudit['Service']
      ) => Effect.Effect<A, OperationsContractDenied | CapabilityUnavailable>
    ): Promise<A> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const audit = yield* GlobalOperationsAudit
          return yield* use(audit)
        }).pipe(Effect.provide(makeOperationsAuditLayer(db)))
      )

    const runImpersonation = <A>(
      use: (
        impersonation: OperationsImpersonation['Service']
      ) => Effect.Effect<A, OperationsContractDenied | CapabilityUnavailable>
    ): Promise<A> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const impersonation = yield* OperationsImpersonation
          return yield* use(impersonation)
        }).pipe(Effect.provide(makeOperationsImpersonationLayer(db)))
      )

    const runMessaging = <A>(
      use: (messaging: MessagingWorkspaces['Service']) => Effect.Effect<A, unknown>
    ): Promise<A> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const messaging = yield* MessagingWorkspaces
          return yield* use(messaging)
        }).pipe(Effect.provide(makeMessagingWorkspacesLayer(db)))
      )

    const runMessagingGovernance = <A>(
      use: (governance: MessagingGovernance['Service']) => Effect.Effect<A, unknown>
    ): Promise<A> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const governance = yield* MessagingGovernance
          return yield* use(governance)
        }).pipe(Effect.provide(makeMessagingGovernanceLayer(db)))
      )

    if (
      request.method === 'POST' &&
      url.pathname === '/api/operations/subscriptions/refunds'
    ) {
      if (!principal.roles.includes('operator-manager'))
        return Response.json({ error: 'forbidden' }, { status: 403 })
      const form = await request.formData()
      const eventId = formText(form, 'eventId')
      const consequence = formText(form, 'consequence')
      const shortenedPeriodEndsAt = formText(form, 'shortenedPeriodEndsAt')
      if (
        !eventId ||
        (consequence &&
          consequence !== 'end-access' &&
          consequence !== 'courtesy-preserve-access')
      )
        return Response.json({ error: 'invalid_refund_decision' }, { status: 400 })
      try {
        await Effect.runPromise(
          decideSubscriptionRefund({
            eventId,
            ...(consequence
              ? {
                  consequence: consequence as 'end-access' | 'courtesy-preserve-access'
                }
              : {}),
            ...(shortenedPeriodEndsAt ? { shortenedPeriodEndsAt } : {})
          }).pipe(Effect.provide(selectCapabilitiesLayer({ DB: env.DB })))
        )
        return Response.json(null)
      } catch {
        return Response.json({ error: 'refund_decision_unavailable' }, { status: 503 })
      }
    }

    const managementResponse = await handleOperatorManagementRoutes({
      request,
      db,
      actor: principal,
      reference: reference!,
      securityContact: config.securityContact,
      consumeRateLimit: consumeAbuse,
      redirect,
      limited
    })
    if (managementResponse) return managementResponse

    const startImpersonationRoute = url.pathname.match(
      /^\/merchants\/([^/]+)\/members\/([^/]+)\/impersonations$/
    )
    if (request.method === 'POST' && startImpersonationRoute) {
      const merchantId = decodeURIComponent(startImpersonationRoute[1]!)
      const targetMemberId = decodeURIComponent(startImpersonationRoute[2]!)
      const form = await request.formData()
      const startRequest = {
        actor: reference!,
        targetMemberId,
        merchantId,
        reason: formText(form, 'reason'),
        supportReference: formText(form, 'supportReference') || null
      }
      const recordRejectedAttempt = async (): Promise<Response | null> => {
        try {
          await runImpersonation((impersonation) =>
            impersonation.recordRejectedStart(startRequest)
          )
          return null
        } catch {
          return Response.json(
            { error: 'impersonation_audit_unavailable' },
            { status: 503 }
          )
        }
      }
      const totpDecision = await consumeAbuse({
        category: 'operator-totp',
        subjectKey: principal.id,
        sourceKey: clientKey(request),
        operation: 'impersonation-presence'
      })
      if (!totpDecision.allowed) {
        const unavailable = await recordRejectedAttempt()
        return unavailable ?? limited(totpDecision.retryAfterSeconds!)
      }
      try {
        await Effect.runPromise(
          verifyOperatorTotpPresence({
            auth,
            db,
            secret: config.secret,
            operatorId: principal.id,
            operatorSessionId: principal.sessionId,
            code: formText(form, 'code')
          })
        )
      } catch (error) {
        const unavailable = await recordRejectedAttempt()
        if (unavailable) return unavailable
        if (!(error instanceof OperatorTotpPresenceDenied)) {
          return Response.json(
            { error: 'impersonation_totp_unavailable' },
            { status: 503 }
          )
        }
        return Response.json({ error: 'impersonation_totp_rejected' }, { status: 403 })
      }
      const startDecision = await consumeAbuse({
        category: 'impersonation-start',
        subjectKey: `${principal.id}:${targetMemberId}`,
        sourceKey: clientKey(request),
        operation: 'start'
      })
      if (!startDecision.allowed) {
        const unavailable = await recordRejectedAttempt()
        return unavailable ?? limited(startDecision.retryAfterSeconds!)
      }
      try {
        const result = await runImpersonation((impersonation) =>
          impersonation.start(startRequest)
        )
        return Response.json({
          handoffTicket: result.handoffTicket,
          expiresAt: result.expiresAt,
          merchantAppOrigin: config.merchantBaseURL
        })
      } catch (error) {
        if (error instanceof CapabilityUnavailable) {
          return Response.json({ error: 'impersonation_unavailable' }, { status: 503 })
        }
        return Response.json({ error: 'impersonation_rejected' }, { status: 409 })
      }
    }

    const auditDetailRoute = url.pathname.match(/^\/api\/operations\/audit\/([^/]+)$/)

    const messagingCaseRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/cases\/([^/]+)$/
    )
    const messagingCaseResolutionRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/cases\/([^/]+)\/resolution$/
    )
    const messagingProviderQueryRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/cases\/([^/]+)\/provider-query$/
    )
    if (request.method === 'POST' && messagingProviderQueryRoute) {
      if (!env.BOOKING_EVENTS_QUEUE)
        return Response.json({ error: 'provider_query_unavailable' }, { status: 503 })
      const form = await request.formData()
      if (formText(form, 'confirmed') !== 'true')
        return Response.json({ error: 'confirmation_required' }, { status: 400 })
      try {
        const intentId = await runMessaging((messaging) =>
          messaging.requestProviderQuery({
            actor: reference!,
            caseId: decodeURIComponent(messagingProviderQueryRoute[1]!),
            reason: formText(form, 'reason'),
            confirmed: true
          })
        )
        await env.BOOKING_EVENTS_QUEUE.send({
          version: 1,
          kind: 'notification-intent',
          intentId
        }).catch(() => {
          // The accepted audit and queryable intent are durable in the same D1 system
          // of record. Scheduled SMSO polling recovers a missed acceleration wake-up.
        })
        return Response.json(null)
      } catch (error) {
        return messagingErrorResponse(error)
      }
    }
    if (request.method === 'POST' && messagingCaseResolutionRoute) {
      const form = await request.formData()
      if (formText(form, 'confirmed') !== 'true')
        return Response.json({ error: 'confirmation_required' }, { status: 400 })
      const disposition = formText(form, 'disposition')
      if (disposition !== 'resolved' && disposition !== 'waived')
        return Response.json({ error: 'invalid_disposition' }, { status: 400 })
      try {
        await runMessagingGovernance((governance) =>
          governance.resolveCase({
            actor: reference!,
            caseId: decodeURIComponent(messagingCaseResolutionRoute[1]!),
            disposition,
            classification: formText(form, 'classification'),
            source: formText(form, 'source'),
            reason: formText(form, 'reason')
          })
        )
        return Response.json(null)
      } catch (error) {
        return messagingGovernanceErrorResponse(error)
      }
    }
    if (request.method === 'GET' && messagingCaseRoute) {
      try {
        return Response.json(
          await runMessaging((messaging) =>
            messaging.caseDetail({
              actor: reference!,
              caseId: decodeURIComponent(messagingCaseRoute[1]!)
            })
          )
        )
      } catch (error) {
        return messagingErrorResponse(error)
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/operations/messaging') {
      try {
        return Response.json(
          await runMessaging((messaging) =>
            messaging.overview({
              actor: reference!,
              query: url.searchParams.get('q')?.slice(0, 100) ?? ''
            })
          )
        )
      } catch (error) {
        return messagingErrorResponse(error)
      }
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/operations/messaging/containment'
    ) {
      try {
        return Response.json({
          controls: await runMessaging((messaging) => messaging.containment(reference!))
        })
      } catch (error) {
        return messagingErrorResponse(error)
      }
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/operations/messaging/finance'
    ) {
      try {
        return Response.json(
          await runMessaging((messaging) => messaging.finance(reference!))
        )
      } catch (error) {
        return messagingErrorResponse(error)
      }
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/operations/messaging/reconciliation'
    ) {
      try {
        return Response.json({
          cases: await runMessaging((messaging) => messaging.reconciliation(reference!))
        })
      } catch (error) {
        return messagingErrorResponse(error)
      }
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/operations/messaging/incidents'
    ) {
      try {
        return Response.json({
          incidents: await runMessaging((messaging) => messaging.incidents(reference!))
        })
      } catch (error) {
        return messagingErrorResponse(error)
      }
    }
    const messagingIncidentContainRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/incidents\/([^/]+)\/contain$/
    )
    if (
      request.method === 'POST' &&
      url.pathname === '/api/operations/messaging/incidents'
    ) {
      const form = await request.formData()
      let input: typeof OpenMessagingIncidentPayload.Type
      try {
        input = Schema.decodeUnknownSync(OpenMessagingIncidentPayload)({
          kind: formText(form, 'kind'),
          severity: formText(form, 'severity'),
          safeSummary: formText(form, 'safeSummary'),
          containmentScope: formText(form, 'containmentScope'),
          environment: formText(form, 'environment'),
          shopId: formText(form, 'shopId'),
          provider: formText(form, 'provider'),
          channel: formText(form, 'channel'),
          reason: formText(form, 'reason')
        })
      } catch {
        return Response.json({ error: 'invalid_incident' }, { status: 400 })
      }
      try {
        await runMessagingGovernance((governance) =>
          governance.openIncident({
            actor: reference!,
            kind: input.kind,
            severity: input.severity,
            safeSummary: input.safeSummary,
            containmentScope: input.containmentScope,
            environment: input.environment,
            ...(input.shopId ? { shopId: input.shopId } : {}),
            ...(input.provider ? { provider: input.provider } : {}),
            ...(input.channel ? { channel: input.channel } : {}),
            reason: input.reason
          })
        )
        return Response.json(null)
      } catch (error) {
        return messagingGovernanceErrorResponse(error)
      }
    }
    if (request.method === 'POST' && messagingIncidentContainRoute) {
      const form = await request.formData()
      if (formText(form, 'confirmed') !== 'true')
        return Response.json({ error: 'confirmation_required' }, { status: 400 })
      try {
        await runMessagingGovernance((governance) =>
          governance.contain({
            actor: reference!,
            incidentId: decodeURIComponent(messagingIncidentContainRoute[1]!),
            reason: formText(form, 'reason'),
            confirmed: true
          })
        )
        return Response.json(null)
      } catch (error) {
        return messagingGovernanceErrorResponse(error)
      }
    }
    const messagingRecoveryCheckRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/incidents\/([^/]+)\/recovery-checks$/
    )
    if (request.method === 'POST' && messagingRecoveryCheckRoute) {
      const form = await request.formData()
      if (formText(form, 'confirmed') !== 'true')
        return Response.json({ error: 'confirmation_required' }, { status: 400 })
      let input: typeof MessagingRecoveryCheckPayload.Type
      try {
        input = Schema.decodeUnknownSync(MessagingRecoveryCheckPayload)({
          kind: formText(form, 'kind'),
          reference: formText(form, 'reference'),
          status: formText(form, 'status'),
          observedAt: formText(form, 'observedAt'),
          reason: formText(form, 'reason')
        })
      } catch {
        return Response.json({ error: 'invalid_recovery_check' }, { status: 400 })
      }
      try {
        await runMessagingGovernance((governance) =>
          governance.recordRecoveryCheck({
            actor: reference!,
            incidentId: decodeURIComponent(messagingRecoveryCheckRoute[1]!),
            ...input
          })
        )
        return Response.json(null)
      } catch (error) {
        return messagingGovernanceErrorResponse(error)
      }
    }
    const messagingRecoveryApprovalRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/incidents\/([^/]+)\/recovery-approvals$/
    )
    const messagingCredentialRotationRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/incidents\/([^/]+)\/credential-rotation$/
    )
    if (request.method === 'POST' && messagingCredentialRotationRoute) {
      const form = await request.formData()
      if (formText(form, 'confirmed') !== 'true')
        return Response.json({ error: 'confirmation_required' }, { status: 400 })
      try {
        await runMessagingGovernance((governance) =>
          governance.recordKeyRotation({
            actor: reference!,
            incidentId: decodeURIComponent(messagingCredentialRotationRoute[1]!),
            kind: 'provider_credential',
            previousVersion: formText(form, 'previousVersion'),
            nextVersion: formText(form, 'nextVersion'),
            invalidatedAt: formText(form, 'invalidatedAt'),
            validatedAt: formText(form, 'validatedAt'),
            evidenceReference: formText(form, 'evidenceReference'),
            reason: formText(form, 'reason')
          })
        )
        return Response.json(null)
      } catch (error) {
        return messagingGovernanceErrorResponse(error)
      }
    }
    if (request.method === 'POST' && messagingRecoveryApprovalRoute) {
      const form = await request.formData()
      if (formText(form, 'confirmed') !== 'true')
        return Response.json({ error: 'confirmation_required' }, { status: 400 })
      try {
        await runMessagingGovernance((governance) =>
          governance.approveRecovery({
            actor: reference!,
            incidentId: decodeURIComponent(messagingRecoveryApprovalRoute[1]!),
            reason: formText(form, 'reason'),
            healthProbeReference: formText(form, 'healthProbeReference'),
            reconciliationReference: formText(form, 'reconciliationReference'),
            residualRisk: formText(form, 'residualRisk')
          })
        )
        return Response.json(null)
      } catch (error) {
        return messagingGovernanceErrorResponse(error)
      }
    }
    const messagingRecoveryCompleteRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/incidents\/([^/]+)\/complete-recovery$/
    )
    if (request.method === 'POST' && messagingRecoveryCompleteRoute) {
      const form = await request.formData()
      if (formText(form, 'confirmed') !== 'true')
        return Response.json({ error: 'confirmation_required' }, { status: 400 })
      try {
        await runMessagingGovernance((governance) =>
          governance.completeRecovery({
            actor: reference!,
            incidentId: decodeURIComponent(messagingRecoveryCompleteRoute[1]!),
            reason: formText(form, 'reason'),
            confirmed: true
          })
        )
        return Response.json(null)
      } catch (error) {
        return messagingGovernanceErrorResponse(error)
      }
    }
    const messagingLedgerCorrectionRoute = url.pathname.match(
      /^\/api\/operations\/messaging\/finance\/ledger\/([^/]+)\/correct$/
    )
    if (request.method === 'POST' && messagingLedgerCorrectionRoute) {
      const form = await request.formData()
      if (formText(form, 'confirmed') !== 'true')
        return Response.json({ error: 'confirmation_required' }, { status: 400 })
      const entryId = decodeURIComponent(messagingLedgerCorrectionRoute[1]!)
      try {
        await runMessaging((messaging) =>
          messaging.correctLedgerEntry({
            actor: reference!,
            shopId: formText(form, 'shopId'),
            entryId,
            correctionReason: formText(form, 'correctionReason'),
            reason: formText(form, 'reason'),
            confirmed: true
          })
        )
        return Response.json(null)
      } catch (error) {
        return messagingErrorResponse(error)
      }
    }
    if (request.method === 'GET' && auditDetailRoute) {
      try {
        const event = await runAudit((audit) =>
          audit.get(reference!, decodeURIComponent(auditDetailRoute[1]!))
        )
        return Response.json({ event })
      } catch (error) {
        return auditErrorResponse(error)
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/operations/audit') {
      const action = url.searchParams.get('action')?.trim().slice(0, 120) || undefined
      const resultValue = url.searchParams.get('result')
      const result =
        resultValue === 'accepted' || resultValue === 'rejected'
          ? resultValue
          : undefined
      const actorOperatorId =
        url.searchParams.get('operator')?.trim().slice(0, 120) || undefined
      const merchantId =
        url.searchParams.get('merchant')?.trim().slice(0, 120) || undefined
      const targetId = url.searchParams.get('target')?.trim().slice(0, 120) || undefined
      try {
        const cursor = url.searchParams.get('cursor') || undefined
        const page = await runAudit((audit) =>
          audit.list(reference!, {
            ...(action ? { action } : {}),
            ...(result ? { result } : {}),
            ...(actorOperatorId ? { actorOperatorId } : {}),
            ...(merchantId ? { merchantId } : {}),
            ...(targetId ? { targetId } : {}),
            ...(cursor ? { cursor } : {})
          })
        )
        return Response.json(page)
      } catch (error) {
        return auditErrorResponse(error)
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/merchants/search') {
      try {
        const results = await runDiscovery((discovery) =>
          discovery.search({
            actor: reference!,
            kind: 'merchant',
            query: url.searchParams.get('q') ?? '',
            limit: Number(url.searchParams.get('limit') ?? 20)
          })
        )
        return Response.json({ results })
      } catch (error) {
        return discoveryErrorResponse(error)
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/members/search') {
      try {
        const results = await runDiscovery((discovery) =>
          discovery.search({
            actor: reference!,
            kind: 'merchant-member',
            query: url.searchParams.get('q') ?? '',
            limit: Number(url.searchParams.get('limit') ?? 20)
          })
        )
        return Response.json({ results })
      } catch (error) {
        return discoveryErrorResponse(error)
      }
    }

    const memberRoute = url.pathname.match(
      /^\/api\/merchants\/([^/]+)\/members\/([^/]+)$/
    )
    if (request.method === 'GET' && memberRoute) {
      try {
        return Response.json(
          await runDiscovery((discovery) =>
            discovery.getMember({
              actor: reference!,
              merchantId: decodeURIComponent(memberRoute[1]!),
              memberId: decodeURIComponent(memberRoute[2]!)
            })
          )
        )
      } catch (error) {
        return discoveryErrorResponse(error)
      }
    }
    const merchantApiRoute = url.pathname.match(/^\/api\/merchants\/([^/]+)$/)
    if (request.method === 'GET' && merchantApiRoute) {
      try {
        return Response.json(
          await runDiscovery((discovery) =>
            discovery.getMerchant({
              actor: reference!,
              merchantId: decodeURIComponent(merchantApiRoute[1]!)
            })
          )
        )
      } catch (error) {
        return discoveryErrorResponse(error)
      }
    }

    return Response.json({ error: 'not_found' }, { status: 404 })
  }
})

export default createOperationsWorker()
