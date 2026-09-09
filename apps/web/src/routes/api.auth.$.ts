import { Auth } from '@b2b-saas-starter/auth'
import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'
import { handleWebRequest } from 'effectful-better-auth'
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
  exchangeRow,
  type AuthExchange,
  type CredentialChange
} from '@/lib/server/auth-audit/exchanges'
import { recordAuthAudit } from '@/lib/server/auth-audit/record'
import { recordSsoSignInAudit } from '@/lib/server/auth-audit/sso-sign-in'
import { readAndReportBody, readRequestUserId } from '@/lib/server/auth-audit/shared'
import { enforceTwoFactorSignIn } from '@/lib/server/two-factor-sign-in-gate'
import { makeTurnstileLayer } from '@/lib/server/turnstile.effects'
import {
  sendBackupCodesRotatedEmail,
  sendPasskeyChangedEmail,
  sendPasswordChangedEmail,
  sendTwoFactorChangedEmail,
  recipientLocale
} from '@/lib/server/auth-emails'
import { notifyCredentialChangedEffect } from '@/lib/server/credential-change-notification'
import { TurnstileVerifier } from '@b2b-saas-starter/capabilities/governance/turnstile-verification'
import { recordEvidence } from '@/lib/server/security-evidence-sink'
import { runAuthRequestGuards } from '@/lib/server/auth-request-guard'

/**
 * The credential-change sender, bound to the provider-light email dispatcher:
 * the change the row names picks the email's wording — one case per kind, the
 * table is the only place that decides which fire. Exhaustive on purpose: a
 * new `CredentialChange` kind is a compile error here, not a silent
 * backup-codes email for a change that never rotated any.
 */
async function sendCredentialChangeEmail(input: {
  readonly email: string
  readonly change: CredentialChange
}) {
  const locale = await recipientLocale(input.email)
  switch (input.change.kind) {
    case 'two-factor': {
      return sendTwoFactorChangedEmail({
        email: input.email,
        enabled: input.change.enabled,
        locale
      })
    }
    case 'passkey': {
      return sendPasskeyChangedEmail({
        email: input.email,
        added: input.change.added,
        locale
      })
    }
    case 'password': {
      return sendPasswordChangedEmail({ email: input.email, locale })
    }
    case 'backup-codes': {
      return sendBackupCodesRotatedEmail({ email: input.email, locale })
    }
  }
}

/**
 * The Turnstile gates (ADR 0031): when TURNSTILE is configured, the widget's
 * token must ride the `x-turnstile-token` header and verify against
 * siteverify before Better Auth sees the request. Gated surfaces are the ones
 * an anonymous visitor can point at somebody else's inbox — sign-up and the
 * magic-link send. Unconfigured, `verify` returns `inactive` and the request
 * passes through untouched — provider-light local development is unaffected.
 * Returns a JSON error response for `rejected` / `unavailable`, or `undefined`
 * to let the request proceed. Runs OUTSIDE the request scope (no
 * `Effect.annotateLogsScoped` here); the caller annotates the wide event from
 * the response it gets back.
 */
const TURNSTILE_GATED_POST_PATHS = ['/sign-up/email', '/sign-in/magic-link']

