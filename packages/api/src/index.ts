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
  UpdateWebhookEndpointPayload,
  WebhookEndpoint,
  WebhookDispatchRejected,
  WebhookEndpointNotFound,
  WebhookDeliveryNotFound
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { InvalidWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import { WorkspaceExport } from '@b2b-saas-starter/capabilities/governance/workspace-export'
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
import { Context, Option, Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi
} from 'effect/unstable/httpapi'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class InternalError extends Schema.TaggedError<InternalError>()(
  'InternalError',
  { traceId: Schema.String },
  { httpApiStatus: 500 }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class RateLimited extends Schema.TaggedError<RateLimited>()(
  'RateLimited',
  { bucket: Schema.String },
  { httpApiStatus: 429 }
) {}

/**
 * The failures a *non-contract* surface can raise before it reaches its own
 * wire format — today only the MCP protocol route at `POST /mcp`, which speaks
 * JSON-RPC and therefore encodes its own responses. It composes the same
 * guards the contract's `BearerAuth` middleware does, so it can fail in exactly
 * these four ways.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const GUARD_FAILURE_SCHEMAS = [
  Unauthorized,
  AuthorizationDenied,
  RateLimited,
  CapabilityUnavailable
] as const

export const GuardFailure = Schema.Union(GUARD_FAILURE_SCHEMAS)
export type GuardFailure = typeof GuardFailure.Type

const encodeGuardFailure = Schema.encodeSync(GuardFailure)

/**
 * The annotations a guard failure must carry to be encodable: its tag (the
 * `identifier` every `Schema.TaggedError` sets) and the status
 * `HttpApiBuilder` gives it. Annotations are an open `unknown` bag, so they
 * are decoded here rather than read on faith.
 */
const StatusAnnotations = Schema.Struct({
  identifier: Schema.String,
  httpApiStatus: Schema.Number
})

const decodeStatusAnnotations = Schema.decodeUnknownOption(StatusAnnotations)

/**
 * Status by tag, read off the error schemas rather than restated: the
 * `httpApiStatus` annotation each class already carries is the one
 * `HttpApiBuilder` uses to encode the REST response, so there is no second
 * table for a non-contract surface to drift from. A class that somehow lost
 * its annotation gets no row, and `guardFailureResponse` answers 500 — the
 * honest status for "this failure has no declared encoding".
 */
const GUARD_FAILURE_STATUS: ReadonlyMap<string, number> = new Map(
  GUARD_FAILURE_SCHEMAS.flatMap((schema: Schema.Top) =>
    Option.match(decodeStatusAnnotations(schema.ast.annotations), {
      onNone: (): ReadonlyArray<[string, number]> => [],
      onSome: (annotations) => [[annotations.identifier, annotations.httpApiStatus]]
    })
  )
)

/**
 * The HTTP encoding of a guard failure outside the contract's error channel:
 * the status from the schema's annotation, the body from the schema's own
 * encoding. Both halves come from the same declarations `HttpApiBuilder` reads,
 * so `POST /mcp` answers a rejected request byte-for-byte the way a REST route
 * would.
 */
export type GuardFailureResponse = {
  readonly status: number
  readonly body: typeof GuardFailure.Encoded
}

export function guardFailureResponse(error: GuardFailure): GuardFailureResponse {
  return {
    status: GUARD_FAILURE_STATUS.get(error._tag) ?? 500,
    body: encodeGuardFailure(error)
  }
}

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
  | 'workspace-exports'
  | 'assistant'
  | 'mcp'

const GROUP_BUCKETS = {
  workspace: 'rest_read',
  'api-token-registry': 'rest_write',
  'webhook-endpoints': 'rest_write',
  'workspace-exports': 'rest_write',
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

/**
 * The export named by a download-link request is not one this workspace can
 * hand out right now: unknown, pending, failed, or past its retention horizon.
 * One answer for every case, so a probing caller learns nothing about which.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WorkspaceExportNotDownloadable extends Schema.TaggedError<WorkspaceExportNotDownloadable>()(
  'WorkspaceExportNotDownloadable',
  { exportId: Schema.String },
  { httpApiStatus: 404 }
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
export const EndpointParams = Schema.Struct({
  slug: Schema.String,
  endpointId: Schema.String
})
export const DeliveryParams = Schema.Struct({
  slug: Schema.String,
  deliveryId: Schema.String
})

/**
 * The query vocabulary every paged list endpoint shares (ADR 0057): an
 * optional opaque `cursor` and an optional `limit`. `limit` defaults to 50
 * and is capped at 200 by the capability layer — the contract accepts any
 * number and lets the clamp, not a 400, absorb out-of-range values.
 */
export const ListPageQuery = Schema.Struct({
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.NumberFromString)
})
export type ListPageQuery = typeof ListPageQuery.Type

/** The success shape of every paged list endpoint: one bounded `Page`. */
function PageDto<Item extends Schema.Top>(item: Item) {
  return Schema.Struct({
    items: Schema.Array(item),
    nextCursor: Schema.NullOr(Schema.String)
  })
}

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
      query: ListPageQuery,
      success: PageDto(Member),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('notifications', '/workspaces/:slug/notifications', {
      params: SlugParams,
      query: ListPageQuery,
      success: PageDto(Notification),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('api-tokens', '/workspaces/:slug/api-tokens', {
      params: SlugParams,
      query: ListPageQuery,
      success: PageDto(ApiToken),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('webhooks', '/workspaces/:slug/webhooks', {
      params: SlugParams,
      query: ListPageQuery,
      success: PageDto(WebhookEndpoint),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get(
      'webhook-deliveries',
      '/workspaces/:slug/webhooks/:endpointId/deliveries',
      {
        params: EndpointParams,
        success: Schema.Array(WebhookDelivery),
        error: WORKSPACE_ERRORS
      }
    )
  )
  .add(
    HttpApiEndpoint.get('audit-events', '/workspaces/:slug/audit-events', {
      params: SlugParams,
      query: ListPageQuery,
      success: PageDto(AuditEvent),
      error: WORKSPACE_ERRORS
    })
  )
  // Applied last: endpoints added after `.middleware(...)` do not carry it.
  .middleware(BearerAuth)

const TokenIdParams = Schema.Struct({ slug: Schema.String, tokenId: Schema.String })
const RevokedResponse = Schema.Struct({ status: Schema.Literal('revoked') })

/** Contract response literals for the webhook operator surface. */
export const DeletedResponse = Schema.Struct({ status: Schema.Literal('deleted') })
export type DeletedResponse = typeof DeletedResponse.Type
export const RotatedWebhookSecret = Schema.Struct({
  signingSecret: Schema.String
})
export type RotatedWebhookSecret = typeof RotatedWebhookSecret.Type
export const QueuedDeliveryResponse = Schema.Struct({
  status: Schema.Literal('queued'),
  deliveryId: Schema.String
})
export type QueuedDeliveryResponse = typeof QueuedDeliveryResponse.Type

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
  .add(
    HttpApiEndpoint.patch('update', '/workspaces/:slug/webhooks/:endpointId', {
      params: EndpointParams,
      payload: UpdateWebhookEndpointPayload,
      success: WebhookEndpoint,
      error: [InvalidWebhookUrl, WebhookEndpointNotFound, ...WORKSPACE_ERRORS]
    })
  )
  .add(
    HttpApiEndpoint.delete('delete', '/workspaces/:slug/webhooks/:endpointId', {
      params: EndpointParams,
      success: DeletedResponse,
      error: [WebhookEndpointNotFound, ...WORKSPACE_ERRORS]
    })
  )
  .add(
    HttpApiEndpoint.post(
      'rotate-secret',
      '/workspaces/:slug/webhooks/:endpointId/rotate-secret',
      {
        params: EndpointParams,
        success: RotatedWebhookSecret,
        error: [WebhookEndpointNotFound, ...WORKSPACE_ERRORS]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      'test-event',
      '/workspaces/:slug/webhooks/:endpointId/test-event',
      {
        params: EndpointParams,
        success: QueuedDeliveryResponse.pipe(HttpApiSchema.status(201)),
        error: [WebhookEndpointNotFound, WebhookDispatchRejected, ...WORKSPACE_ERRORS]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      'replay-delivery',
      '/workspaces/:slug/webhooks/deliveries/:deliveryId/replay',
      {
        params: DeliveryParams,
        success: QueuedDeliveryResponse.pipe(HttpApiSchema.status(201)),
        error: [WebhookDeliveryNotFound, WebhookDispatchRejected, ...WORKSPACE_ERRORS]
      }
    )
  )
  .middleware(BearerAuth)

const ExportIdParams = Schema.Struct({ slug: Schema.String, exportId: Schema.String })

/** A signed, time-limited download link for one ready export (ADR 0055). */
export const WorkspaceExportDownloadLinkDto = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.String
})
export type WorkspaceExportDownloadLinkDto = typeof WorkspaceExportDownloadLinkDto.Type

/**
 * Workspace data export (ADR 0055). Both operations name the owner-only
 * `workspaceExport` statements, so a `read` or `write` token is refused and
 * only an `admin`-scoped token — the owner set — reaches them. The download
 * itself is not a contract operation: `GET /exports/:exportId/download` is a
 * public signed route served beside the contract (see `apps/api`), the way
 * `POST /mcp` is.
 */
export const WorkspaceExportApi = HttpApiGroup.make('workspace-exports')
  .add(
    HttpApiEndpoint.post('request', '/workspaces/:slug/exports', {
      params: SlugParams,
      success: WorkspaceExport.pipe(HttpApiSchema.status(202)),
      error: WORKSPACE_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.post(
      'download-link',
      '/workspaces/:slug/exports/:exportId/download-link',
      {
        params: ExportIdParams,
        success: WorkspaceExportDownloadLinkDto,
        error: [WorkspaceExportNotDownloadable, ...WORKSPACE_ERRORS]
      }
    )
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
  .add(WorkspaceExportApi)
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
