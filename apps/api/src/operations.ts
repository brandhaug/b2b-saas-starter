import { type PermissionRequest } from '@b2b-saas-starter/authz/src/client.ts'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/src/errors.ts'
import {
  type CapabilityUnavailable,
  type WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/src/errors.ts'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/src/governance/audit-event-log.ts'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/src/governance/workspace-membership.ts'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import { workspaceOverview } from '@b2b-saas-starter/capabilities/src/workspace-projections.ts'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/src/workspace-context.ts'
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

export type CapabilityRead = Effect.Effect<
  unknown,
  CapabilityReadError,
  | NotificationFeed
  | WorkspaceMembership
  | ApiTokenRegistry
  | WebhookEndpoints
  | AuditEventLog
  | WorkspaceContext
>

export type WorkspaceReadOperation = {
  /** URL path segment under `/workspaces/{slug}/`, also the OpenAPI template piece. */
  readonly path: string
  readonly permission: PermissionRequest
  readonly read: () => CapabilityRead
  /** The MCP tool that projects this same operation. */
  readonly toolName: string
  /** Tool description body; the mirrored REST operation is appended on the wire. */
  readonly toolDescription: string
}

export type ReadOperationEndpoint =
  | 'overview'
  | 'members'
  | 'notifications'
  | 'api-tokens'
  | 'webhooks'
  | 'audit-events'

/**
 * Keyed by the contract's `workspace` group endpoint name, so a handler's
 * lookup is checked against the table's actual keys at compile time.
 */
export const READ_OPERATIONS = {
  overview: {
    path: 'overview',
    permission: { notification: ['read'] },
    read: () => workspaceOverview,
    toolName: 'get_workspace_overview',
    toolDescription: 'The workspace record plus its notification feed.'
  },
  // Listing members exposes who holds which role, which is what `ac`
  // (Better Auth's abbreviation of "access control") names. The key is fixed
  // by the plugin; see statements.ts. The plugin's `member` statement covers
  // mutations only — it has no `read` action.
  members: {
    path: 'members',
    permission: { ac: ['read'] },
    read: () =>
      Effect.flatMap(WorkspaceMembership, (membership) => membership.listMembers),
    toolName: 'list_members',
    toolDescription: 'List the workspace members and their roles.'
  },
  notifications: {
    path: 'notifications',
    permission: { notification: ['read'] },
    read: () => Effect.flatMap(NotificationFeed, (feed) => feed.list),
    toolName: 'list_notifications',
    toolDescription: "List the API token's workspace notifications."
  },
  // A read scope may LIST tokens — wider than the `member` role, which cannot:
  // a token is minted by an owner or admin (see `readScopeStatements`).
  'api-tokens': {
    path: 'api-tokens',
    permission: { apiToken: ['list'] },
    read: () => Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list),
    toolName: 'list_api_tokens',
    toolDescription: 'List the workspace API token projections (never the secrets).'
  },
  webhooks: {
    path: 'webhooks',
    permission: { webhook: ['list'] },
    read: () => Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.list),
    toolName: 'list_webhooks',
    toolDescription: 'List registered webhook endpoints and their success rates.'
  },
  'audit-events': {
    path: 'audit-events',
    permission: { auditLog: ['read'] },
    read: () =>
      Effect.map(
        Effect.flatMap(AuditEventLog, (log) => log.list()),
        (page) => page.events
      ),
    toolName: 'list_audit_events',
    toolDescription: 'Read a page of the workspace audit trail.'
  }
} satisfies Record<ReadOperationEndpoint, WorkspaceReadOperation>

/** The table rows in contract order — what MCP tools and tests derive from. */
export function readOperations(): readonly WorkspaceReadOperation[] {
  return Object.values(READ_OPERATIONS)
}

/**
 * The single sanctioned channel widening for serving a table row. The table
 * stores each read as its natural capability effect; this boundary widens the
 * type channels to `never` so the consuming surface's own schema (the REST
 * contract's success/error schemas, or MCP's resource shape) narrows them
 * back — the same covariance the inline effects relied on before the shared
 * table existed. No value is asserted away: only the type channel is widened,
 * and the request guards plus `provideWorkspace` re-narrow the requirements
 * before the effect runs. Both Capability Interfaces (REST and MCP) go
 * through here so there is exactly one place documenting the trick.
 */
export function serveRead(
  op: WorkspaceReadOperation
): Effect.Effect<never, never, never> {
  // SAFETY: see doc comment above — type-channel widening only, re-narrowed
  // by the consuming surface before the effect ever runs.
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- see SAFETY above
  return op.read() as Effect.Effect<never, never, never>
}

/** `notification:read`-style label, used by the permission matrix output. */
export function permissionLabel(permission: PermissionRequest): string {
  const entry = Object.entries(permission)[0]
  if (entry === undefined) return ''
  const [key, actions] = entry
  if (!Array.isArray(actions)) return `${key}:`
  return `${key}:${String(actions[0])}`
}
