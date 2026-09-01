import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  ApiToken,
  type ApiTokenRegistry as ApiTokenRegistryService,
  CreatedApiTokenSchema,
  CreateApiTokenPayload
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  CapabilityUnavailable,
  PlanLimitExceeded,
  WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/errors'
import {
  CreateWebhookEndpointPayload,
  WebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { InvalidWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import {
  Member,
  Workspace
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { Notification } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  AssistantPrompt,
  AssistantProvider,
  AssistantReply,
  AssistantUnavailable
} from '@b2b-saas-starter/ai'
import { type ApiTokenScope } from '@b2b-saas-starter/authz/client'
import { type RateLimiterInterface as GenericRateLimiterInterface } from '@b2b-saas-starter/rate-limit'
import { Context, Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
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

/**
 * The rate-limit buckets the contract's gated groups draw from, and the
 * `RateLimiter` service the `BearerAuth` middleware takes them from. Both live
 * here rather than in the worker because the contract is what declares the
 * gate: an endpoint is rate limited because its group carries `BearerAuth`.
 * The worker keeps the mechanism — bindings, fallback limits, the layer.
 */
export type RateLimitBucket = 'rest_read' | 'rest_write' | 'assistant' | 'mcp'

export class RateLimiter extends Context.Service<
  RateLimiter,
  GenericRateLimiterInterface<RateLimitBucket>
>()('@b2b-saas-starter/api/RateLimiter') {}

/** The groups behind the bearer gate. `health` is the contract's only public group. */
export type GatedGroup =
  | 'workspace'
  | 'api-token-registry'
  | 'webhook-endpoints'
  | 'assistant'
  | 'mcp'

const GROUP_BUCKETS = {
  workspace: 'rest_read',
  'api-token-registry': 'rest_write',
  'webhook-endpoints': 'rest_write',
  assistant: 'assistant',
  mcp: 'mcp'
} satisfies Record<GatedGroup, RateLimitBucket>

// A Map because the lookup key is a group identifier read off the served
// contract at request time: a group with no row is the case to report, and
// `Map#get` says so without an index signature claiming every string is one.
const BUCKET_BY_GROUP: ReadonlyMap<string, RateLimitBucket> = new Map(
  Object.entries(GROUP_BUCKETS)
)

/**
 * The bucket a group's endpoints draw from, or `undefined` for a group that
 * names none. `apps/api`'s contract test asserts every group carrying
 * `BearerAuth` has a row here, so a new gated group cannot ship unlimited.
 */
export function rateLimitBucketFor(
  groupIdentifier: string
): RateLimitBucket | undefined {
  return BUCKET_BY_GROUP.get(groupIdentifier)
}

/**
 * The verified API token behind the request: who it is, which workspace it
 * belongs to, and what it may ask for. Provided by the `BearerAuth` middleware
 * and consumed by handlers, which decide permissions from it — never by
 * re-reading the `Authorization` header.
 */
export type ApiPrincipalValue = {
  readonly id: string
  readonly workspaceId: string
  readonly workspaceSlug: string
  readonly scopes: ReadonlyArray<ApiTokenScope>
}

export class ApiPrincipal extends Context.Service<ApiPrincipal, ApiPrincipalValue>()(
  '@b2b-saas-starter/api/ApiPrincipal'
) {}

/**
 * The one gate every non-public endpoint rides on, declared on the contract
 * rather than hand-composed in each handler: `Authorization: Bearer <token>`
 * is decoded by `HttpApiSecurity.bearer` (so the served OpenAPI carries a
 * `securitySchemes` entry and every gated operation is marked secured), the
 * group's rate-limit bucket is drawn, the token is verified, and the resulting
 * `ApiPrincipal` is provided to the handler.
 *
 * Authorization stays in the handlers: the middleware proves *who* the caller
 * is, `requirePermission` decides *what* they may do. See `apps/api`.
 */
export class BearerAuth extends HttpApiMiddleware.Service<
  BearerAuth,
  {
    provides: ApiPrincipal
    requires: ApiTokenRegistryService | RateLimiter
  }
>()('@b2b-saas-starter/api/BearerAuth', {
  security: { bearer: HttpApiSecurity.bearer },
  error: [Unauthorized, RateLimited, CapabilityUnavailable]
}) {}

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
  // Applied last: endpoints added after `.middleware(...)` do not carry it.
  .middleware(BearerAuth)

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
  .middleware(BearerAuth)

export const WebhookApi = HttpApiGroup.make('webhook-endpoints')
  .add(
    HttpApiEndpoint.post('create', '/workspaces/:slug/webhooks', {
      params: SlugParams,
      payload: CreateWebhookEndpointPayload,
      success: WebhookEndpoint.pipe(HttpApiSchema.status(201)),
      error: [InvalidWebhookUrl, PlanLimitExceeded, ...WORKSPACE_ERRORS]
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
      }),
      error: [...PROTECTED_ERRORS, AssistantUnavailable]
    })
  )
  .middleware(BearerAuth)

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

export const McpApi = HttpApiGroup.make('mcp')
  .add(
    HttpApiEndpoint.get('discover', '/mcp', {
      success: McpDiscovery,
      error: PROTECTED_ERRORS
    })
  )
  .middleware(BearerAuth)

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
