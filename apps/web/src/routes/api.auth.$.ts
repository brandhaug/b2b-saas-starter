import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { Effect, ManagedRuntime } from 'effect'
import {
  annotateWide,
  readTraceHeader,
  readWideEventEnvironment,
  WideEventLoggerLive,
  withRequestScope
} from '@b2b-saas-starter/logger'
import { clientKey, makeRateLimiterLayer, RateLimiter } from '@/lib/rate-limit'
import { createServerContext } from '@/lib/server-context'

const authRuntime = ManagedRuntime.make(WideEventLoggerLive)

const processEnv = (): object | undefined =>
  typeof process === 'undefined' ? undefined : process.env

const cloudflareColo = (request: Request): string | undefined => {
  const cf = 'cf' in request ? request.cf : undefined
  return typeof cf === 'object' &&
    cf !== null &&
    'colo' in cf &&
    typeof cf.colo === 'string'
    ? cf.colo
    : undefined
}

async function handleAuth(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const cfColo = cloudflareColo(request)
  const bucket = request.method === 'POST' ? 'auth_write' : 'auth_read'
  const rateLimitLayer = makeRateLimiterLayer(env)

  return authRuntime.runPromise(
    withRequestScope(
      {
        service: 'web',
        event: 'auth.request',
        traceId: readTraceHeader(request),
        environment: readWideEventEnvironment(
          processEnv(),
          cfColo ? { colo: cfColo } : undefined
        ),
        metadata: { pathname: url.pathname, method: request.method }
      },
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
