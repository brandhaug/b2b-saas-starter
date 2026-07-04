import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { Effect, ManagedRuntime } from 'effect'
import {
  annotateWide,
  WideEventLoggerLive,
  withHttpRequestScope
} from '@b2b-saas-starter/logger'
import { clientKey, makeRateLimiterLayer, RateLimiter } from '@/lib/rate-limit'
import { recordAuthAudit } from '@/lib/server/auth-audit'
import { createServerContext } from '@/lib/server-context'

const authRuntime = ManagedRuntime.make(WideEventLoggerLive)

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
        const response = yield* Effect.promise(() =>
          createServerContext().auth().handler(request)
        )
        // Governance audit for credential sign-in attempts (ADR 0025) —
        // best-effort by contract, so it can't fail the auth response, but a
        // dropped write is surfaced on the wide event.
        const authAudit = yield* Effect.promise(() =>
          recordAuthAudit(request, response)
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
