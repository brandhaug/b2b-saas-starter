import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
  OpenApi
} from 'effect/unstable/httpapi'
import {
  AssistantPrompt,
  AssistantProvider,
  AssistantReply
} from '@b2b-saas-starter/ai'
import {
  ApiToken,
  AuditEvent,
  AuthorizationDenied,
  CapabilityUnavailable,
  CatalogRefreshRun,
  CreatedApiTokenSchema,
  CreateApiTokenPayload,
  CreateWebhookEndpointPayload,
  ImplementationReport,
  IntegrationSurface,
  InvalidWebhookUrl,
  Member,
  ModuleStatus,
  Notification,
  ReadinessPoint,
  StarterModule,
  StarterModuleWithState,
  WebhookEndpoint,
  Workspace,
  WorkspaceNotFound
} from '@b2b-saas-starter/capabilities'

export class InternalError extends Schema.TaggedErrorClass<InternalError>()(
  'InternalError',
  { traceId: Schema.String },
  { httpApiStatus: 500 }
) {}

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

export class RateLimited extends Schema.TaggedErrorClass<RateLimited>()(
  'RateLimited',
  { bucket: Schema.String },
  { httpApiStatus: 429 }
) {}

/**
 * Declares the bearer security scheme in the OpenAPI document so Scalar's
 * "try it" can send `Authorization: Bearer …`. The worker enforces it in
 * `apps/api/src/auth.ts` (`authorize`). The `error` union here is the shared
 * failure surface of every authenticated route — auth (401/403), rate
 * limiting (429), and — because all capability I/O maps D1/queue outages to
 * `CapabilityUnavailable` — 503. Endpoints list only endpoint-specific errors.
 */
export class BearerAuth extends HttpApiMiddleware.Service<BearerAuth>()(
  '@b2b-saas-starter/api/BearerAuth',
  {
    security: { bearerAuth: HttpApiSecurity.bearer },
    error: [
      InternalError,
      Unauthorized,
      AuthorizationDenied,
      RateLimited,
      CapabilityUnavailable
    ]
  }
) {}

export const SlugParams = Schema.Struct({ slug: Schema.String })

export const WorkspaceOverviewDto = Schema.Struct({
  workspace: Workspace,
  readinessScore: Schema.Number,
  modules: Schema.Array(StarterModuleWithState),
  notifications: Schema.Array(Notification),
  readinessTrend: Schema.Array(ReadinessPoint)
})
export type WorkspaceOverviewDto = typeof WorkspaceOverviewDto.Type

// Workspace routes 404 on an unknown slug; everything shared (auth, rate
// limiting, capability outages) lives on the BearerAuth middleware error union.
const workspaceErrors = [WorkspaceNotFound] as const

export const HealthApi = HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('check', '/health', {
    success: Schema.Struct({ status: Schema.Literal('ok') })
  })
)

