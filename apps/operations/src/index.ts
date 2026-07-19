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
  OperationsAuthorization,
  OperationsContractDenied,
  OperationsDiscovery,
  OperationsImpersonation,
  makeOperationsAuthorizationLayer,
  makeOperationsAuditLayer,
  makeOperationsDiscoveryLayer,
  makeOperationsImpersonationLayer,
  hasOperatorPermission,
  type OperationsAuditEventDetail,
  type OperationsAuditEventSummary,
  type MerchantDetail,
  type MerchantMemberDetail,
  type MerchantMemberSearchResult,
  type MerchantSearchResult
} from '@b2b-saas-starter/capabilities/operations'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { clientKey, type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'
import geistFont from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'
import geistMonoFont from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2'
import { Effect } from 'effect'
import { makeOperationsAbuseProtection } from './abuse-protection.ts'
import { parseOperationsConfig, type OperationsEnvironment } from './config.ts'
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
import { escapeHtml, html, redirect } from './operations-response.ts'

export type OperationsWorkerEnv = OperationsEnvironment & {
  readonly DB: D1Database
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
  totpSecret: 'JBSWY3DPEHPK3PXP',
  roles: ['merchant-impersonator', 'impersonation-auditor', 'operator-manager']
} as const

const formText = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

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

const merchantResultHtml = (result: MerchantSearchResult): string =>
  `<li><a href="/merchants/${encodeURIComponent(result.id)}">${escapeHtml(result.publicName)}</a> <code>${escapeHtml(result.slug)}</code> — ${result.status}</li>`

const memberResultHtml = (result: MerchantMemberSearchResult): string =>
  `<li><a href="/merchants/${encodeURIComponent(result.merchant.id)}/members/${encodeURIComponent(result.id)}">${escapeHtml(result.name)}</a> — ${escapeHtml(result.email)} · ${escapeHtml(result.merchant.publicName)} (${result.status})</li>`

const merchantDetailHtml = (merchant: MerchantDetail): string => {
  const page =
    merchant.publicPage.status === 'published' && merchant.publicPage.bookingPath
      ? `Published at ${escapeHtml(merchant.publicPage.bookingPath)}`
      : 'Unpublished'
  const readiness = merchant.readiness.ready
    ? 'Ready for publication'
    : `Incomplete: ${merchant.readiness.incomplete.map(escapeHtml).join(', ')}`
  return `<p><a href="/">Back to discovery</a></p><h1>${escapeHtml(merchant.publicName)}</h1><dl><dt>Merchant ID</dt><dd><code>${escapeHtml(merchant.id)}</code></dd><dt>Status</dt><dd>${merchant.status}</dd><dt>Public page</dt><dd>${page}</dd><dt>Booking readiness</dt><dd>${readiness}</dd></dl><h2>Members</h2><ul>${merchant.members.map((member) => `<li><a href="/merchants/${encodeURIComponent(merchant.id)}/members/${encodeURIComponent(member.id)}">${escapeHtml(member.name)}</a> — ${escapeHtml(member.email)} (${member.status}, ${member.role})</li>`).join('')}</ul>`
}

const memberDetailHtml = (
  member: MerchantMemberDetail,
  canStartImpersonation: boolean
): string => {
  const membership = `${escapeHtml(member.membership.role)} of ${escapeHtml(member.membership.merchantName)}`
  const eligibility = member.impersonationEligibility.eligible
    ? 'Eligible for impersonation'
    : `Ineligible for impersonation: ${escapeHtml(member.impersonationEligibility.reason ?? 'unknown')}`
  const start =
    member.impersonationEligibility.eligible && canStartImpersonation
      ? `<h2>Create accountable pending handoff</h2><p>A current authentication code is required. The handoff expires after 60 seconds and does not replace another open impersonation.</p><form method="post" action="/merchants/${encodeURIComponent(member.membership.merchantId)}/members/${encodeURIComponent(member.id)}/impersonations"><label>Internal Impersonation Reason<textarea name="reason" maxlength="1000" required></textarea></label><label>External support reference<input name="supportReference" maxlength="200"></label><label>Current authentication code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label><button type="submit">Create pending handoff</button></form>`
      : ''
  return `<p><a href="/merchants/${encodeURIComponent(member.membership.merchantId)}">Back to Merchant</a></p><h1>${escapeHtml(member.name)}</h1><dl><dt>Member ID</dt><dd><code>${escapeHtml(member.id)}</code></dd><dt>Email</dt><dd>${escapeHtml(member.email)}</dd><dt>Email verification</dt><dd>${member.emailVerified ? 'Verified' : 'Unverified'}</dd><dt>Enabled state</dt><dd>${member.enabled ? 'Enabled' : 'Disabled'}</dd><dt>Membership</dt><dd>${membership}</dd><dt>Active sessions</dt><dd>${member.activeSessionCount}</dd><dt>Last sign-in</dt><dd>${escapeHtml(member.lastSignInAt ?? 'Never')}</dd><dt>Impersonation</dt><dd>${eligibility}</dd></dl>${start}`
}

const auditIdentityHtml = (identity: { id: string; displayName: string } | null) =>
  identity
    ? `${escapeHtml(identity.displayName)} <code>${escapeHtml(identity.id)}</code>`
    : 'Not applicable'

const auditResultHtml = (event: OperationsAuditEventSummary): string =>
  `<tr><td><a href="/audit/${encodeURIComponent(event.id)}">${escapeHtml(event.action)}</a></td><td>${event.result}</td><td>${auditIdentityHtml(event.actor)}</td><td>${auditIdentityHtml(event.target)}</td><td>${auditIdentityHtml(event.merchant)}</td><td><time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(event.occurredAt)}</time></td><td>${event.retentionPolicy === 'impersonation-two-years' ? `Two years (until ${escapeHtml(event.retainUntil ?? 'unclassified')})` : 'Operations standard'}</td></tr>`

const auditDetailHtml = (event: OperationsAuditEventDetail): string =>
  `<p><a href="/audit">Back to global audit</a></p><h1>${escapeHtml(event.action)}</h1><dl><dt>Result</dt><dd>${event.result}</dd><dt>Real operator</dt><dd>${auditIdentityHtml(event.actor)}</dd><dt>Operator Session</dt><dd>${escapeHtml(event.operatorSessionId ?? 'Not applicable')}</dd><dt>Impersonation</dt><dd>${escapeHtml(event.impersonationId ?? 'Not applicable')}</dd><dt>Target</dt><dd>${auditIdentityHtml(event.target)}</dd><dt>Merchant</dt><dd>${auditIdentityHtml(event.merchant)}</dd><dt>Timestamp</dt><dd>${escapeHtml(event.occurredAt)}</dd><dt>Retention</dt><dd>${event.retentionPolicy === 'impersonation-two-years' ? `Two years, through ${escapeHtml(event.retainUntil ?? '')}` : 'Operations standard'}</dd><dt>Internal reason</dt><dd>${escapeHtml(event.internalReason ?? 'Not provided')}</dd><dt>Support reference</dt><dd>${escapeHtml(event.supportReference ?? 'Not provided')}</dd></dl>`

const auditErrorResponse = (error: unknown): Response => {
  if (error instanceof CapabilityUnavailable)
    return Response.json({ error: 'operations_audit_unavailable' }, { status: 503 })
  if (error instanceof OperationsContractDenied && error.reason.endsWith('not found'))
    return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ error: 'forbidden' }, { status: 403 })
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
    if (request.method === 'GET' && url.pathname === '/assets/geist.woff2') {
      return new Response(geistFont, {
        headers: {
          'content-type': 'font/woff2',
          'cache-control': 'public,max-age=31536000,immutable'
        }
      })
    }
    if (request.method === 'GET' && url.pathname === '/assets/geist-mono.woff2') {
      return new Response(geistMonoFont, {
        headers: {
          'content-type': 'font/woff2',
          'cache-control': 'public,max-age=31536000,immutable'
        }
      })
    }
    if (
      config.localDevelopment &&
      request.method === 'GET' &&
      url.pathname === '/__local/operator-invitation-email'
    ) {
      const captured = readLocalOperatorInvitationEmail()
      return captured
        ? html(
            'Local operator invitation email',
            `<h1>Local operator invitation email</h1><p>To: ${escapeHtml(captured.email)}</p><p><a href="${escapeHtml(captured.url)}">Verify email and enroll</a></p>`
          )
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

    if (request.method === 'GET' && url.pathname === '/sign-in') {
      return html(
        'Operations sign in',
        '<h1>Operations</h1><p>Sign in with the dedicated System Operator identity.</p><form method="post"><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Continue</button></form>'
      )
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
    if (request.method === 'GET' && url.pathname === '/verify-totp') {
      return html(
        'Verify TOTP',
        '<h1>Two-factor verification</h1><p>Enter the current code from your authenticator.</p><form method="post"><label>Authentication code<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><button type="submit">Verify</button></form>'
      )
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

    const managementResponse = await handleOperatorManagementRoutes({
      request,
      db,
      actor: principal,
      reference: reference!,
      consumeRateLimit: consumeAbuse,
      renderHtml: html,
      redirect,
      limited,
      listActionsHtml:
        '<p><a href="/operators/invitations/new">Invite System Operator</a></p>'
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
        return html(
          'TOTP challenge failed',
          `<p><a href="/merchants/${encodeURIComponent(merchantId)}/members/${encodeURIComponent(targetMemberId)}">Return to Member detail</a></p><h1>Authentication code was not accepted</h1><p>No pending handoff was created.</p>`,
          403
        )
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
        return html(
          'Pending Handoff created',
          `<h1>Pending Handoff created</h1><p>This single-use handoff expires at <time datetime="${escapeHtml(result.expiresAt)}">${escapeHtml(result.expiresAt)}</time>.</p><form method="post" action="${escapeHtml(config.merchantBaseURL)}/impersonation/handoffs/exchange"><input type="hidden" name="ticket" value="${escapeHtml(result.handoffTicket)}"><button type="submit">Continue to Merchant App</button></form>`
        )
      } catch (error) {
        if (error instanceof CapabilityUnavailable) {
          return Response.json({ error: 'impersonation_unavailable' }, { status: 503 })
        }
        return html(
          'Pending Handoff rejected',
          `<p><a href="/merchants/${encodeURIComponent(merchantId)}/members/${encodeURIComponent(targetMemberId)}">Return to Member detail</a></p><h1>Unable to create pending handoff</h1><p>Authority or target state changed, or an open impersonation already holds a concurrency slot.</p>`,
          409
        )
      }
    }

    const auditDetailRoute = url.pathname.match(/^\/audit\/([^/]+)$/)
    if (request.method === 'GET' && auditDetailRoute) {
      try {
        const event = await runAudit((audit) =>
          audit.get(reference!, decodeURIComponent(auditDetailRoute[1]!))
        )
        return html(`${event.action} — Global audit`, auditDetailHtml(event))
      } catch (error) {
        return auditErrorResponse(error)
      }
    }
    if (request.method === 'GET' && url.pathname === '/audit') {
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
        const rows = page.events.length
          ? page.events.map(auditResultHtml).join('')
          : '<tr><td colspan="7">No matching Operations audit events.</td></tr>'
        const nextPage = page.nextCursor
          ? `<p><a href="${escapeHtml(
              (() => {
                const next = new URLSearchParams(url.searchParams)
                next.set('cursor', page.nextCursor!)
                return `/audit?${next.toString()}`
              })()
            )}">Older audit events</a></p>`
          : ''
        return html(
          'Global Operations audit',
          `<p><a href="/">Back to Operations</a></p><h1>Global Operations audit</h1><form method="get"><label>Action<input name="action" maxlength="120" value="${escapeHtml(action ?? '')}"></label><label>Result<select name="result"><option value="">Any</option><option value="accepted"${result === 'accepted' ? ' selected' : ''}>Accepted</option><option value="rejected"${result === 'rejected' ? ' selected' : ''}>Rejected</option></select></label><label>Real operator ID<input name="operator" maxlength="120" value="${escapeHtml(actorOperatorId ?? '')}"></label><label>Merchant ID<input name="merchant" maxlength="120" value="${escapeHtml(merchantId ?? '')}"></label><label>Target ID<input name="target" maxlength="120" value="${escapeHtml(targetId ?? '')}"></label><button type="submit">Filter audit</button></form><table><thead><tr><th>Action</th><th>Result</th><th>Real operator</th><th>Target</th><th>Merchant</th><th>Timestamp</th><th>Retention</th></tr></thead><tbody>${rows}</tbody></table>${nextPage}`
        )
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

    const memberPageRoute = url.pathname.match(
      /^\/merchants\/([^/]+)\/members\/([^/]+)$/
    )
    if (request.method === 'GET' && memberPageRoute) {
      try {
        const member = await runDiscovery((discovery) =>
          discovery.getMember({
            actor: reference!,
            merchantId: decodeURIComponent(memberPageRoute[1]!),
            memberId: decodeURIComponent(memberPageRoute[2]!)
          })
        )
        return html(
          `${member.name} — Operations`,
          memberDetailHtml(
            member,
            hasOperatorPermission(principal.roles, 'merchant:impersonate')
          )
        )
      } catch (error) {
        return discoveryErrorResponse(error)
      }
    }
    const merchantPageRoute = url.pathname.match(/^\/merchants\/([^/]+)$/)
    if (request.method === 'GET' && merchantPageRoute) {
      try {
        const merchant = await runDiscovery((discovery) =>
          discovery.getMerchant({
            actor: reference!,
            merchantId: decodeURIComponent(merchantPageRoute[1]!)
          })
        )
        return html(`${merchant.publicName} — Operations`, merchantDetailHtml(merchant))
      } catch (error) {
        return discoveryErrorResponse(error)
      }
    }
    if (request.method !== 'GET' || url.pathname !== '/') {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    const merchantQuery = url.searchParams.get('merchantQuery')?.trim() ?? ''
    const memberQuery = url.searchParams.get('memberQuery')?.trim() ?? ''
    let results = ''
    try {
      if (merchantQuery) {
        const found = await runDiscovery((discovery) =>
          discovery.search({
            actor: reference!,
            kind: 'merchant',
            query: merchantQuery,
            limit: 20
          })
        )
        results = `<h2>Merchant results</h2>${found.length ? `<ul>${found.map((item) => merchantResultHtml(item as MerchantSearchResult)).join('')}</ul>` : '<p>No Merchants found.</p>'}`
      } else if (memberQuery) {
        const found = await runDiscovery((discovery) =>
          discovery.search({
            actor: reference!,
            kind: 'merchant-member',
            query: memberQuery,
            limit: 20
          })
        )
        results = `<h2>Member results</h2>${found.length ? `<ul>${found.map((item) => memberResultHtml(item as MerchantMemberSearchResult)).join('')}</ul>` : '<p>No Merchant Members found.</p>'}`
      }
    } catch (error) {
      return discoveryErrorResponse(error)
    }
    return html(
      'Operations',
      `<p>Protected Operations shell</p><h1>Welcome, ${escapeHtml(principal.name)}</h1><p>Signed in as <code>${escapeHtml(principal.email)}</code>.</p><p>Roles: ${principal.roles.map(escapeHtml).join(', ')}</p>${hasOperatorPermission(principal.roles, 'operator:manage') ? '<p><a href="/operators">Manage System Operators</a></p>' : ''}${hasOperatorPermission(principal.roles, 'impersonation-audit:read') ? '<p><a href="/audit">Review global Operations audit</a></p>' : ''}<h2>Merchant discovery</h2><form method="get"><label>Find merchants<input name="merchantQuery" value="${escapeHtml(merchantQuery)}" maxlength="100" required></label><button type="submit">Search merchants</button></form><form method="get"><label>Find merchant members<input name="memberQuery" value="${escapeHtml(memberQuery)}" maxlength="100" required></label><button type="submit">Search members</button></form>${results}`
    )
  }
})

export default createOperationsWorker()
