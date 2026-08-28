import { WideEventLoggerLive } from '@b2b-saas-starter/logger'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { StarterApi } from '@b2b-saas-starter/api'
import { selectAssistantLayer } from '@b2b-saas-starter/ai'
import { FileSystem, Layer, Path } from 'effect'
import { Etag, HttpPlatform, HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { providerEnv, starterEnv, type ApiEnv } from './env.ts'
import {
  apiTokenGroup,
  assistantGroup,
  healthGroup,
  mcpGroup,
  webhookGroup,
  workspaceGroup
} from './handlers.ts'
import { makeRateLimiterLayer } from './rate-limit.ts'
import { mcpProtocolLayer } from './mcp.ts'

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

function makeApiLayer(env: ApiEnv): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  const capabilities = Layer.mergeAll(
    selectCapabilitiesLayer(starterEnv(env)),
    selectAssistantLayer(providerEnv(env)),
    makeRateLimiterLayer(env)
  )

  const groups = Layer.mergeAll(
    healthGroup(env),
    workspaceGroup(env),
    apiTokenGroup(env),
    webhookGroup(env),
    assistantGroup(env),
    mcpGroup(env)
  )

  const api = HttpApiBuilder.layer(StarterApi, { openapiPath: '/openapi.json' }).pipe(
    Layer.provide(groups)
  )

  return Layer.mergeAll(
    api,
    // The MCP protocol route rides beside the contract: same router, same
    // capability layer, but a JSON-RPC wire shape the OpenAPI document must
    // not describe. See `mcp.ts`.
    mcpProtocolLayer(env),
    HttpApiScalar.layer(StarterApi, { path: '/reference' })
  ).pipe(
    HttpRouter.provideRequest(capabilities),
    Layer.provide(PlatformLive),
    // Only the always-on loggers belong to the per-isolate router layer. OTLP
    // export is attached per request in `observed` (handlers.ts) — a Worker may
    // not perform I/O for a request that already ended, so an exporter built
    // here would stop flushing after the first request. See `makeOtlpLayer`.
    Layer.provide(WideEventLoggerLive)
  )
}

export function buildWebHandler(env: ApiEnv): {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
} {
  return HttpRouter.toWebHandler(makeApiLayer(env), { disableLogger: true })
}

let cached: ((request: Request) => Promise<Response>) | undefined
export function getWebHandler(env: ApiEnv): (request: Request) => Promise<Response> {
  if (!cached) {
    cached = buildWebHandler(env).handler
  }
  return cached
}
