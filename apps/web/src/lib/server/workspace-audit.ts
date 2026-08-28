import {
  AuditEventLog,
  type AuditEvent,
  type ListAuditEventsInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireWorkspacePermission } from './authorize'

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

/** The loader's input shape, named so callers can build it imperatively. */
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

/** The capability-level filter input, widened to mutable bounds so the
 * day-to-instant conversion can assign properties one at a time. */
type AuditListInput = {
  -readonly [K in keyof ListAuditEventsInput]: ListAuditEventsInput[K]
}

export function loadWorkspaceAuditEvents(
  input: LoadWorkspaceAuditEventsInput
): Promise<WorkspaceAuditPayload> {
  const listInput: AuditListInput = {}
  if (input.filters.actorUserId !== undefined) {
    listInput.actorUserId = input.filters.actorUserId
  }
  if (input.filters.eventType !== undefined) {
    listInput.eventType = input.filters.eventType
  }
  // `YYYY-MM-DD` widens to inclusive UTC instant bounds — the only place that
  // knows the wire contract is ISO timestamps.
  if (input.filters.since !== undefined) {
    listInput.since = `${input.filters.since}T00:00:00.000Z`
  }
  if (input.filters.until !== undefined) {
    listInput.until = `${input.filters.until}T23:59:59.999Z`
  }
  if (input.cursor !== undefined) {
    listInput.cursor = input.cursor
  }
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ auditLog: ['read'] })
      const ctx = yield* WorkspaceContext
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
        viewer: ctx.actor ? { role: ctx.actor.role } : null,
        events: page.events,
        nextCursor: page.nextCursor,
        filters: input.filters,
        members: members.map((member) => ({ id: member.id, name: member.name }))
      }
    }),
    { userId: input.userId }
  )
}
