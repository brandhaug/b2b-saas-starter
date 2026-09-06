import {
  ApiTokenApi,
  WebhookApi,
  WorkspaceApi,
  WorkspaceExportApi,
  type QueuedDeliveryResponse,
  type DeletedResponse
} from '@b2b-saas-starter/api'
import { WorkspaceExportNotDownloadable } from '@b2b-saas-starter/api/errors'
import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  type InvalidApiTokenInput,
  type ApiTokenNotRotatable,
  type CapabilityUnavailable,
  type PlanLimitExceeded,
  type WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/errors'
import { type ListPageInput } from '@b2b-saas-starter/capabilities/internal/keyset-cursor'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import {
  type UpdateWebhookEndpointInput,
  WebhookEndpoints,
  type WebhookDeliveryNotFound,
  type WebhookDispatchRejected,
  type WebhookEndpointNotFound
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type InvalidWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceExports } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { workspaceOverview } from '@b2b-saas-starter/capabilities/workspace-projections'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, Option, type Schema, type Scope } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { type HttpApiEndpoint } from 'effect/unstable/httpapi'

import { webRequest } from './request-guards.ts'

/**
 * Workspace reads and mutations share this catalog (ADR 0072). REST binds each
 * row to its contract endpoint; the permission matrix enumerates both shapes.
 * MCP tools and discovery select explicit opt-ins. Mutation `run` functions
 * retain their inferred success and error channels for contract checking.
 */

/**
 * Everything a read can fail with: the guard's denial, the workspace
 * layer's 404, and the capability layer's 503. Kept as a named union so MCP
 * can classify tool failures exhaustively instead of sniffing `_tag` off an
 * untyped promise rejection.
 */
export type CapabilityReadError =
  | AuthorizationDenied
  | WorkspaceNotFound
  | CapabilityUnavailable

/**
 * The capability services a table row reads through, minus `WorkspaceContext`:
 * these are request-independent and live on the worker's isolate-level layer.
 * Named so the MCP route can capture exactly them from the request context and
 * carry them across the SDK's promise seam (see `mcp.ts`).
 */
export type CapabilityReadServices =
  | NotificationFeed
  | WorkspaceMembership
  | ApiTokenRegistry
  | WebhookEndpoints
  | AuditEventLog

export type CapabilityRead = Effect.Effect<
  unknown,
  CapabilityReadError,
  CapabilityReadServices | WorkspaceContext
>

type ReadOperationEndpoint = keyof typeof WorkspaceApi.endpoints

/**
 * The one path parameter an operation can take besides `:slug`: a whole-
 * collection read takes none, delivery reads address an endpoint or a delivery, and
 * a mutation addresses the row its path names (`tokenId`, `endpointId`,
 * `deliveryId`, `exportId`).
 */
type OperationParam = {
  /** A concrete value the permission matrix can build a real request with. */
  readonly sample: string
}

/**
 * The two row shapes, discriminated by `param`: a whole-collection read takes
 * no input at all, and a parameterized read takes exactly its declared path
 * parameter — required, because a missing value is a caller bug, not an empty
 * string to query with. Both REST (`handlers.ts`) and MCP (`mcp.ts`) narrow on
 * `param`, so neither can pass the wrong shape to a row's read.
 *
 * `endpoint` references the contract's canonical path and schemas. The catalog
 * adds capability behavior and permission policy, not a second wire contract.
 */
export type CollectionReadOperation = {
  readonly mcpTool: true
  readonly endpoint: HttpApiEndpoint.Top
  readonly permission: PermissionRequest
  readonly param?: undefined
  /**
   * The capability read, taking the request's paging input. List rows page
   * (`ListPageInput`: cursor + clamped limit, ADR 0057); the overview row
   * ignores it — REST and MCP pass the same value, so neither surface can
   * page differently.
   */
  readonly read: (page: ListPageInput | undefined) => CapabilityRead
  /** Whether the row is a paged list (drives the MCP tool's input schema). */
  readonly paged: boolean
  /** The MCP tool that projects this same operation. */
  readonly toolName: string
  /** Tool description body; the mirrored REST operation is appended on the wire. */
  readonly toolDescription: string
}

