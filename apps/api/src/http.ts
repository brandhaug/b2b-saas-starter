import { FileSystem, Layer, Path } from 'effect'
import { Etag, HttpPlatform, HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { selectAssistantLayer } from '@b2b-saas-starter/ai'
import { StarterApi } from '@b2b-saas-starter/api'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities'
import { selectEmailDispatcherLayer } from '@b2b-saas-starter/email'
import { newTraceId, TRACE_HEADER, WideEventLoggerLive } from '@b2b-saas-starter/logger'
import { emailFromAddress, providerEnv, starterEnv, type ApiEnv } from './env.ts'
import {
  appointmentsGroup,
  healthGroup,
  merchantGroup,
  platformApiTokenGroup,
  platformWebhookGroup,
  providersGroup,
  servicesGroup
} from './handlers.ts'
import { makeRateLimiterLayer } from './rate-limit.ts'

// Web-standard platform with no filesystem. HttpApiBuilder requires HttpPlatform
// + FileSystem + Path + Etag for file/multipart responses we never emit; the
// no-op FileSystem and posix Path keep the dependency satisfied on Workers,
// which have no Node runtime.
const PlatformLive = Layer.mergeAll(
  Path.layer,
  Etag.layer,
  FileSystem.layerNoop({}),
  HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({})))
)

const makeApiLayer = (
  env: ApiEnv
): Layer.Layer<never, never, HttpRouter.HttpRouter> => {
  const fromAddress = emailFromAddress(env)
  const capabilities = Layer.mergeAll(
    selectCapabilitiesLayer(starterEnv(env)),
    selectAssistantLayer(providerEnv(env)),
    selectEmailDispatcherLayer({
      ...(env.EMAIL ? { EMAIL: env.EMAIL } : {}),
      ...(fromAddress ? { EMAIL_FROM_ADDRESS: fromAddress } : {})
    }),
    makeRateLimiterLayer(env)
  )

  const groups = Layer.mergeAll(
    healthGroup(env),
    merchantGroup(env),
    servicesGroup(env),
    providersGroup(env),
    appointmentsGroup(env),
    platformApiTokenGroup(env),
    platformWebhookGroup(env)
  )

  const api = HttpApiBuilder.layer(StarterApi, { openapiPath: '/openapi.json' }).pipe(
    Layer.provide(groups)
  )

  return Layer.mergeAll(
    api,
    HttpApiScalar.layer(StarterApi, { path: '/reference' })
  ).pipe(
    HttpRouter.provideRequest(capabilities),
    Layer.provide(PlatformLive),
    Layer.provide(WideEventLoggerLive)
  )
}

export const buildWebHandler = (
  env: ApiEnv
): {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
} => {
  const built = HttpRouter.toWebHandler(makeApiLayer(env), { disableLogger: true })
  return {
    dispose: built.dispose,
    handler: async (request: Request) => {
      const pathname = new URL(request.url).pathname
      if (
        pathname.startsWith('/v1/') &&
        request.method === 'POST' &&
        (await request.clone().arrayBuffer()).byteLength > 16 * 1024
      ) {
        return Response.json(
          {
            error: {
              code: 'invalid_request',
              message: 'The request is invalid.',
              traceId: request.headers.get(TRACE_HEADER) ?? newTraceId(),
              details: { body: 'maximum_16_kib' }
            }
          },
          { status: 400 }
        )
      }
      const response = await built.handler(request)
      if (!pathname.startsWith('/v1/')) return response
      const headers = new Headers(response.headers)
      if (response.status === 401) headers.set('WWW-Authenticate', 'Bearer')
      if (response.status === 429) headers.set('Retry-After', '60')
      if (request.headers.has('authorization')) {
        headers.set('Cache-Control', 'private, no-store')
      }
      headers.delete('Access-Control-Allow-Origin')
      headers.delete('X-RateLimit-Remaining')
      if (!response.ok) {
        const current = await response
          .clone()
          .json()
          .catch(() => null)
        if (!current || typeof current !== 'object' || !('error' in current)) {
          const code =
            response.status === 429
              ? 'rate_limited'
              : response.status === 400
                ? 'invalid_request'
                : response.status >= 500
                  ? 'capability_unavailable'
                  : 'request_failed'
          const currentBucket =
            current &&
            typeof current === 'object' &&
            'bucket' in current &&
            typeof current.bucket === 'string'
              ? current.bucket
              : undefined
          return Response.json(
            {
              error: {
                code,
                message:
                  response.status === 429
                    ? 'Rate limit exceeded.'
                    : 'The request failed.',
                traceId: request.headers.get(TRACE_HEADER) ?? newTraceId(),
                details:
                  response.status === 429
                    ? { bucket: currentBucket ?? 'data_read' }
                    : {}
              }
            },
            { status: response.status, headers }
          )
        }
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    }
  }
}

let cached: ((request: Request) => Promise<Response>) | undefined
export const getWebHandler = (
  env: ApiEnv
): ((request: Request) => Promise<Response>) => {
  if (!cached) cached = buildWebHandler(env).handler
  return cached
}
