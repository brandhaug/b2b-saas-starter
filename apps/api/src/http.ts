import { FileSystem, Layer, Path } from 'effect'
import { Etag, HttpPlatform, HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { selectAssistantLayer } from '@b2b-saas-starter/ai'
import { StarterApi } from '@b2b-saas-starter/api'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities'
import { selectEmailDispatcherLayer } from '@b2b-saas-starter/email'
import { WideEventLoggerLive } from '@b2b-saas-starter/logger'
import type { ApiEnv } from './env.ts'
import {
  apiTokenGroup,
  assistantGroup,
  catalogGroup,
  healthGroup,
  invitationGroup,
  mcpGroup,
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
  // Capability services for the guards (verifyBearerToken), the catalog group,
  // the assistant, and email. Workspace-scoped routes additionally provide a
  // per-request WorkspaceContext via selectWorkspaceLayer inside the handler.
  const capabilities = Layer.mergeAll(
    selectCapabilitiesLayer(env),
    selectAssistantLayer(env),
    selectEmailDispatcherLayer({
      ...(env.EMAIL ? { EMAIL: env.EMAIL } : {}),
      ...(env.EMAIL_FROM_ADDRESS ? { EMAIL_FROM_ADDRESS: env.EMAIL_FROM_ADDRESS } : {})
    }),
    makeRateLimiterLayer(env)
  )

  const groups = Layer.mergeAll(
    healthGroup(env),
    workspaceGroup(env),
    apiTokenGroup(env),
    invitationGroup(env),
    catalogGroup(env),
    assistantGroup(env),
    mcpGroup(env)
  )

  const api = HttpApiBuilder.layer(StarterApi, { openapiPath: '/openapi.json' }).pipe(
    Layer.provide(groups)
  )

  // Handler service requirements are tracked as request-scoped; provideRequest
  // builds the capability layers once and hands them to each request.
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

// Build the handler once per isolate — the Cloudflare env is stable for the
// isolate's lifetime, and toWebHandler builds the capability + platform layers
// a single time, then reuses them across requests.
let cached: ((request: Request) => Promise<Response>) | undefined
export const getWebHandler = (
  env: ApiEnv
): ((request: Request) => Promise<Response>) => {
  if (!cached) cached = buildWebHandler(env).handler
  return cached
}
