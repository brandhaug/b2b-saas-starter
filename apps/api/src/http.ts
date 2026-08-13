import { FileSystem, Layer, Path } from 'effect'
import { Etag, HttpPlatform, HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { selectAssistantLayer } from '@b2b-saas-starter/ai'
import { StarterApi } from '@b2b-saas-starter/api'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities'
import {
  selectEmailDispatcherLayer,
  type SendEmailBinding
} from '@b2b-saas-starter/email'
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
  // The dispatcher goes live only when both the binding and a sender exist;
  // omit the keys it should not see rather than passing undefined through.
  const emailEnv: { EMAIL?: SendEmailBinding; EMAIL_FROM_ADDRESS?: string } = {}
  if (env.EMAIL) emailEnv.EMAIL = env.EMAIL
  if (fromAddress) emailEnv.EMAIL_FROM_ADDRESS = fromAddress
  const capabilities = Layer.mergeAll(
    selectCapabilitiesLayer(starterEnv(env)),
    selectAssistantLayer(providerEnv(env)),
    selectEmailDispatcherLayer(emailEnv),
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
