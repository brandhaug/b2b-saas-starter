import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
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
  CatalogRefreshRun,
  CreatedApiTokenSchema,
  CreateApiTokenPayload,
  ImplementationReport,
  IntegrationSurface,
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
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('modules', '/workspaces/:slug/modules', {
      params: SlugParams,
      success: Schema.Array(StarterModuleWithState),
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('members', '/workspaces/:slug/members', {
      params: SlugParams,
      success: Schema.Array(Member),
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('notifications', '/workspaces/:slug/notifications', {
      params: SlugParams,
      success: Schema.Array(Notification),
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('api-tokens', '/workspaces/:slug/api-tokens', {
      params: SlugParams,
      success: Schema.Array(ApiToken),
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('webhooks', '/workspaces/:slug/webhooks', {
      params: SlugParams,
      success: Schema.Array(WebhookEndpoint),
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('integrations', '/workspaces/:slug/integrations', {
      params: SlugParams,
      success: Schema.Array(IntegrationSurface),
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('reports', '/workspaces/:slug/reports', {
      params: SlugParams,
      success: Schema.Array(ImplementationReport),
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('audit-events', '/workspaces/:slug/audit-events', {
      params: SlugParams,
      success: Schema.Array(AuditEvent),
      error: [InternalError, Unauthorized, RateLimited]
    })
  )

export const ApiTokenApi = HttpApiGroup.make('api-token-registry')
  .add(
    HttpApiEndpoint.post('create', '/workspaces/:slug/api-tokens', {
      params: SlugParams,
      payload: CreateApiTokenPayload,
      success: CreatedApiTokenSchema,
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.post('revoke', '/workspaces/:slug/api-tokens/:tokenId/revoke', {
      params: Schema.Struct({ slug: Schema.String, tokenId: Schema.String }),
      success: Schema.Struct({ status: Schema.Literal('revoked') }),
      error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
    })
  )

export const InvitationApi = HttpApiGroup.make('workspace-invitations').add(
  HttpApiEndpoint.post('send', '/workspaces/:slug/invitations', {
    params: SlugParams,
    payload: Schema.Struct({
      to: Schema.String
    }),
    success: Schema.Struct({
      status: Schema.Literal('queued'),
      delivery: Schema.Unknown
    }),
    error: [WorkspaceNotFound, InternalError, Unauthorized, RateLimited]
  })
)

export const CatalogApi = HttpApiGroup.make('catalog')
  .add(
    HttpApiEndpoint.get('modules', '/catalog/modules', {
      success: Schema.Array(StarterModule),
      error: [InternalError, Unauthorized, RateLimited]
    })
  )
  .add(
    HttpApiEndpoint.get('refresh-history', '/catalog/refresh-history', {
      success: Schema.Array(CatalogRefreshRun),
      error: [InternalError, Unauthorized, RateLimited]
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
    error: [InternalError, RateLimited]
  })
)

export const ModuleStatusDto = ModuleStatus

export const StarterApi = HttpApi.make('b2b-saas-starter')
  .add(HealthApi)
  .add(WorkspaceApi)
  .add(ApiTokenApi)
  .add(InvitationApi)
  .add(CatalogApi)
  .add(AssistantApi)
  .annotateMerge(
    OpenApi.annotations({
      title: 'B2B SaaS Starter API',
      version: '0.1.0',
      description:
        'Capability Interface surface for the starter. REST endpoints, MCP discovery, and the assistant share the same capability layer.',
      servers: [{ url: '/', description: 'This worker' }]
    })
  )