export type ParameterizedReadOperation<
  Key extends 'endpointId' | 'deliveryId' = 'endpointId'
> = {
  readonly input: Key
  readonly mcpTool: true
  readonly endpoint: HttpApiEndpoint.Top
  readonly permission: PermissionRequest
  readonly param: OperationParam
  /**
   * The page input rides along for a uniform call shape; the deliveries read
   * is capped by the capability (the 20 newest), not paged, and ignores it.
   * The path id is required — a missing value is a caller bug, not an
   * empty string to query with.
   */
  readonly read: (
    page: ListPageInput | undefined,
    args: Readonly<Record<Key, string>>
  ) => CapabilityRead
  readonly toolName: string
  readonly toolDescription: string
}

export type WorkspaceReadOperation =
  | CollectionReadOperation
  | ParameterizedReadOperation
  | ParameterizedReadOperation<'deliveryId'>

/**
 * The OpenAPI-style path of the mirrored REST route — `:endpointId` becomes
 * `{endpointId}` — so the MCP tool descriptions and the permission matrix
 * labels cannot drift from the contract's real template. Reads and mutations
 * alike: both row shapes reference their contract endpoint's full path.
 */
export function mirroredRestPath(path: string): string {
  return path.replace(/^\//, '').replaceAll(/:(\w+)/g, '{$1}')
}

/**
 * Keyed by the contract's `workspace` group endpoint name, so a handler's
 * lookup is checked against the table's actual keys at compile time — and the
 * key itself is the wide-event name under `workspace.`, never restated per
 * row. The parameterized row types its own argument as required — the type is
 * the invariant the handler and the MCP callback both rely on.
 */
export const READ_OPERATIONS = {
  overview: {
    mcpTool: true,
    endpoint: WorkspaceApi.endpoints.overview,
    permission: { notification: ['read'] },
    read: () => workspaceOverview,
    paged: false,
    toolName: 'get_workspace_overview',
    toolDescription: 'The workspace record plus its notification feed.'
  },
  // Listing members exposes who holds which role, which is what `ac`
  // (Better Auth's abbreviation of "access control") names. The key is fixed
  // by the plugin; see statements.ts. The plugin's `member` statement covers
  // mutations only — it has no `read` action.
  members: {
    mcpTool: true,
    endpoint: WorkspaceApi.endpoints.members,
    permission: { ac: ['read'] },
    read: (page) =>
      Effect.flatMap(WorkspaceMembership, (membership) =>
        membership.listMembersPage(page)
      ),
    paged: true,
    toolName: 'list_members',
    toolDescription: 'List the workspace members and their roles.'
  },
  notifications: {
    mcpTool: true,
    endpoint: WorkspaceApi.endpoints.notifications,
    permission: { notification: ['read'] },
    read: (page) => Effect.flatMap(NotificationFeed, (feed) => feed.listPage(page)),
    paged: true,
    toolName: 'list_notifications',
    toolDescription: "List the API token's workspace notifications."
  },
  // A read scope may LIST tokens — wider than the `member` role, which cannot:
  // a token is minted by an owner or admin (see `readScopeStatements`).
  'api-tokens': {
    mcpTool: true,
    endpoint: WorkspaceApi.endpoints['api-tokens'],
    permission: { apiToken: ['list'] },
    read: (page) => Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.listPage(page)),
    paged: true,
    toolName: 'list_api_tokens',
    toolDescription: 'List the workspace API token projections (never the secrets).'
  },
  webhooks: {
    mcpTool: true,
    endpoint: WorkspaceApi.endpoints.webhooks,
    permission: { webhook: ['list'] },
    read: (page) =>
      Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.listPage(page)),
    paged: true,
    toolName: 'list_webhooks',
    toolDescription: 'List registered webhook endpoints and their success rates.'
  },
  'webhook-deliveries': {
    mcpTool: true,
    endpoint: WorkspaceApi.endpoints['webhook-deliveries'],
    permission: { webhook: ['list'] },
    input: 'endpointId',
    param: { sample: 'wh_release' },
    read: (_page, args) =>
      Effect.flatMap(WebhookEndpoints, (webhooks) =>
        webhooks.listDeliveries({ endpointId: args.endpointId })
      ),
    toolName: 'list_webhook_deliveries',
    toolDescription:
      'List recent deliveries for one webhook endpoint, newest first, with response status and recorded evidence.'
  },
  'webhook-delivery-attempts': {
    mcpTool: true,
    endpoint: WorkspaceApi.endpoints['webhook-delivery-attempts'],
    permission: { webhook: ['list'] },
    input: 'deliveryId',
    param: { sample: 'whd_seed_failed' },
    read: (_page, args) =>
      Effect.flatMap(WebhookEndpoints, (webhooks) =>
        webhooks.listDeliveryAttempts({ deliveryId: args.deliveryId })
      ),
    toolName: 'list_webhook_delivery_attempts',
    toolDescription:
      'Read retained attempts for one delivery, in attempt order, with bounded request and response evidence.'
  },
  'audit-events': {
    mcpTool: true,
    endpoint: WorkspaceApi.endpoints['audit-events'],
    permission: { auditLog: ['read'] },
    read: (page) => Effect.flatMap(AuditEventLog, (log) => log.list(page)),
    paged: true,
    toolName: 'list_audit_events',
    toolDescription: 'Read a page of the workspace audit trail.'
  }
} satisfies Record<ReadOperationEndpoint, WorkspaceReadOperation>

