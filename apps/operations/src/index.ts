import type { D1Database } from '@cloudflare/workers-types'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  createOperationsAuth,
  createOperationsAuthHandler,
  provisionLocalOperator,
  readOperatorSessionReference
} from '@b2b-saas-starter/auth/operations'
import {
  OperationsContractDenied,
  OperationsDiscovery,
  OperationsAuthorization,
  makeOperationsAuthorizationLayer,
  hasOperatorPermission,
  makeOperationsDiscoveryLayer,
  type MerchantDetail,
  type MerchantMemberDetail,
  type MerchantMemberSearchResult,
  type MerchantSearchResult
} from '@b2b-saas-starter/capabilities/operations'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { clientKey, type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'
import { Effect } from 'effect'
import { makeOperationsAbuseProtection } from './abuse-protection.ts'
import { parseOperationsConfig, type OperationsEnvironment } from './config.ts'
import { handleOperatorManagementRoutes } from './operator-management.ts'

export type OperationsWorkerEnv = OperationsEnvironment & {
  readonly DB: D1Database
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

const html = (title: string, body: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui;background:#101417;color:#f5f7f8;max-width:80rem;margin:5rem auto;padding:0 1.5rem}main{border:1px solid #334048;padding:2rem;background:#172027}label,input,button{display:block;width:100%;box-sizing:border-box}input,button{margin:.5rem 0 1.25rem;padding:.75rem}input[type=checkbox]{display:inline;width:auto;margin:.25rem .5rem .25rem 0;padding:0}button{cursor:pointer;background:#e7b85b;border:0;font-weight:700}code{color:#e7b85b}table{width:100%;border-collapse:collapse}th,td{border:1px solid #334048;padding:.75rem;text-align:left;vertical-align:top}td form{margin-bottom:1rem}</style></head><body><main>${body}</main></body></html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  )

const redirect = (location: string, cookies: readonly string[] = []): Response => {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  cookies.forEach((cookie) => headers.append('set-cookie', cookie))
  return new Response(null, { status: 303, headers })
}

const formText = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]!
  )
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

const memberDetailHtml = (member: MerchantMemberDetail): string => {
  const membership = `${escapeHtml(member.membership.role)} of ${escapeHtml(member.membership.merchantName)}`
  const eligibility = member.impersonationEligibility.eligible
    ? 'Eligible for impersonation'
    : `Ineligible for impersonation: ${escapeHtml(member.impersonationEligibility.reason ?? 'unknown')}`
  return `<p><a href="/merchants/${encodeURIComponent(member.membership.merchantId)}">Back to Merchant</a></p><h1>${escapeHtml(member.name)}</h1><dl><dt>Member ID</dt><dd><code>${escapeHtml(member.id)}</code></dd><dt>Email</dt><dd>${escapeHtml(member.email)}</dd><dt>Email verification</dt><dd>${member.emailVerified ? 'Verified' : 'Unverified'}</dd><dt>Enabled state</dt><dd>${member.enabled ? 'Enabled' : 'Disabled'}</dd><dt>Membership</dt><dd>${membership}</dd><dt>Active sessions</dt><dd>${member.activeSessionCount}</dd><dt>Last sign-in</dt><dd>${escapeHtml(member.lastSignInAt ?? 'Never')}</dd><dt>Impersonation</dt><dd>${eligibility}</dd></dl>`
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
    const url = new URL(request.url)

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

    const managementResponse = await handleOperatorManagementRoutes({
      request,
      db,
      actor: principal,
      reference: reference!,
      consumeRateLimit: consumeAbuse,
      renderHtml: html,
      redirect,
      limited
    })
    if (managementResponse) return managementResponse

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
        return html(`${member.name} — Operations`, memberDetailHtml(member))
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
      `<p>Protected Operations shell</p><h1>Welcome, ${escapeHtml(principal.name)}</h1><p>Signed in as <code>${escapeHtml(principal.email)}</code>.</p><p>Roles: ${principal.roles.map(escapeHtml).join(', ')}</p>${hasOperatorPermission(principal.roles, 'operator:manage') ? '<p><a href="/operators">Manage System Operators</a></p>' : ''}<h2>Merchant discovery</h2><form method="get"><label>Find merchants<input name="merchantQuery" value="${escapeHtml(merchantQuery)}" maxlength="100" required></label><button type="submit">Search merchants</button></form><form method="get"><label>Find merchant members<input name="memberQuery" value="${escapeHtml(memberQuery)}" maxlength="100" required></label><button type="submit">Search members</button></form>${results}`
    )
  }
})

export default createOperationsWorker()