function verifyTurnstile(
  request: Request,
  exchange: AuthExchange
): Effect.Effect<Response | null> {
  if (
    exchange.method !== 'POST' ||
    !TURNSTILE_GATED_POST_PATHS.some((suffix) => exchange.pathname.endsWith(suffix))
  ) {
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
        const turnstileResponse = yield* verifyTurnstile(request, exchange)
        if (turnstileResponse !== null) {
          yield* Effect.annotateLogsScoped({
            outcome: 'turnstile_blocked',
            turnstileStatus: turnstileResponse.status
          })
          return turnstileResponse
        }
        const guardedRequest = yield* runAuthRequestGuards(
          request,
          exchange,
          (pluginRequest) => handleWebRequest(Auth.Tag, pluginRequest)
        )
        if (guardedRequest.outcome === 'refused') {
          return guardedRequest.response
        }
        const { response, context } = guardedRequest
        // The two-factor gate for the mailbox-only sign-ins (the email-OTP
        // verify and the magic-link consume): the plugin's challenge hook
        // covers the credential endpoints, so these two would otherwise mint
        // a session from mailbox possession alone. Post-handler by design —
        // the refusal replaces only a SUCCESS, so a probe that fails Better
        // Auth's own checks learns nothing about who has 2FA on (ADR 0056's
        // passkey bypass stays deliberate; social/SSO delegate MFA to the
        // IdP). `null` = the handler's response stands.
        const twoFactorResponse = yield* enforceTwoFactorSignIn(exchange, response)
        const finalResponse = twoFactorResponse ?? response
        // Governance audit for credential sign-in attempts (ADR 0025) —
        // best-effort by contract, so it can't fail the auth response. It
        // annotates its own failure reason onto this wide event; the outcome is
        // added below. A gate refusal is audited as the failed sign-in it is:
        // the table reads the final response, not the one it replaced.
        const authAudit = yield* recordAuthAudit(
          exchange,
          finalResponse,
          runCapabilities,
          context
        )
        if (authAudit !== 'skipped') {
          yield* Effect.annotateLogsScoped({ authAudit })
        }
        // SSO sign-ins audit through their own path (ADR 0069): the callback
        // redirects name no actor and the event is workspace-scoped.
        yield* recordSsoSignInAudit(exchange, finalResponse)
        // Security notification for a credential change (best-effort, same
        // contract as the audit above): the account holder is emailed on
        // every successful second-factor, passkey, or password change, so a
        // hijacked session cannot silently take over the account or enroll or
        // strip a sign-in credential.
        yield* notifyCredentialChangedEffect(
          exchange,
          finalResponse,
          sendCredentialChangeEmail,
          context
        )
        if (finalResponse.ok) {
          const row = exchangeRow(exchange)
          let evidence:
            | {
                readonly kind:
                  | 'account_deleted'
                  | 'credential_changed'
                  | 'sessions_revoked'
                readonly subjectId: string
              }
            | undefined
          if (row?.notifyOnSuccess !== undefined && context !== undefined) {
            evidence = { kind: 'credential_changed', subjectId: context.actorUserId }
          } else if (
            exchange.pathname.endsWith('/admin/remove-user') ||
            exchange.pathname.endsWith('/admin/set-user-password') ||
            exchange.pathname.endsWith('/admin/revoke-user-session') ||
            exchange.pathname.endsWith('/admin/revoke-user-sessions')
          ) {
            const target = context?.request
              ? yield* readAndReportBody(readRequestUserId(context.request))
              : null
            if (target !== null) {
              let kind: 'account_deleted' | 'credential_changed' | 'sessions_revoked' =
                'credential_changed'
              if (exchange.pathname.endsWith('/admin/remove-user')) {
                kind = 'account_deleted'
              } else if (exchange.pathname.includes('/revoke-user-')) {
                kind = 'sessions_revoked'
              }
              evidence = {
                kind,
                subjectId: target
              }
            }
          } else if (
            exchange.pathname.endsWith('/sign-out') ||
            exchange.pathname.endsWith('/user/revoke-session') ||
            exchange.pathname.endsWith('/user/revoke-sessions')
          ) {
            if (context !== undefined) {
              evidence = { kind: 'sessions_revoked', subjectId: context.actorUserId }
            }
          } else if (exchange.pathname.endsWith('/reset-password')) {
            // Better Auth's anonymous reset response names no user. `*` makes
            // restore sanitation invalidate every restored credential rather
            // than risk reopening the password that this request replaced.
            evidence = { kind: 'credential_changed', subjectId: '*' }
          } else if (exchange.pathname.endsWith('/unlink-account') && context) {
            evidence = { kind: 'credential_changed', subjectId: context.actorUserId }
          }
          if (evidence !== undefined) {
            yield* recordEvidence(evidence.kind, evidence.subjectId)
          }
        }
        // A gate refusal is this exchange's outcome; 'ok' would lie about a
        // session the gate just revoked. `finalResponse` carries either
        // story: it is the refusal itself when one replaced the handler's
        // answer.
        yield* Effect.annotateLogsScoped({
          outcome: twoFactorResponse === null ? 'ok' : 'two_factor_required',
          statusCode: finalResponse.status
        })
        return finalResponse
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