/** The table rows in contract order — what MCP tools and tests derive from. */
export function readOperations(): ReadonlyArray<WorkspaceReadOperation> {
  return Object.values(READ_OPERATIONS)
}

/** Expected mutation failures; each concrete row retains its inferred subset. */
type CapabilityMutationError =
  | InvalidApiTokenInput
  | ApiTokenNotRotatable
  | CapabilityUnavailable
  | PlanLimitExceeded
  | InvalidWebhookUrl
  | WebhookEndpointNotFound
  | WebhookDeliveryNotFound
  | WebhookDispatchRejected
  | WorkspaceExportNotDownloadable

/** Stable services, separate from the request's workspace, actor and scope. */
type CapabilityMutationServices = ApiTokenRegistry | WebhookEndpoints | WorkspaceExports

/** Rows narrow this to their decoded path parameters and payload. */
export type MutationRequestOptions = {
  readonly params: { readonly slug: string }
}

/**
 * `never` checks heterogeneous runs without widening their inputs. Callers
 * use the concrete row, preserving its inferred success and error channels.
 * Mutations require a separate MCP opt-in design, per ADR 0072.
 */
type WorkspaceMutationOperation = {
  readonly endpoint: HttpApiEndpoint.Top
  readonly permission: PermissionRequest
  readonly param?: OperationParam
  /** A concrete request body the permission matrix sends; absent when the endpoint declares no payload. */
  readonly samplePayload?: typeof Schema.Json.Type
  readonly run: (
    options: never
  ) => Effect.Effect<
    unknown,
    CapabilityMutationError,
    | CapabilityMutationServices
    | WorkspaceContext
    | HttpServerRequest.HttpServerRequest
    | Scope.Scope
  >
  readonly mcpTool: false
}

/** Response literals checked against the contract without assertions. */
const TOKEN_REVOKED = { status: 'revoked' } satisfies { readonly status: 'revoked' }
const WEBHOOK_DELETED = { status: 'deleted' } satisfies DeletedResponse

/** Signed downloads use this request's origin, never the layer-build context. */
const requestOrigin = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => new URL(webRequest(request).url).origin
)

