import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  ApiToken,
  CreatedApiTokenSchema,
  CreateApiTokenPayload
} from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { AuditEvent } from '@b2b-saas-starter/capabilities/src/governance/audit-event-log.ts'
import {
  CapabilityUnavailable,
  PlanLimitExceeded,
  WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/src/errors.ts'
import {
  CreateWebhookEndpointPayload,
  WebhookEndpoint
} from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { InvalidWebhookUrl } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-url.ts'
import {
  Member,
  Workspace
} from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'
import { Notification } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import {
  AssistantPrompt,
  AssistantProvider,
  AssistantReply,
  AssistantUnavailable
} from '@b2b-saas-starter/ai'
import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi
} from 'effect/unstable/httpapi'

/**
 * The canonical tag-to-HTTP-status table. Every `httpApiStatus` annotation on
 * the shared error classes below reads its status from here, and non-contract
 * surfaces (the MCP protocol route) map failures through `statusForTag` — so
 * REST and every other wire encoding cannot disagree about what a failure
 * means.
 */
export const ERROR_STATUS_BY_TAG = {
  InternalError: 500,
  Unauthorized: 401,
  AuthorizationDenied: 403,
  RateLimited: 429,
  CapabilityUnavailable: 503
}

export function statusForTag(tag: keyof typeof ERROR_STATUS_BY_TAG): number {
  return ERROR_STATUS_BY_TAG[tag]
}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class InternalError extends Schema.TaggedError<InternalError>()(
  'InternalError',
  { traceId: Schema.String },
  { httpApiStatus: ERROR_STATUS_BY_TAG.InternalError }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: ERROR_STATUS_BY_TAG.Unauthorized }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class RateLimited extends Schema.TaggedError<RateLimited>()(
  'RateLimited',
  { bucket: Schema.String },
  { httpApiStatus: ERROR_STATUS_BY_TAG.RateLimited }
) {}

// HttpApi reads these tuple element types to build each endpoint's error union.
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const WORKSPACE_ERRORS = [
  WorkspaceNotFound,
  InternalError,
  Unauthorized,
  AuthorizationDenied,
  RateLimited,
  CapabilityUnavailable
] as const

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
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
  notifications: Schema.Array(Notification)
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
      error: [PlanLimitExceeded, ...WORKSPACE_ERRORS]
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
    error: [InvalidWebhookUrl, PlanLimitExceeded, ...WORKSPACE_ERRORS]
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

export const StarterApi = HttpApi.make('b2b-saas-starter')
  .add(HealthApi)
  .add(WorkspaceApi)
  .add(ApiTokenApi)
  .add(WebhookApi)
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
