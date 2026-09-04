import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  type CapabilityUnavailable,
  type WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/errors'
import { type ListPageInput } from '@b2b-saas-starter/capabilities/internal/keyset-cursor'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { workspaceOverview } from '@b2b-saas-starter/capabilities/workspace-projections'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect } from 'effect'

/**
 * The one table behind both Capability Interfaces: every workspace read names
 * its permission and its capability read here, once. The REST group in
 * `handlers.ts` composes gate + read from these rows; the MCP tools in
 * `mcp.ts` are derived from them, so the two surfaces cannot disagree about
 * what a token may list or which service answers.
 *
 * Writes stay out of this table: only MCP's read-only projection is derived,
 * so a new mutation still means editing the REST group by hand — and getting
 * reviewed there — rather than appearing in MCP for free.
 */

/**
 * Everything a table row can fail with: the guard's denial, the workspace
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

export type ReadOperationEndpoint =
  | 'overview'
  | 'members'
  | 'notifications'
  | 'api-tokens'
  | 'webhooks'
  | 'webhook-deliveries'
  | 'audit-events'

/**
 * The one path parameter a read can take. Every operation is a whole-collection
 * read except the deliveries list, which addresses one endpoint.
 */
export type ReadOperationParam = {
  readonly name: 'endpointId'
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
 * `path` is the URL segment under `/workspaces/{slug}/`, also the OpenAPI
 * template piece — and, because the contract names each read endpoint after
 * its path, the `workspace` group's endpoint identifier and the table's own
 * key. A `:param` piece in the template marks a parameterized read.
 */
export type CollectionReadOperation = {
  readonly path: ReadOperationEndpoint
  /** The wide-event name under `workspace.` — a key, never a URL template. */
  readonly event: string
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

export type ParameterizedReadOperation = {
  readonly path: 'webhooks/:endpointId/deliveries'
  readonly event: string
  readonly permission: PermissionRequest
  readonly param: ReadOperationParam
  /**
   * The page input rides along for a uniform call shape; the deliveries read
   * is capped by the capability (the 20 newest), not paged, and ignores it.
   * The endpoint id is required — a missing value is a caller bug, not an
   * empty string to query with.
   */
  readonly read: (
    page: ListPageInput | undefined,
    args: { readonly endpointId: string }
  ) => CapabilityRead
  readonly toolName: string
  readonly toolDescription: string
}

export type WorkspaceReadOperation =
  | CollectionReadOperation
  | ParameterizedReadOperation

/**
 * The OpenAPI-style path of the mirrored REST route — `:endpointId` becomes
 * `{endpointId}` — so the MCP tool descriptions and the permission matrix
 * labels cannot drift from the contract's real template.
 */
export function mirroredRestPath(path: WorkspaceReadOperation['path']): string {
  return `workspaces/{slug}/${path.replaceAll(/:(\w+)/g, '{$1}')}`
}

/**
 * Keyed by the contract's `workspace` group endpoint name, so a handler's
 * lookup is checked against the table's actual keys at compile time. The
 * parameterized row types its own argument as required — the type is the
 * invariant the handler and the MCP callback both rely on.
 */
export const READ_OPERATIONS = {
  overview: {
    path: 'overview',
    event: 'overview',
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
    path: 'members',
    event: 'members',
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
    path: 'notifications',
    event: 'notifications',
    permission: { notification: ['read'] },
    read: (page) => Effect.flatMap(NotificationFeed, (feed) => feed.listPage(page)),
    paged: true,
    toolName: 'list_notifications',
    toolDescription: "List the API token's workspace notifications."
  },
  // A read scope may LIST tokens — wider than the `member` role, which cannot:
  // a token is minted by an owner or admin (see `readScopeStatements`).
  'api-tokens': {
    path: 'api-tokens',
    event: 'api-tokens',
    permission: { apiToken: ['list'] },
    read: (page) => Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.listPage(page)),
    paged: true,
    toolName: 'list_api_tokens',
    toolDescription: 'List the workspace API token projections (never the secrets).'
  },
  webhooks: {
    path: 'webhooks',
    event: 'webhooks',
    permission: { webhook: ['list'] },
    read: (page) =>
      Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.listPage(page)),
    paged: true,
    toolName: 'list_webhooks',
    toolDescription: 'List registered webhook endpoints and their success rates.'
  },
  'webhook-deliveries': {
    path: 'webhooks/:endpointId/deliveries',
    event: 'webhook-deliveries',
    permission: { webhook: ['list'] },
    param: { name: 'endpointId', sample: 'wh_release' },
    read: (_page, args) =>
      Effect.flatMap(WebhookEndpoints, (webhooks) =>
        webhooks.listDeliveries({ endpointId: args.endpointId })
      ),
    toolName: 'list_webhook_deliveries',
    toolDescription:
      'List recent deliveries for one webhook endpoint, newest first, with response status and recorded evidence.'
  },
  'audit-events': {
    path: 'audit-events',
    event: 'audit-events',
    permission: { auditLog: ['read'] },
    read: (page) =>
      // The audit read names its page `events` on the capability side; the
      // list contract's `Page` shape (`items`) is applied here, once, so the
      // REST route and the MCP tool share it.
      Effect.map(
        Effect.flatMap(AuditEventLog, (log) => log.list(page)),
        (auditPage) => ({
          items: auditPage.events,
          nextCursor: auditPage.nextCursor
        })
      ),
    paged: true,
    toolName: 'list_audit_events',
    toolDescription: 'Read a page of the workspace audit trail.'
  }
} satisfies Record<ReadOperationEndpoint, WorkspaceReadOperation>

/** The table rows in contract order — what MCP tools and tests derive from. */
export function readOperations(): ReadonlyArray<WorkspaceReadOperation> {
  return Object.values(READ_OPERATIONS)
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
