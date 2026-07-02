import { FileSystem, Layer, Path } from 'effect'
import { Etag, HttpPlatform, HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { selectAssistantLayer } from '@b2b-saas-starter/ai'
import { StarterApi } from '@b2b-saas-starter/api'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities'
import { selectEmailDispatcherLayer } from '@b2b-saas-starter/email'
import { WideEventLoggerLive } from '@b2b-saas-starter/logger'
import { emailFromAddress, providerEnv, starterEnv, type ApiEnv } from './env.ts'
import {
  apiTokenGroup,
  assistantGroup,
  catalogGroup,
  healthGroup,
  invitationGroup,
  mcpGroup,
  webhookGroup,
  workspaceGroup
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
    workspaceGroup(env),
    apiTokenGroup(env),
    webhookGroup(env),
    invitationGroup(env),
    catalogGroup(env),
    assistantGroup(env),
    mcpGroup(env)
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
} => HttpRouter.toWebHandler(makeApiLayer(env), { disableLogger: true })

let cached: ((request: Request) => Promise<Response>) | undefined
export const getWebHandler = (
  env: ApiEnv
): ((request: Request) => Promise<Response>) => {
  if (!cached) cached = buildWebHandler(env).handler
  return cached
}
