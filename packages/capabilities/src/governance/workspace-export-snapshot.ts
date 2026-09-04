import { DateTime, Effect } from 'effect'

import { ApiTokenRegistry } from '../developer-platform/api-token-registry.ts'
import { WebhookEndpoints } from '../developer-platform/webhook-endpoints.ts'
import { type CapabilityUnavailable } from '../errors.ts'
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

/** Every page of the workspace's audit trail, newest first. */
const allAuditEvents: Effect.Effect<
  ReadonlyArray<AuditEvent>,
  CapabilityUnavailable,
  AuditEventLog | WorkspaceContext
> = Effect.gen(function* () {
  const log = yield* AuditEventLog
  // Keyset pagination: the capability caps a page at 100, so the export walks
  // the cursor chain until the log reports the last page.
  let page = yield* log.list()
  const events: Array<AuditEvent> = [...page.events]
  while (page.nextCursor !== null) {
    page = yield* log.list({ cursor: page.nextCursor })
    events.push(...page.events)
  }
  return events
})

/**
 * Reads everything the archive carries through the capability services — the
 * same projections the app renders, so an export never shows a field the UI
 * hides (signing secrets, token hashes, raw audit metadata). Runs against the
 * `WorkspaceContext` in scope: a trusted `actor: null` context on the queue
 * consumer, the requesting owner's on the Seed path. With no actor the
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
