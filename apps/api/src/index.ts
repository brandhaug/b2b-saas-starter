import { Effect, Layer, ManagedRuntime, Result, Schema, type Scope } from 'effect'
import {
  AssistantPrompt,
  AssistantService,
  isAssistantConfigured,
  selectAssistantLayer,
  type WorkersAIBinding
} from '@b2b-saas-starter/ai'
import {
  EmailDispatcher,
  selectEmailDispatcherLayer,
  WorkspaceInvitationEmail,
  type SendEmailBinding
} from '@b2b-saas-starter/email'
import {
  AdoptionReadiness,
  ApiTokenRegistry,
  ApiTokenScope,
  AuditEventLog,
  CatalogRefreshHistory,
  CreateApiTokenPayload,
  ImplementationReports,
  IntegrationSurfaces,
  NotificationFeed,
  projectReadiness,
  selectCapabilitiesLayer,
  selectWorkspaceLayer,
  StarterModuleCatalog,
  WebhookEndpoints,
  WorkspaceContext,
  WorkspaceMembership,
  type CapabilityServices
} from '@b2b-saas-starter/capabilities'
import {
  annotateWide,
  readTraceHeader,
  readWideEventEnvironment,
  WideEventLoggerLive,
  withRequestScope
} from '@b2b-saas-starter/logger'
import { openApiDocument } from './openapi.ts'
import { scalarReference } from './reference.ts'
import {
  clientKey,
  makeRateLimiterLayer,
  RateLimiter,
  type RateLimitBindings,
  type RateLimitBucket
} from './rate-limit.ts'

type Env = RateLimitBindings & {
  readonly DB?: D1Database
  readonly AI?: WorkersAIBinding
  readonly EMAIL?: SendEmailBinding
  readonly EMAIL_FROM_ADDRESS?: string
  readonly WORKERS_AI_ENABLED?: string
  readonly OPENAI_API_KEY?: string
  readonly OPENAI_BASE_URL?: string
  readonly OPENAI_MODEL_ID?: string
}

const writeScopeResources = new Set(['api-tokens', 'webhooks'])
const WorkspaceInvitationBody = Schema.Struct({
  to: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(320))
})

const json = (body: unknown, init?: ResponseInit): Response => {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body, null, 2), { ...init, headers })
}

const StaticLayer = Layer.mergeAll(WideEventLoggerLive)
const staticRuntime = ManagedRuntime.make(StaticLayer)

type WorkspaceServices = CapabilityServices | WorkspaceContext

const workspaceOverviewEffect = Effect.gen(function* () {
  const ctx = yield* WorkspaceContext
  const catalog = yield* StarterModuleCatalog
  const feed = yield* NotificationFeed
  const readiness = yield* AdoptionReadiness
  const [modules, notifications, readinessTrend] = yield* Effect.all(
    [catalog.listModules, feed.list, readiness.getTrend],
    { concurrency: 'unbounded' }
  )
  const readinessSnapshot = projectReadiness(modules.map((module) => module.state))
  return {
    workspace: ctx.workspace,
    readinessScore: readinessSnapshot.score,
    modules,
    notifications,
    readinessTrend
  }
})

const workspaceResourceEffect = (
  resource: string
): Effect.Effect<unknown, never, WorkspaceServices> => {
  switch (resource) {
    case 'overview':
      return workspaceOverviewEffect
    case 'modules':
      return Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        return yield* catalog.listModules
      })
    case 'members':
      return Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        return yield* membership.listMembers
      })
    case 'notifications':
      return Effect.gen(function* () {
        const feed = yield* NotificationFeed
        return yield* feed.list
      })
    case 'api-tokens':
      return Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        return yield* tokens.list
      })
    case 'webhooks':
      return Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        return yield* webhooks.list
      })
    case 'integrations':
      return Effect.gen(function* () {
        const integrations = yield* IntegrationSurfaces
        return yield* integrations.list
      })
    case 'reports':
      return Effect.gen(function* () {
        const reports = yield* ImplementationReports
        return yield* reports.list
      })
    case 'audit-events':
      return Effect.gen(function* () {
        const log = yield* AuditEventLog
        return yield* log.list
      })
    default:
      return Effect.die(new Error(`unknown resource ${resource}`))
  }
}

const respond = <Success, R>(
  effect: Effect.Effect<Success, never, R>
): Effect.Effect<Response, never, R | Scope.Scope> =>
  effect.pipe(
    Effect.flatMap((value) =>
      annotateWide({ outcome: 'ok' }).pipe(Effect.as(json(value)))
    )
  )

const decodeJsonBody = (request: Request): Effect.Effect<unknown> =>
  Effect.promise(async () => {
    try {
      return (await request.json()) as unknown
    } catch {
      return null
    }
  })

