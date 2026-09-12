import { Context, DateTime, Effect } from 'effect'

import { ApiTokenRegistry } from '../developer-platform/api-token-registry.ts'
import { WebhookEndpoints } from '../developer-platform/webhook-endpoints.ts'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { walkKeysetPages } from '../internal/keyset-cursor.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog, type AuditEvent } from './audit-event-log.ts'
import { type WorkspaceExportSnapshot } from './workspace-export-archive.ts'
import { WorkspaceInvitations } from './workspace-invitations.ts'
import { WorkspaceMembership } from './workspace-membership.ts'

/**
 * The services a snapshot reads through. Named so the background consumer and
 * the Seed adapter declare the same requirement, and so `layers.ts` can hand
 * the Seed adapter exactly these.
 */
export type WorkspaceExportSnapshotServices =
  | ApiTokenRegistry
  | AuditEventLog
  | NotificationFeed
  | WebhookEndpoints
  | WorkspaceInvitations
  | WorkspaceMembership

/**
 * Acquires the snapshot's explicit read allowlist once for an adapter. Keeping
 * this recipe here makes Seed and queued generation agree when a snapshot
 * service is added.
 *
 * The context is built service by service rather than with `Effect.context`:
 * the latter retains every service in the ambient context, including a
 * caller's `WorkspaceContext`, which can defeat a queue resolver supplied
 * later.
 */
export function workspaceExportSnapshotContextEffect(): Effect.Effect<
  Context.Context<WorkspaceExportSnapshotServices>,
  never,
  WorkspaceExportSnapshotServices
> {
  return Effect.gen(function* () {
    return Context.mergeAll(
      Context.make(ApiTokenRegistry, yield* ApiTokenRegistry),
      Context.make(AuditEventLog, yield* AuditEventLog),
      Context.make(NotificationFeed, yield* NotificationFeed),
      Context.make(WebhookEndpoints, yield* WebhookEndpoints),
      Context.make(WorkspaceInvitations, yield* WorkspaceInvitations),
      Context.make(WorkspaceMembership, yield* WorkspaceMembership)
    )
  })
}

/**
 * Every page of the workspace's audit trail, newest first — complete or the
 * export fails. The walk's runaway guard stops at 25 pages of the read's own
 * default size, and a `workspace.export` that hit it would be a silent
 * partial archive wearing the README's "complete audit trail" promise, so an
 * unexhausted walk is a `CapabilityUnavailable` the export records as
 * `failed` instead. Every mutation writes an audit event, so the bound is a
 * real operating limit, not a theoretical one; raise `maxPages` beside it if
 * it ever bites.
 */
const allAuditEvents: Effect.Effect<
  ReadonlyArray<AuditEvent>,
  CapabilityUnavailable,
  AuditEventLog | WorkspaceContext
> = Effect.flatMap(AuditEventLog, (log) =>
  Effect.flatMap(walkKeysetPages(log.list), (walk) => {
    if (walk.exhausted) {
      return Effect.succeed(walk.items)
    }
    return Effect.fail(
      new CapabilityUnavailable({
        capability: 'workspace-export-snapshot',
        reason: 'audit_trail_exceeds_export_walk_bound'
      })
    )
  })
)

/**
 * Reads everything the archive carries through the capability services — the
 * same projections the app renders, so an export never shows a field the UI
 * hides (signing secrets, token hashes, raw audit metadata). Runs against the
 * `WorkspaceContext` in scope: a trusted `actor: null` context on the queue
 * consumer and Seed's deferred path. With no actor the
 * notification feed yields workspace broadcasts only, which is the intended
 * boundary — user-targeted notifications are the user's data.
 */
export function collectWorkspaceExportSnapshot(input: {
  readonly exportId: string
  readonly generatedAt: DateTime.Utc
}): Effect.Effect<
  WorkspaceExportSnapshot,
  CapabilityUnavailable,
  WorkspaceExportSnapshotServices | WorkspaceContext
> {
  return Effect.gen(function* () {
    const ctx = yield* WorkspaceContext
    const membership = yield* WorkspaceMembership
    const invitations = yield* WorkspaceInvitations
    const tokens = yield* ApiTokenRegistry
    const webhooks = yield* WebhookEndpoints
    const feed = yield* NotificationFeed

    const segments = yield* Effect.all(
      {
        members: membership.listMembers,
        invitations: invitations.list,
        apiTokens: tokens.list,
        endpoints: webhooks.list,
        auditEvents: allAuditEvents,
        notifications: feed.list
      },
      { concurrency: 'unbounded' }
    )
    const webhookEndpoints = yield* Effect.forEach(
      segments.endpoints,
      (endpoint) =>
        Effect.map(
          webhooks.listDeliveries({ endpointId: endpoint.id }),
          (deliveries) => ({ ...endpoint, deliveries })
        ),
      { concurrency: 'unbounded' }
    )

    return {
      exportId: input.exportId,
      generatedAt: DateTime.formatIso(input.generatedAt),
      workspace: ctx.workspace,
      members: segments.members,
      invitations: segments.invitations,
      apiTokens: segments.apiTokens,
      webhookEndpoints,
      auditEvents: segments.auditEvents,
      notifications: segments.notifications
    }
  })
}
