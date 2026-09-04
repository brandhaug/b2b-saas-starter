import { Auth } from '@b2b-saas-starter/auth'
import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { toHttpEffect } from 'effectful-better-auth'
import { authRuntime } from '@/lib/auth-runtime'
import { withWebRequestScope } from '@/lib/observability'
import {
  authRateLimitBucket,
  clientKey,
  makeRateLimiterLayer,
  RateLimiter
} from '@/lib/rate-limit'
import { runCapabilities } from '@/lib/capabilities'
import {
  needsPreHandlerActor,
  type AuthExchange
} from '@/lib/server/auth-audit/exchanges'
import { recordAuthAudit } from '@/lib/server/auth-audit/record'
import { recordSsoSignInAudit } from '@/lib/server/auth-audit/sso-sign-in'
import { type AuthAuditContext } from '@/lib/server/auth-audit/shared'
import {
  enforceSsoRequired,
  refuseDisabledConnection
} from '@/lib/server/sso-sign-in-gate'
import {
  impersonationForbiddenAction,
  impersonationGuardResponse
} from '@/lib/server/impersonation-guard'
import { makeTurnstileLayer } from '@/lib/server/turnstile'
import { sendTwoFactorChangedEmail } from '@/lib/server/auth-emails'
import { notifyTwoFactorChangedEffect } from '@/lib/server/two-factor-notification'
import { TurnstileVerifier } from '@b2b-saas-starter/capabilities/governance/turnstile-verification'

/** The notification sender, bound to the provider-light email dispatcher. */
function sendNotification(input: {
  readonly email: string
  readonly enabled: boolean
}) {
  return sendTwoFactorChangedEmail({ email: input.email, enabled: input.enabled })
}

/**
 * The request's session, read BEFORE the auth handler consumes the request. A
 * failed session read must never fail the auth request it observes, so it
 * resolves `null` on any error.
 */