const createTokenEffect = (
  request: Request
): Effect.Effect<Response, never, ApiTokenRegistry | WorkspaceContext | Scope.Scope> =>
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownOption(CreateApiTokenPayload)(
      yield* decodeJsonBody(request)
    )
    if (decoded._tag === 'None') {
      yield* annotateWide({ outcome: 'invalid_api_token_input' })
      return json({ error: 'invalid_api_token_input' }, { status: 400 })
    }
    const tokens = yield* ApiTokenRegistry
    const created = yield* tokens.create({
      name: decoded.value.name,
      scopes: decoded.value.scopes
    })
    yield* annotateWide({
      outcome: 'created',
      tokenId: created.id,
      tokenScopes: created.scopes
    })
    return json(created, { status: 201 })
  })

const revokeTokenEffect = (
  tokenId: string
): Effect.Effect<Response, never, ApiTokenRegistry | WorkspaceContext | Scope.Scope> =>
  Effect.gen(function* () {
    const tokens = yield* ApiTokenRegistry
    yield* tokens.revoke({ tokenId })
    yield* annotateWide({ outcome: 'revoked' })
    return json({ status: 'revoked' })
  })

const invitationEffect = (
  request: Request,
  env: Env
): Effect.Effect<Response, never, WorkspaceContext | EmailDispatcher | Scope.Scope> =>
  Effect.gen(function* () {
    const body = Schema.decodeUnknownOption(WorkspaceInvitationBody)(
      yield* decodeJsonBody(request)
    )
    if (body._tag === 'None' || !body.value.to.includes('@')) {
      yield* annotateWide({ outcome: 'invalid_invitation_input' })
      return json({ error: 'invalid_invitation_input' }, { status: 400 })
    }
    const ctx = yield* WorkspaceContext
    yield* annotateWide({
      workspaceId: ctx.workspace.id,
      workspaceName: ctx.workspace.name
    })
    const inviteUrl = `${new URL(request.url).origin}/invitations/accept?workspace=${ctx.workspace.slug}`
    const dispatcher = yield* EmailDispatcher
    const delivery = yield* Effect.result(
      dispatcher.send({
        from: env.EMAIL_FROM_ADDRESS ?? 'noreply@example.com',
        to: body.value.to,
        subject: `You are invited to ${ctx.workspace.name}`,
        element: WorkspaceInvitationEmail({
          workspaceName: ctx.workspace.name,
          inviteUrl
        })
      })
    )
    if (Result.isFailure(delivery)) {
      yield* annotateWide({
        outcome: 'invitation_send_failed',
        emailError: delivery.failure.message
      })
      return json({ error: 'invitation_send_failed' }, { status: 502 })
    }
    yield* annotateWide({ outcome: 'queued' })
    return json({ status: 'queued', delivery: delivery.success }, { status: 202 })
  })

const answerAssistantEffect = (
  request: Request,
  env: Env
): Effect.Effect<Response, never, AssistantService | Scope.Scope> =>
  Effect.gen(function* () {
    const body = yield* decodeJsonBody(request)
    const decoded = Schema.decodeUnknownOption(AssistantPrompt)(body)
    if (decoded._tag === 'None') {
      yield* annotateWide({ outcome: 'invalid_prompt' })
      return json({ error: 'invalid_prompt' }, { status: 400 })
    }
    const service = yield* AssistantService
    const reply = yield* Effect.result(service.ask(decoded.value))
    if (Result.isFailure(reply)) {
      yield* annotateWide({
        outcome: 'assistant_unavailable',
        assistantError: reply.failure.reason
      })
      return json({ error: 'assistant_unavailable' }, { status: 503 })
    }
    yield* annotateWide({ outcome: 'ok' })
    return json({
      ...reply.success,
      assistantConfigured: isAssistantConfigured(env)
    })
  })

const catalogModulesHandler: Effect.Effect<Response, never, StarterModuleCatalog> =
  Effect.gen(function* () {
    const catalog = yield* StarterModuleCatalog
    const modules = yield* catalog.listAllModules
    return json(modules)
  })

const catalogRefreshHistoryHandler: Effect.Effect<
  Response,
  never,
  CatalogRefreshHistory
> = Effect.gen(function* () {
  const history = yield* CatalogRefreshHistory
  const recent = yield* history.listRecent
  return json(recent)
})

const mcpDiscoverResponse = (): Response =>
  json({
    name: 'b2b-saas-starter-mcp',
    resources: ['workspace://starter-lab/overview'],
    tools: []
  })

type WorkspaceRoute = {
  readonly kind: 'workspace'
  readonly event: string
  readonly slug: string
  readonly handle: () => Effect.Effect<
    Response,
    never,
    WorkspaceServices | EmailDispatcher | Scope.Scope
  >
  readonly rateLimit?: { readonly bucket: RateLimitBucket }
  readonly requiredScope?: ApiTokenScope
}

