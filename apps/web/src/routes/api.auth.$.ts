import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { toHttpEffect } from 'effectful-better-auth'
import { Auth } from '@b2b-saas-starter/auth'
import { annotateWide } from '@b2b-saas-starter/logger'
import { authRuntime } from '@/lib/auth-runtime'
import { withWebRequestScope } from '@/lib/observability'
import { clientKey, makeRateLimiterLayer, RateLimiter } from '@/lib/rate-limit'
import { runCapabilities } from '@/lib/capabilities'
import {
  needsPreHandlerActor,
  recordAuthAudit,
  type AuthAuditContext
} from '@/lib/server/auth-audit'

/**
 * Everything the audits whose responses never name their actor need, gathered
 * BEFORE the auth handler consumes the request: the acting user's session id
 * (admin responses never name their actor; sign-out and the session
 * revocations name nobody) and, for admin mutations, a clone of the JSON body
 * (`userId` target). `undefined` for anything else, or a request that carries
 * no session — anonymous probes are rate-limited noise.
 */
async function readAuthAuditContext(
  request: Request
): Promise<AuthAuditContext | undefined> {
  const method = request.method
  const pathname = new URL(request.url).pathname
  if (method !== 'POST' || !needsPreHandlerActor({ method, pathname })) {
    return undefined
  }
  // The clone is taken before the handler runs — Better Auth consumes the
  // original request's body. A failed session read must never fail the auth
  // request it observes.
  const requestClone = request.clone()
  const session = await authRuntime
    .runPromise(
      withWebRequestScope(
        { event: 'auth.session' },
        Effect.flatMap(Auth.Tag, (auth) =>
          auth.api.getSession({ headers: request.headers })
        )
      )
    )
    .catch(() => null)
  if (!session) return undefined
  return { actorUserId: session.user.id, request: requestClone }
}

async function handleAuth(request: Request): Promise<Response> {
  const bucket = request.method === 'POST' ? 'auth_write' : 'auth_read'
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
          yield* annotateWide({ outcome: 'rate_limited' })
          return new Response(JSON.stringify({ error: 'rate_limited' }), {
            status: 429,
            headers: { 'content-type': 'application/json; charset=utf-8' }
          })
        }
        // Pre-handler audit context before Better Auth runs: it reads the
        // session and — for admin mutations — a body clone that the handler's
        // consumption of the request would otherwise make unreadable.
        const context = yield* Effect.promise(() => readAuthAuditContext(request))
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
          request,
          response,
          runCapabilities,
          context
        )
        if (authAudit !== 'skipped') {
          yield* annotateWide({ authAudit })
        }
        yield* annotateWide({ outcome: 'ok', statusCode: response.status })
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
