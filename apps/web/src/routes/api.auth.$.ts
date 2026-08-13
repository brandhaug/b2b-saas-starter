import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { toHttpEffect } from 'effectful-better-auth'
import { Auth } from '@b2b-saas-starter/auth'
import { annotateWide, withHttpRequestScope } from '@b2b-saas-starter/logger'
import { authRuntime } from '@/lib/auth-runtime'
import { clientKey, makeRateLimiterLayer, RateLimiter } from '@/lib/rate-limit'
import { recordAuthAudit } from '@/lib/server/auth-audit'

const processEnv = (): object | undefined =>
  typeof process === 'undefined' ? undefined : process.env

async function handleAuth(request: Request): Promise<Response> {
  const bucket = request.method === 'POST' ? 'auth_write' : 'auth_read'
  const rateLimitLayer = makeRateLimiterLayer(env)

  return authRuntime.runPromise(
    withHttpRequestScope(
      { service: 'web', event: 'auth.request', request, env: processEnv() },
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
        const authAudit = yield* recordAuthAudit(request, response)
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