function readPreHandlerSession(request: Request) {
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

type PreHandlerSession = NonNullable<Awaited<ReturnType<typeof readPreHandlerSession>>>

/**
 * Everything the pre-handler reads need, gathered once: the session, for the
 * audits whose responses never name their actor (admin responses never name
 * their actor; sign-out and the session revocations name nobody) and for the
 * impersonation guard (ADR 0054); plus, for admin mutations, a clone of the
 * JSON body (`userId` target). `undefined` throughout for anything else, or a
 * request that carries no session — anonymous probes are rate-limited noise.
 */
async function readPreHandlerContext(
  request: Request,
  exchange: AuthExchange
): Promise<{
  readonly session: PreHandlerSession | undefined
  readonly audit: AuthAuditContext | undefined
}> {
  const audited = exchange.method === 'POST' && needsPreHandlerActor(exchange)
  const guarded = impersonationForbiddenAction(exchange) !== null
  if (!audited && !guarded) {
    return { session: undefined, audit: undefined }
  }
  // The clone is taken before the handler runs — Better Auth consumes the
  // original request's body.
  const requestClone = request.clone()
  const session = await readPreHandlerSession(request)
  if (!session) {
    return { session: undefined, audit: undefined }
  }
  return {
    session,
    audit: audited
      ? {
          actorUserId: session.user.id,
          actorEmail: session.user.email,
          request: requestClone
        }
      : undefined
  }
}

/**
 * The sign-up gate (ADR 0031): when TURNSTILE is configured, the widget's
 * token must ride the `x-turnstile-token` header and verify against
 * siteverify before Better Auth sees the request. Unconfigured, `verify`
 * returns `inactive` and the request passes through untouched — provider-
 * light local development is unaffected. Returns a JSON error response for
 * `rejected` / `unavailable`, or `undefined` to let the request proceed.
 * Runs OUTSIDE the request scope (no `Effect.annotateLogsScoped` here); the caller
 * annotates the wide event from the response it gets back.
 */
function verifySignUpTurnstile(
  request: Request,
  exchange: AuthExchange
): Effect.Effect<Response | null> {
  if (exchange.method !== 'POST' || !exchange.pathname.endsWith('/sign-up/email')) {
    return Effect.succeed(null)
  }
  const token = request.headers.get('x-turnstile-token') ?? ''
  return Effect.gen(function* () {
    const verifier = yield* TurnstileVerifier
    const verdict = yield* verifier.verify({ token })
    if (verdict.outcome === 'inactive' || verdict.outcome === 'verified') {
      return null
    }
    const status = verdict.outcome === 'unavailable' ? 503 : 400
    const code =
      verdict.outcome === 'unavailable' ? 'captcha_unavailable' : 'captcha_rejected'
    // Better Auth's error-body convention (`{ code }`), like every pre-handler refusal here.
    return new Response(JSON.stringify({ code }), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  }).pipe(Effect.provide(makeTurnstileLayer()))
}

async function handleAuth(request: Request): Promise<Response> {
  // The one URL parse per request: method and pathname are all the rate-limit
  // bucket, the Turnstile gate, the audit table and the two-factor
  // notification match on.
  const exchange: AuthExchange = {
    method: request.method,
    pathname: new URL(request.url).pathname
  }
  const bucket = authRateLimitBucket(exchange.method, exchange.pathname)
  const rateLimitLayer = makeRateLimiterLayer(env)

  // The request scope (method, pathname, trace continuation, the canonical
  // line) is already open — `src/start.ts` runs it for every server request.
  // This adds the auth-specific span and folds its fields into that one event.
  return authRuntime.runPromise(
    withWebRequestScope(
      { event: 'auth.request', metadata: { bucket } },
      Effect.gen(function* () {
        const limiter = yield* RateLimiter
        const allowed = yield* limiter.take({
          bucket,
          key: clientKey(request)
        })
        if (!allowed) {
          yield* Effect.annotateLogsScoped({ outcome: 'rate_limited' })
          return new Response(JSON.stringify({ code: 'rate_limited' }), {
            status: 429,
            headers: { 'content-type': 'application/json; charset=utf-8' }
          })
        }
        // Turnstile gate before Better Auth consumes the request (ADR 0031).
        const turnstileResponse = yield* verifySignUpTurnstile(request, exchange)
        if (turnstileResponse !== null) {
          yield* Effect.annotateLogsScoped({
            outcome: 'turnstile_blocked',
            turnstileStatus: turnstileResponse.status
          })
          return turnstileResponse
        }
        // Pre-handler reads before Better Auth runs: the session (for the
        // audits whose responses never name their actor, and for the
        // impersonation guard) and — for admin mutations — a body clone that
        // the handler's consumption of the request would otherwise make
        // unreadable.
        const { session, audit: context } = yield* Effect.promise(() =>
          readPreHandlerContext(request, exchange)
        )
        // An impersonation session may not change the account's password,
        // second factor or email, or delete it (ADR 0054). Decided by the
        // capability's guard, answered here before Better Auth sees the request.
        const guardResponse = yield* impersonationGuardResponse(
          exchange,
          session?.session
        )
        if (guardResponse !== null) {
          yield* Effect.annotateLogsScoped({
            outcome: 'impersonation_blocked',
            statusCode: guardResponse.status
          })
          return guardResponse
        }
        // The require-SSO gate (ADR 0055): a workspace that demands SSO for
        // its domain refuses the credential path here, so the sign-in page's
        // routing is backed by an enforcement point. Null = not applicable.
        const ssoRequiredResponse = yield* enforceSsoRequired(request, exchange)
        if (ssoRequiredResponse !== null) {
          yield* Effect.annotateLogsScoped({ outcome: 'sso_required' })
          return ssoRequiredResponse
        }
        // The same rule's SSO half: the plugin serves any stored connection,
        // so a disabled one is refused before it can start an OIDC flow an
        // owner believes is retired or still untested.
        const disabledSsoResponse = yield* refuseDisabledConnection(request, exchange)
        if (disabledSsoResponse !== null) {
          yield* Effect.annotateLogsScoped({ outcome: 'sso_connection_disabled' })
          return disabledSsoResponse
        }
        // The effectful-better-auth mount: toWeb → auth.handler → fromWeb.
        // The Auth service comes from authRuntime's layer; only the request
        // is provided per call.
        const serverResponse = yield* toHttpEffect(Auth.Tag).pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(request)
          )
        )
        const response = HttpServerResponse.toWeb(serverResponse)
        // Governance audit for credential sign-in attempts (ADR 0025) —
        // best-effort by contract, so it can't fail the auth response. It
        // annotates its own failure reason onto this wide event; the outcome is
        // added below.
        const authAudit = yield* recordAuthAudit(
          exchange,
          response,
          runCapabilities,
          context
        )
        if (authAudit !== 'skipped') {
          yield* Effect.annotateLogsScoped({ authAudit })
        }
        // SSO sign-ins audit through their own path (ADR 0055): the callback
        // redirects name no actor and the event is workspace-scoped.
        yield* recordSsoSignInAudit(exchange, response)
        // Security notification for a two-factor state change (best-effort,
        // same contract as the audit above): the account holder is emailed on
        // every successful enable/disable, so a hijacked session cannot
        // silently take over or strip the second factor.
        yield* notifyTwoFactorChangedEffect(
          exchange,
          response,
          sendNotification,
          context
        )
        yield* Effect.annotateLogsScoped({ outcome: 'ok', statusCode: response.status })
        return response
      }).pipe(Effect.provide(rateLimitLayer))
    )
  )
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request)
    }
  }
})
