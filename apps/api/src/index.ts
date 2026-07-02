import { Effect, Layer, ManagedRuntime, type Scope } from 'effect'
import { selectAssistantLayer, type WorkersAIBinding } from '@b2b-saas-starter/ai'
import {
  selectEmailDispatcherLayer,
  type SendEmailBinding
} from '@b2b-saas-starter/email'
import {
  selectCapabilitiesLayer,
  selectWorkspaceLayer,
  type ApiTokenRegistry,
  type StarterEnv,
  type WebhookQueueBinding
} from '@b2b-saas-starter/capabilities'
import { makeStarterEnvModuleConfig } from '@b2b-saas-starter/env'
import {
  annotateWide,
  WideEventLoggerLive,
  withHttpRequestScope
} from '@b2b-saas-starter/logger'
import { authorize } from './auth.ts'
import { catchCapabilityUnavailable, catchInvalidInput, json } from './http.ts'
import {
  clientKey,
  makeRateLimiterLayer,
  RateLimiter,
  type RateLimitBindings,
  type RateLimitBucket
} from './rate-limit.ts'
import {
  matchRoute,
  type RouteMatch,
  type StandaloneRoute,
  type WorkspaceRoute
} from './routes.ts'

export type Env = RateLimitBindings & {
  readonly DB?: D1Database
  readonly AI?: WorkersAIBinding
  readonly EMAIL?: SendEmailBinding
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding
  readonly CLOUDFLARE_EMAIL_FROM?: string
  readonly WORKERS_AI_ENABLED?: string
  readonly OPENAI_API_KEY?: string
  readonly OPENAI_BASE_URL?: string
  readonly OPENAI_MODEL_ID?: string
}

const StaticLayer = Layer.mergeAll(WideEventLoggerLive)
const staticRuntime = ManagedRuntime.make(StaticLayer)

// Module-aware env validation (ADR 0035): derive module config status from
// this worker's real env so REST module/integration status reflects the
// deployment instead of stored fixture state.
const starterEnv = (env: Env): StarterEnv => ({
  DB: env.DB,
  WEBHOOK_QUEUE: env.WEBHOOK_QUEUE,
  moduleConfig: makeStarterEnvModuleConfig(env)
})

const checkRateLimit = (
  request: Request,
  bucket: RateLimitBucket
): Effect.Effect<Response | null, never, RateLimiter | Scope.Scope> =>
  Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const allowed = yield* limiter.take({ bucket, key: clientKey(request) })
    if (!allowed) {
      yield* annotateWide({ outcome: 'rate_limited', rateLimitBucket: bucket })
      return json({ error: 'rate_limited' }, { status: 429 })
    }
    return null
  })

// Shared guard preamble: rate limit, then bearer auth. Resolves a short-circuit
// `Response` when the request is denied, `null` when the handler may run.
const guardRoute = (
  request: Request,
  match: RouteMatch
): Effect.Effect<
  Response | null,
  never,
  RateLimiter | ApiTokenRegistry | Scope.Scope
> =>
  Effect.gen(function* () {
    if (match.rateLimit) {
      const denied = yield* checkRateLimit(request, match.rateLimit.bucket)
      if (denied) return denied
    }
    if (match.requiredScope) {
      // Workspace routes bind the bearer token to the workspace in the URL — a
      // valid token for workspace A must not read or mutate workspace B.
      const denied = yield* authorize(
        request,
        match.requiredScope,
        match.kind === 'workspace' ? match.slug : undefined
      )
      if (denied) return denied
    }
    return null
  })

const runStandaloneRoute = (
  request: Request,
  env: Env,
  match: StandaloneRoute
): Effect.Effect<Response, never, Scope.Scope> => {
  const program = Effect.gen(function* () {
    const denied = yield* guardRoute(request, match)
    if (denied) return denied
    return yield* match.handle()
  })

  const requestLayer = Layer.mergeAll(
    selectCapabilitiesLayer(starterEnv(env)),
    selectAssistantLayer(env),
    makeRateLimiterLayer(env)
  )
  return program.pipe(
    Effect.provide(requestLayer),
    catchInvalidInput,
    catchCapabilityUnavailable
  )
}

const runWorkspaceRoute = (
  request: Request,
  env: Env,
  match: WorkspaceRoute
): Effect.Effect<Response, never, Scope.Scope> => {
  const envConfig = starterEnv(env)
  const guardLayer = Layer.mergeAll(
    selectCapabilitiesLayer(envConfig),
    makeRateLimiterLayer(env)
  )
  const handlerLayer = Layer.mergeAll(
    selectWorkspaceLayer(envConfig, match.slug),
    selectEmailDispatcherLayer({
      ...(env.EMAIL ? { EMAIL: env.EMAIL } : {}),
      ...(env.CLOUDFLARE_EMAIL_FROM
        ? { EMAIL_FROM_ADDRESS: env.CLOUDFLARE_EMAIL_FROM }
        : {})
    })
  )

  const program = Effect.gen(function* () {
    yield* annotateWide({ workspaceSlug: match.slug })
    const denied = yield* guardRoute(request, match)
    if (denied) return denied
    return yield* match.handle().pipe(Effect.provide(handlerLayer))
  })

  return program.pipe(
    Effect.provide(guardLayer),
    Effect.catchTag('WorkspaceNotFound', (cause) =>
      annotateWide({ outcome: 'workspace_not_found' }).pipe(
        Effect.as(
          json({ error: 'workspace_not_found', slug: cause.slug }, { status: 404 })
        )
      )
    ),
    catchInvalidInput,
    catchCapabilityUnavailable
  )
}

const handleRequest = (
  request: Request,
  env: Env
): Effect.Effect<Response, never, Scope.Scope> => {
  const match = matchRoute(request, env)
  const event = match?.event ?? 'not_found'

  const program: Effect.Effect<Response, never, Scope.Scope> = Effect.gen(function* () {
    if (!match) {
      yield* annotateWide({ outcome: 'not_found' })
      return json({ error: 'not_found' }, { status: 404 })
    }
    return yield* match.kind === 'workspace'
      ? runWorkspaceRoute(request, env, match)
      : runStandaloneRoute(request, env, match)
  })

  return withHttpRequestScope(
    { service: 'api', event: `request.${event}`, request, env },
    program
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return staticRuntime.runPromise(Effect.scoped(handleRequest(request, env)))
  }
}