type StandaloneRoute = {
  readonly kind: 'standalone'
  readonly event: string
  readonly handle: () => Effect.Effect<
    Response,
    never,
    | StarterModuleCatalog
    | CatalogRefreshHistory
    | ApiTokenRegistry
    | AssistantService
    | Scope.Scope
  >
  readonly rateLimit?: { readonly bucket: RateLimitBucket }
  readonly requiredScope?: ApiTokenScope
}

type RouteMatch = WorkspaceRoute | StandaloneRoute

const matchRoute = (request: Request, env: Env): RouteMatch | null => {
  const url = new URL(request.url)

  if (url.pathname === '/health') {
    return {
      kind: 'standalone',
      event: 'health',
      handle: () => Effect.succeed(json({ status: 'ok' }))
    }
  }
  if (url.pathname === '/openapi.json') {
    return {
      kind: 'standalone',
      event: 'openapi',
      handle: () => Effect.succeed(json(openApiDocument))
    }
  }
  if (url.pathname === '/reference') {
    return {
      kind: 'standalone',
      event: 'reference',
      handle: () => Effect.succeed(scalarReference())
    }
  }

  const workspacePath = url.pathname.match(
    /^\/workspaces\/(?<slug>[^/]+)\/(?<resource>overview|modules|members|notifications|api-tokens|webhooks|integrations|reports|audit-events)$/
  )
  if (
    workspacePath?.groups?.slug &&
    workspacePath.groups.resource &&
    request.method === 'GET'
  ) {
    const slug = workspacePath.groups.slug
    const resource = workspacePath.groups.resource
    return {
      kind: 'workspace',
      event: `workspace.${resource}`,
      slug,
      rateLimit: { bucket: 'rest_read' },
      requiredScope: writeScopeResources.has(resource) ? 'write' : 'read',
      handle: () => respond(workspaceResourceEffect(resource))
    }
  }

  const createTokenPath = url.pathname.match(
    /^\/workspaces\/(?<slug>[^/]+)\/api-tokens$/
  )
  if (createTokenPath?.groups?.slug && request.method === 'POST') {
    return {
      kind: 'workspace',
      event: 'workspace.api-tokens.create',
      slug: createTokenPath.groups.slug,
      rateLimit: { bucket: 'rest_write' },
      requiredScope: 'admin',
      handle: () => createTokenEffect(request)
    }
  }

  const revokeTokenPath =
    url.pathname.match(
      /^\/workspaces\/(?<slug>[^/]+)\/api-tokens\/(?<tokenId>[^/]+)\/revoke$/
    ) ??
    url.pathname.match(/^\/workspaces\/(?<slug>[^/]+)\/api-tokens\/(?<tokenId>[^/]+)$/)
  if (
    revokeTokenPath?.groups?.slug &&
    revokeTokenPath.groups.tokenId &&
    (request.method === 'POST' || request.method === 'DELETE')
  ) {
    const tokenId = revokeTokenPath.groups.tokenId
    return {
      kind: 'workspace',
      event: 'workspace.api-tokens.revoke',
      slug: revokeTokenPath.groups.slug,
      rateLimit: { bucket: 'rest_write' },
      requiredScope: 'admin',
      handle: () => revokeTokenEffect(tokenId)
    }
  }

  if (url.pathname === '/catalog/modules') {
    return {
      kind: 'standalone',
      event: 'catalog.modules',
      rateLimit: { bucket: 'rest_read' },
      requiredScope: 'read',
      handle: () => catalogModulesHandler
    }
  }

  if (url.pathname === '/catalog/refresh-history') {
    return {
      kind: 'standalone',
      event: 'catalog.refresh-history',
      rateLimit: { bucket: 'rest_read' },
      requiredScope: 'read',
      handle: () => catalogRefreshHistoryHandler
    }
  }

  if (url.pathname === '/mcp') {
    return {
      kind: 'standalone',
      event: 'mcp.discover',
      rateLimit: { bucket: 'mcp' },
      requiredScope: 'read',
      handle: () => Effect.succeed(mcpDiscoverResponse())
    }
  }

  const invitationPath = url.pathname.match(
    /^\/workspaces\/(?<slug>[^/]+)\/invitations$/
  )
  if (invitationPath?.groups?.slug && request.method === 'POST') {
    return {
      kind: 'workspace',
      event: 'workspace.invitations.send',
      slug: invitationPath.groups.slug,
      rateLimit: { bucket: 'invitations' },
      requiredScope: 'admin',
      handle: () => invitationEffect(request, env)
    }
  }

  if (url.pathname === '/assistant/answer' && request.method === 'POST') {
    return {
      kind: 'standalone',
      event: 'assistant.answer',
      rateLimit: { bucket: 'assistant' },
      handle: () => answerAssistantEffect(request, env)
    }
  }

  return null
}