/** Keys are existing wide-event names; rows follow contract group order. */
export const MUTATION_OPERATIONS = {
  'api-tokens.create': {
    endpoint: ApiTokenApi.endpoints.create,
    permission: { apiToken: ['create'] },
    samplePayload: { name: 'CI token', scopes: ['read'] },
    // The entitlement gate and the webhook fan-out live inside the
    // capability, below the interface — identical for every surface.
    run: (options: HttpApiEndpoint.Request<typeof ApiTokenApi.endpoints.create>) =>
      Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        const created = yield* tokens.create(options.payload)
        yield* Effect.annotateLogsScoped({
          tokenId: created.id,
          tokenScopes: created.scopes
        })
        return created
      }),
    mcpTool: false
  },
  'api-tokens.replace': {
    endpoint: ApiTokenApi.endpoints.replace,
    permission: { apiToken: ['create'] },
    param: { sample: 'tok_docs' },
    samplePayload: { scopes: ['read'], overlapSeconds: 3600 },
    run: (options: HttpApiEndpoint.Request<typeof ApiTokenApi.endpoints.replace>) =>
      Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        const replaced = yield* tokens.replace({
          tokenId: options.params.tokenId,
          ...options.payload
        })
        yield* Effect.annotateLogsScoped({
          tokenId: replaced.id,
          previousTokenId: replaced.previousTokenId,
          tokenScopes: replaced.scopes
        })
        return replaced
      }),
    // Like create, replacement reveals a credential once. Keep minting out
    // of MCP tool results and model conversation history.
    mcpTool: false
  },
  // Revoking an unknown id answers `revoked` all the same: the capability
  // resolves `false` and no typed failure exists for a no-match revoke.
  'api-tokens.delete': {
    endpoint: ApiTokenApi.endpoints.delete,
    permission: { apiToken: ['revoke'] },
    param: { sample: 'tok_seed' },
    run: (options: HttpApiEndpoint.Request<typeof ApiTokenApi.endpoints.delete>) =>
      Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        yield* tokens.revoke({ tokenId: options.params.tokenId })
        return TOKEN_REVOKED
      }),
    mcpTool: false
  },
  // The endpoint projection rides the response; the one-time signing secret
  // the capability also returns stays off the wire — the same split the web
  // surface makes.
  'webhooks.create': {
    endpoint: WebhookApi.endpoints.create,
    permission: { webhook: ['create'] },
    samplePayload: {
      url: 'https://hooks.example.com/x',
      events: ['api_token.created']
    },
    run: (options: HttpApiEndpoint.Request<typeof WebhookApi.endpoints.create>) =>
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const created = yield* webhooks.create({
          url: options.payload.url,
          events: options.payload.events,
          description: options.payload.description
        })
        yield* Effect.annotateLogsScoped({ webhookEndpointId: created.endpoint.id })
        return created.endpoint
      }),
    mcpTool: false
  },
  'webhooks.update': {
    endpoint: WebhookApi.endpoints.update,
    permission: { webhook: ['update'] },
    param: { sample: 'wh_release' },
    samplePayload: { enabled: true },
    run: (options: HttpApiEndpoint.Request<typeof WebhookApi.endpoints.update>) =>
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const patch: UpdateWebhookEndpointInput = {
          endpointId: options.params.endpointId
        }
        if (options.payload.url !== undefined) {
          patch.url = options.payload.url
        }
        if (options.payload.events !== undefined) {
          patch.events = options.payload.events
        }
        if (options.payload.enabled !== undefined) {
          patch.enabled = options.payload.enabled
        }
        const updated = yield* webhooks.update(patch)
        yield* Effect.annotateLogsScoped({ webhookEndpointId: updated.id })
        return updated
      }),
    mcpTool: false
  },
  // A no-match delete fails the capability's typed 404 — the same
  // `WebhookEndpointNotFound` the contract declares.
  'webhooks.delete': {
    endpoint: WebhookApi.endpoints.delete,
    permission: { webhook: ['delete'] },
    param: { sample: 'wh_release' },
    run: (options: HttpApiEndpoint.Request<typeof WebhookApi.endpoints.delete>) =>
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        yield* webhooks.delete({ endpointId: options.params.endpointId })
        return WEBHOOK_DELETED
      }),
    mcpTool: false
  },
  // The new secret rides this one response only — the same one-time reveal
  // the web surface gives the operator.
  'webhooks.rotate-secret': {
    endpoint: WebhookApi.endpoints['rotate-secret'],
    permission: { webhook: ['rotateSecret'] },
    param: { sample: 'wh_release' },
    run: (
      options: HttpApiEndpoint.Request<(typeof WebhookApi.endpoints)['rotate-secret']>
    ) =>
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const rotated = yield* webhooks.rotateSecret({
          endpointId: options.params.endpointId
        })
        yield* Effect.annotateLogsScoped({
          webhookEndpointId: options.params.endpointId
        })
        return { signingSecret: rotated.signingSecret }
      }),
    mcpTool: false
  },
  'webhooks.test-event': {
    endpoint: WebhookApi.endpoints['test-event'],
    permission: { webhook: ['test'] },
    param: { sample: 'wh_release' },
    run: (
      options: HttpApiEndpoint.Request<(typeof WebhookApi.endpoints)['test-event']>
    ) =>
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const sent = yield* webhooks.sendTestEvent({
          endpointId: options.params.endpointId
        })
        yield* Effect.annotateLogsScoped({ deliveryId: sent.deliveryId })
        return {
          status: 'queued',
          deliveryId: sent.deliveryId
        } satisfies QueuedDeliveryResponse
      }),
    mcpTool: false
  },
  'webhooks.replay-delivery': {
    endpoint: WebhookApi.endpoints['replay-delivery'],
    permission: { webhook: ['replay'] },
    param: { sample: 'whd_seed_failed' },
    run: (
      options: HttpApiEndpoint.Request<(typeof WebhookApi.endpoints)['replay-delivery']>
    ) =>
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const replayed = yield* webhooks.replayDelivery({
          deliveryId: options.params.deliveryId
        })
        yield* Effect.annotateLogsScoped({ deliveryId: replayed.deliveryId })
        return {
          status: 'queued',
          deliveryId: replayed.deliveryId
        } satisfies QueuedDeliveryResponse
      }),
    mcpTool: false
  },
  'workspace-exports.request': {
    endpoint: WorkspaceExportApi.endpoints.request,
    permission: { workspaceExport: ['request'] },
    run: (
      _options: HttpApiEndpoint.Request<typeof WorkspaceExportApi.endpoints.request>
    ) =>
      Effect.gen(function* () {
        const exports = yield* WorkspaceExports
        const created = yield* exports.request
        yield* Effect.annotateLogsScoped({ exportId: created.id })
        return created
      }),
    mcpTool: false
  },
  'workspace-exports.download-link': {
    endpoint: WorkspaceExportApi.endpoints['download-link'],
    permission: { workspaceExport: ['download'] },
    param: { sample: 'exp_seed_ready' },
    // A link this workspace cannot hand out — unknown, pending, failed,
    // expired — is one typed 404 for every case, so a probing caller learns
    // nothing about which.
    run: (
      options: HttpApiEndpoint.Request<
        (typeof WorkspaceExportApi.endpoints)['download-link']
      >
    ) =>
      Effect.gen(function* () {
        const exports = yield* WorkspaceExports
        const link = yield* exports.issueDownloadLink({
          exportId: options.params.exportId
        })
        if (Option.isNone(link)) {
          return yield* new WorkspaceExportNotDownloadable({
            exportId: options.params.exportId
          })
        }
        const origin = yield* requestOrigin
        yield* Effect.annotateLogsScoped({ exportId: options.params.exportId })
        return {
          url: `${origin}${link.value.path}`,
          expiresAt: link.value.expiresAt
        }
      }),
    mcpTool: false
  }
} satisfies Record<string, WorkspaceMutationOperation>

/** The mutation rows in contract order — what the permission matrix and tests derive from. */
export function mutationOperations(): ReadonlyArray<
  Omit<WorkspaceMutationOperation, 'run'>
> {
  return Object.values(MUTATION_OPERATIONS)
}

/** Explicit opt-in only. A tool name alone must never expose a mutation. */
export function mcpToolOperations(): ReadonlyArray<WorkspaceReadOperation> {
  return [...readOperations(), ...mutationOperations()].filter(
    (operation) => operation.mcpTool
  )
}

/** `notification:read`-style label, used by the permission matrix output. */
export function permissionLabel(permission: PermissionRequest): string {
  const entry = Object.entries(permission)[0]
  if (entry === undefined) {
    return ''
  }
  const [key, actions] = entry
  if (!Array.isArray(actions)) {
    return `${key}:`
  }
  return `${key}:${String(actions[0])}`
}
