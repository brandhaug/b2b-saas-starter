import { WideEventLoggerLive } from '@b2b-saas-starter/logger'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { StarterApi } from '@b2b-saas-starter/api'
import { selectAssistantLayer } from '@b2b-saas-starter/ai'
import { FileSystem, Layer, Path, Effect } from 'effect'
import {
  Etag,
  HttpPlatform,
  HttpRouter,
  HttpServerResponse
} from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { starterEnv, type ApiEnv } from './env.ts'
import {
  apiTokenGroup,
  assistantGroup,
  healthGroup,
  mcpGroup,
  webhookGroup,
  workspaceGroup
} from './handlers.ts'
import { bearerAuth } from './request-guards.ts'
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

// The root index — a tiny machine-readable directory for clients and humans
// who curl the origin. It rides beside the contract like the MCP protocol
// route (see mcp.ts): static metadata, not a REST operation, so it never
// appears in the OpenAPI document or the permission matrix. Paths are
// relative so the index is correct on any host.
const rootIndexLayer = HttpRouter.add('GET', '/', () =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe({
      name: 'b2b-saas-starter-api',
      description:
        'Starter REST + MCP API. All routes except /health require an Authorization: Bearer API token.',
      health: '/health',
      openapi: '/openapi.json',
      docs: '/reference',
      mcp: '/mcp'
    })
  )
)

function makeApiLayer(env: ApiEnv): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  const capabilities = Layer.mergeAll(
    selectCapabilitiesLayer(starterEnv(env)),
    selectAssistantLayer(env),
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
    Layer.provide(groups),
    // The contract's bearer gate: declared in `packages/api`, implemented in
    // `request-guards.ts`, attached to every group but `health`.
    Layer.provide(bearerAuth(env))
  )

  return Layer.mergeAll(
    api,
    // The MCP protocol route rides beside the contract: same router, same
    // capability layer, but a JSON-RPC wire shape the OpenAPI document must
    // not describe. See `mcp.ts`.
    mcpProtocolLayer(env),
    // The root directory — see the comment on `rootIndexLayer`.
    rootIndexLayer,
    HttpApiScalar.layer(StarterApi, { path: '/reference' })
  ).pipe(
    HttpRouter.provideRequest(capabilities),
    // `BearerAuth` resolves its services (token registry, rate limiter) from
    // the group layers' build context rather than per request, so the same
    // `capabilities` layer value is provided here too. One value, one build:
    // the memo map `provideRequest` forks reuses what this provide already
    // constructed, so the middleware and the handlers share one instance of
    // every capability service.
    Layer.provide(capabilities),
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
