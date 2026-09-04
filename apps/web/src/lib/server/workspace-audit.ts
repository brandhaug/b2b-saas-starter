import {
  AuditEventLog,
  type AuditEvent,
  type ListAuditEventsInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { workspacePage } from './page-frame'

/**
 * Server-side filters for the audit page, straight from the route's search
 * params. Dates arrive as `YYYY-MM-DD` and are widened to inclusive UTC
 * instant bounds in `loadWorkspaceAuditEvents` — the only place that knows
 * the wire contract is ISO timestamps (see `AuditEventLog.list`).
 */
export type WorkspaceAuditFilters = {
  actorUserId?: string
  eventType?: string
  since?: string
  until?: string
}

/** The loader's input shape. */
export type LoadWorkspaceAuditEventsInput = {
  workspaceSlug: string
  userId: string
  filters: WorkspaceAuditFilters
  /** Opaque keyset cursor from a previous page. */
  cursor?: string
}

/**
 * The per-workspace audit payload. `auditLog: ['read']` is the page's own read
 * permission and a hard gate — the whole page is the audit log, so an actor
 * without it has no page to render (403), not an empty shell. That is also why
 * this payload is permission-shaped by construction rather than by nullable
 * segments: nothing below the gate needs a second decision.
 *
 * The member list feeds the actor filter's id-keyed options. No second
 * permission decision is made here: `auditLog: ['read']` is owner/admin only,
 * and the hard gate above already decided who reaches this payload.
 */
export type WorkspaceAuditPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly events: ReadonlyArray<AuditEvent>
  /** Opaque keyset cursor for the next older page, or null on the last one. */
  readonly nextCursor: string | null
  /** The filters this page was loaded with, echoed back for the controls. */
  readonly filters: WorkspaceAuditFilters
  readonly members: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

export function loadWorkspaceAuditEvents(
  input: LoadWorkspaceAuditEventsInput
): Promise<WorkspaceAuditPayload> {
  const { filters, cursor } = input
  // Spreads keep an absent filter absent; the date filters are the only ones
  // that transform.
  const { actorUserId, eventType, since, until } = filters
  const listInput: ListAuditEventsInput = {
    ...(actorUserId !== undefined && { actorUserId }),
    ...(eventType !== undefined && { eventType }),
    // `YYYY-MM-DD` widens to inclusive UTC instant bounds — the only place
    // that knows the wire contract is ISO timestamps.
    ...(since !== undefined && { since: `${since}T00:00:00.000Z` }),
    ...(until !== undefined && { until: `${until}T23:59:59.999Z` }),
    ...(cursor !== undefined && { cursor })
  }
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    workspacePage({ auditLog: ['read'] }, () =>
      Effect.gen(function* () {
        const log = yield* AuditEventLog
        const membership = yield* WorkspaceMembership
        // No second gate here: the hard `auditLog` read above already decided
        // who reaches this payload (owner/admin only), and the role table has no
        // separate member-list statement to compose.
        const [page, members] = yield* Effect.all(
          [log.list(listInput), membership.listMembers],
          { concurrency: 'unbounded' }
        )
        return {
          events: page.events,
          nextCursor: page.nextCursor,
          filters: input.filters,
          members: members.map((member) => ({ id: member.id, name: member.name }))
        }
      })
    ),
    { userId: input.userId }
  )
}