export const WorkspaceApi = HttpApiGroup.make('workspace')
  .add(
    HttpApiEndpoint.get('overview', '/workspaces/:slug/overview', {
      params: SlugParams,
      success: WorkspaceOverviewDto,
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.get('modules', '/workspaces/:slug/modules', {
      params: SlugParams,
      success: Schema.Array(StarterModuleWithState),
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.get('members', '/workspaces/:slug/members', {
      params: SlugParams,
      success: Schema.Array(Member),
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.get('notifications', '/workspaces/:slug/notifications', {
      params: SlugParams,
      success: Schema.Array(Notification),
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.get('api-tokens', '/workspaces/:slug/api-tokens', {
      params: SlugParams,
      success: Schema.Array(ApiToken),
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.get('webhooks', '/workspaces/:slug/webhooks', {
      params: SlugParams,
      success: Schema.Array(WebhookEndpoint),
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.get('integrations', '/workspaces/:slug/integrations', {
      params: SlugParams,
      success: Schema.Array(IntegrationSurface),
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.get('reports', '/workspaces/:slug/reports', {
      params: SlugParams,
      success: Schema.Array(ImplementationReport),
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.get('audit-events', '/workspaces/:slug/audit-events', {
      params: SlugParams,
      success: Schema.Array(AuditEvent),
      error: workspaceErrors
    })
  )
  .middleware(BearerAuth)

const TokenIdParams = Schema.Struct({ slug: Schema.String, tokenId: Schema.String })
const RevokedResponse = Schema.Struct({ status: Schema.Literal('revoked') })

export const ApiTokenApi = HttpApiGroup.make('api-token-registry')
  .add(
    HttpApiEndpoint.post('create', '/workspaces/:slug/api-tokens', {
      params: SlugParams,
      payload: CreateApiTokenPayload,
      success: CreatedApiTokenSchema.annotate({ httpApiStatus: 201 }),
      error: workspaceErrors
    })
  )
  .add(
    HttpApiEndpoint.post('revoke', '/workspaces/:slug/api-tokens/:tokenId/revoke', {
      params: TokenIdParams,
      success: RevokedResponse,
      error: workspaceErrors
    })
  )
  .add(
    // Same behavior as `revoke` — REST-style alias the worker also accepts.
    HttpApiEndpoint.delete('delete', '/workspaces/:slug/api-tokens/:tokenId', {
      params: TokenIdParams,
      success: RevokedResponse,
      error: workspaceErrors
    })
  )
  .middleware(BearerAuth)

export const WebhookApi = HttpApiGroup.make('webhook-endpoints')
  .add(
    HttpApiEndpoint.post('create', '/workspaces/:slug/webhooks', {
      params: SlugParams,
      payload: CreateWebhookEndpointPayload,
      success: WebhookEndpoint.annotate({ httpApiStatus: 201 }),
      // `InvalidWebhookUrl` (400) is the SSRF/shape guard on the destination
      // URL — see packages/capabilities webhook-url.ts.
      error: [InvalidWebhookUrl, ...workspaceErrors]
    })
  )
  .middleware(BearerAuth)

/**
 * Wire payload for an invitation. The email-shape check (single `@` with a
 * non-empty local part and domain) plus the length bounds are the whole
 * validation contract — the worker decodes this schema and adds nothing.
 */
export const SendInvitationPayload = Schema.Struct({
  to: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(320),
    Schema.isPattern(/^[^\s@]+@[^\s@]+$/)
  )
})
export type SendInvitationPayload = typeof SendInvitationPayload.Type

export const InvitationApi = HttpApiGroup.make('workspace-invitations')
  .add(
    HttpApiEndpoint.post('send', '/workspaces/:slug/invitations', {
      params: SlugParams,
      payload: SendInvitationPayload,
      // The worker answers 202 Accepted — delivery is asynchronous.
      success: Schema.Struct({
        status: Schema.Literal('queued'),
        delivery: Schema.Unknown
      }).annotate({ httpApiStatus: 202 }),
      error: workspaceErrors
    })
  )
  .middleware(BearerAuth)

export const CatalogApi = HttpApiGroup.make('catalog')
  .add(
    HttpApiEndpoint.get('modules', '/catalog/modules', {
      success: Schema.Array(StarterModule)
    })
  )
  .add(
    HttpApiEndpoint.get('refresh-history', '/catalog/refresh-history', {
      success: Schema.Array(CatalogRefreshRun)
    })
  )
  .middleware(BearerAuth)

export const AssistantApi = HttpApiGroup.make('assistant')
  .add(
    HttpApiEndpoint.post('answer', '/assistant/answer', {
      payload: AssistantPrompt,
      success: Schema.Struct({
        answer: AssistantReply.fields.answer,
        provider: AssistantProvider,
        modelId: AssistantReply.fields.modelId,
        usedTools: AssistantReply.fields.usedTools,
        assistantConfigured: Schema.Boolean
      })
    })
  )
  .middleware(BearerAuth)

/** Minimal MCP tool descriptor — `inputSchema` carries a JSON Schema object. */
export const McpToolDescriptor = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Record(Schema.String, Schema.Unknown)
})
export type McpToolDescriptor = typeof McpToolDescriptor.Type

export const McpDiscovery = Schema.Struct({
  name: Schema.String,
  resources: Schema.Array(Schema.String),
  tools: Schema.Array(McpToolDescriptor)
})

export const McpApi = HttpApiGroup.make('mcp')
  .add(
    HttpApiEndpoint.get('discover', '/mcp', {
      success: McpDiscovery
    }).annotate(
      OpenApi.Description,
      'MCP discovery only — lists resources and tools; tool execution is not yet advertised.'
    )
  )
  .middleware(BearerAuth)

export const ModuleStatusDto = ModuleStatus

export const StarterApi = HttpApi.make('b2b-saas-starter')
  .add(HealthApi)
  .add(WorkspaceApi)
  .add(ApiTokenApi)
  .add(WebhookApi)
  .add(InvitationApi)
  .add(CatalogApi)
  .add(AssistantApi)
  .add(McpApi)
  .annotateMerge(
    OpenApi.annotations({
      title: 'B2B SaaS Starter API',
      version: '0.1.0',
      description:
        'Capability Interface surface for the starter. REST endpoints, MCP discovery (`GET /mcp`), and the assistant share the same capability layer. All routes except `/health` require an `Authorization: Bearer <token>` API token scoped to the workspace in the URL.',
      servers: [{ url: '/', description: 'This worker' }]
    })
  )