const bearerToken = (request: Request): string | null => {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

const authorize = (
  request: Request,
  requiredScope: ApiTokenScope
): Effect.Effect<Response | null, never, ApiTokenRegistry | Scope.Scope> => {
  const token = bearerToken(request)
  if (!token) {
    return annotateWide({ outcome: 'missing_bearer_token' }).pipe(
      Effect.as(json({ error: 'missing_bearer_token' }, { status: 401 }))
    )
  }
  return Effect.gen(function* () {
    const registry = yield* ApiTokenRegistry
    const verified = yield* Effect.result(
      registry.verifyBearerToken(token, requiredScope)
    )
    if (Result.isFailure(verified)) {
      yield* annotateWide({
        outcome: 'forbidden',
        authReason: verified.failure.reason
      })
      return json({ error: verified.failure.reason }, { status: 403 })
    }
    yield* annotateWide({
      tokenId: verified.success.id,
      workspaceId: verified.success.workspaceId,
      tokenWorkspaceSlug: verified.success.workspaceSlug,
      tokenScopes: verified.success.scopes,
      requiredScope
    })
    return null
  })
}

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

const runStandaloneRoute = (
  request: Request,
  env: Env,
  match: StandaloneRoute
): Effect.Effect<Response, never, Scope.Scope> => {
  const program = Effect.gen(function* () {
    if (match.rateLimit) {
      const denied = yield* checkRateLimit(request, match.rateLimit.bucket)
      if (denied) return denied
    }
    if (match.requiredScope) {
      const denied = yield* authorize(request, match.requiredScope)
      if (denied) return denied
    }
    return yield* match.handle()
  })

  const requestLayer = Layer.mergeAll(
    selectCapabilitiesLayer(env),
    selectAssistantLayer(env),
    makeRateLimiterLayer(env)
  )
  return program.pipe(Effect.provide(requestLayer))
}

const runWorkspaceRoute = (
  request: Request,
  env: Env,
  match: WorkspaceRoute
): Effect.Effect<Response, never, Scope.Scope> => {
  const inner = Effect.gen(function* () {
    yield* annotateWide({ workspaceSlug: match.slug })
    if (match.rateLimit) {
      const denied = yield* checkRateLimit(request, match.rateLimit.bucket)
      if (denied) return denied
    }
    if (match.requiredScope) {
      const denied = yield* authorize(request, match.requiredScope)
      if (denied) return denied
    }
    return yield* match.handle()
  })

  const workspaceLayer = selectWorkspaceLayer(env, match.slug)
  const otherLayers = Layer.mergeAll(
    selectAssistantLayer(env),
    selectEmailDispatcherLayer({
      ...(env.EMAIL ? { EMAIL: env.EMAIL } : {}),
      ...(env.EMAIL_FROM_ADDRESS ? { EMAIL_FROM_ADDRESS: env.EMAIL_FROM_ADDRESS } : {})
    }),
    makeRateLimiterLayer(env)
  )
  return inner.pipe(
    Effect.provide(Layer.mergeAll(workspaceLayer, otherLayers)),
    Effect.catchTag('WorkspaceNotFound', (cause) =>
      annotateWide({ outcome: 'workspace_not_found' }).pipe(
        Effect.as(
          json({ error: 'workspace_not_found', slug: cause.slug }, { status: 404 })
        )
      )
    )
  )
}

const handleRequest = (
  request: Request,
  env: Env
): Effect.Effect<Response, never, Scope.Scope> => {
  const url = new URL(request.url)
  const match = matchRoute(request, env)
  const event = match?.event ?? 'not_found'
  const cf = 'cf' in request ? request.cf : undefined
  const cfColo =
    typeof cf === 'object' && cf !== null && 'colo' in cf && typeof cf.colo === 'string'
      ? cf.colo
      : undefined

  const program: Effect.Effect<Response, never, Scope.Scope> = Effect.gen(function* () {
    if (!match) {
      yield* annotateWide({ outcome: 'not_found' })
      return json({ error: 'not_found' }, { status: 404 })
    }
    return yield* match.kind === 'workspace'
      ? runWorkspaceRoute(request, env, match)
      : runStandaloneRoute(request, env, match)
  })

  return withRequestScope(
    {
      service: 'api',
      event: `request.${event}`,
      traceId: readTraceHeader(request),
      environment: readWideEventEnvironment(env, {
        ...(cfColo ? { colo: cfColo } : {})
      }),
      metadata: { pathname: url.pathname, method: request.method }
    },
    program
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return staticRuntime.runPromise(Effect.scoped(handleRequest(request, env)))
  }
}
