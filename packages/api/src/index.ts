import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi
} from 'effect/unstable/httpapi'
import {
  AssistantPrompt,
  AssistantProvider,
  AssistantReply,
  AssistantUnavailable
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

const WORKSPACE_ERRORS = [
  WorkspaceNotFound,
  InternalError,
  Unauthorized,
  AuthorizationDenied,
  RateLimited,
  CapabilityUnavailable
] as const

const PROTECTED_ERRORS = [
  InternalError,
  Unauthorized,
  AuthorizationDenied,
  RateLimited,
  CapabilityUnavailable
] as const

export const SlugParams = Schema.Struct({ slug: Schema.String })

export const WorkspaceOverviewDto = Schema.Struct({
  workspace: Workspace,
  readinessScore: Schema.Number,
  modules: Schema.Array(StarterModuleWithState),
  notifications: Schema.Array(Notification),
  readinessTrend: Schema.Array(ReadinessPoint)
})
export type WorkspaceOverviewDto = typeof WorkspaceOverviewDto.Type

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
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('modules', '/workspaces/:slug/modules', {
      params: SlugParams,
      success: Schema.Array(StarterModuleWithState),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('members', '/workspaces/:slug/members', {
      params: SlugParams,
      success: Schema.Array(Member),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('notifications', '/workspaces/:slug/notifications', {
      params: SlugParams,
      success: Schema.Array(Notification),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('api-tokens', '/workspaces/:slug/api-tokens', {
      params: SlugParams,
      success: Schema.Array(ApiToken),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('webhooks', '/workspaces/:slug/webhooks', {
      params: SlugParams,
      success: Schema.Array(WebhookEndpoint),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('integrations', '/workspaces/:slug/integrations', {
      params: SlugParams,
      success: Schema.Array(IntegrationSurface),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('reports', '/workspaces/:slug/reports', {
      params: SlugParams,
      success: Schema.Array(ImplementationReport),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('audit-events', '/workspaces/:slug/audit-events', {
      params: SlugParams,
      success: Schema.Array(AuditEvent),
      error: WORKSPACE_ERRORS
    })
  )

const TokenIdParams = Schema.Struct({ slug: Schema.String, tokenId: Schema.String })
const RevokedResponse = Schema.Struct({ status: Schema.Literal('revoked') })

export const ApiTokenApi = HttpApiGroup.make('api-token-registry')
  .add(
    HttpApiEndpoint.post('create', '/workspaces/:slug/api-tokens', {
      params: SlugParams,
      payload: CreateApiTokenPayload,
      success: CreatedApiTokenSchema.pipe(HttpApiSchema.status(201)),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.post('revoke', '/workspaces/:slug/api-tokens/:tokenId/revoke', {
      params: TokenIdParams,
      success: RevokedResponse,
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.delete('delete', '/workspaces/:slug/api-tokens/:tokenId', {
      params: TokenIdParams,
      success: RevokedResponse,
      error: WORKSPACE_ERRORS
    })
  )

export const WebhookApi = HttpApiGroup.make('webhook-endpoints').add(
  HttpApiEndpoint.post('create', '/workspaces/:slug/webhooks', {
    params: SlugParams,
    payload: CreateWebhookEndpointPayload,
    success: WebhookEndpoint.pipe(HttpApiSchema.status(201)),
    error: [InvalidWebhookUrl, ...WORKSPACE_ERRORS]
  })
)

export const SendInvitationPayload = Schema.Struct({
  to: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(320),
    Schema.isPattern(/^[^\s@]+@[^\s@]+$/)
  )
})
export type SendInvitationPayload = typeof SendInvitationPayload.Type

export const InvitationApi = HttpApiGroup.make('workspace-invitations').add(
  HttpApiEndpoint.post('send', '/workspaces/:slug/invitations', {
    params: SlugParams,
    payload: SendInvitationPayload,
    success: Schema.Struct({
      status: Schema.Literal('queued'),
      delivery: Schema.Unknown
    }).pipe(HttpApiSchema.status(202)),
    error: WORKSPACE_ERRORS
  })
)

export const CatalogApi = HttpApiGroup.make('catalog')
  .add(
    HttpApiEndpoint.get('modules', '/catalog/modules', {
      success: Schema.Array(StarterModule),
      error: PROTECTED_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('refresh-history', '/catalog/refresh-history', {
      success: Schema.Array(CatalogRefreshRun),
      error: PROTECTED_ERRORS
    })
  )

export const AssistantApi = HttpApiGroup.make('assistant').add(
  HttpApiEndpoint.post('answer', '/assistant/answer', {
    payload: AssistantPrompt,
    success: Schema.Struct({
      answer: AssistantReply.fields.answer,
      provider: AssistantProvider,
      modelId: AssistantReply.fields.modelId,
      usedTools: AssistantReply.fields.usedTools,
      assistantConfigured: Schema.Boolean
    }),
    error: [...PROTECTED_ERRORS, AssistantUnavailable]
  })
)

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
export type McpDiscovery = typeof McpDiscovery.Type

export const McpApi = HttpApiGroup.make('mcp').add(
  HttpApiEndpoint.get('discover', '/mcp', {
    success: McpDiscovery,
    error: PROTECTED_ERRORS
  })
)

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
        'Capability Interface surface for the starter. REST endpoints, MCP discovery (`GET /mcp`), and the assistant share the same capability layer. All routes except `/health` require an `Authorization: Bearer <token>` API token.',
      servers: [{ url: '/', description: 'This worker' }]
    })
  )
