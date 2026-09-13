import {
  AuditEventLog,
  defaultAuditView,
  type AuditView,
  type AuditViewFilter,
  type ListAuditEventsInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requestPresentation } from './i18n-context'
import { workspacePage } from './page-frame'
import { type WorkspaceAuditInput, type WorkspaceAuditPayload } from './workspace-audit'
import { zonedDayBoundary } from './zoned-day-boundary'

/**
 * The audit payload assembly and its server-only wiring, reached only
 * through dynamic `import()` inside the handler of
 * `loadWorkspaceAuditEventsServerFn` (`workspace-audit.ts`); see
 * apps/web/AGENTS.md. `workspace-audit.ts` holds the client-safe half and
 * the reason for the split.
 */

export async function loadWorkspaceAuditEventsHandler(
  input: WorkspaceAuditInput
): Promise<WorkspaceAuditPayload> {
  const session = await requireRequestSession()
  const { filters, cursor, view } = input
  // Spreads keep an absent filter absent; the date filters are the only ones
  // that transform. `YYYY-MM-DD` widens to inclusive instant bounds in the
  // zone the page renders in — the only place that knows the wire contract
  // is ISO timestamps.
  const { timeZone } = requestPresentation()
  const { actorUserId, eventType, since, until } = filters
  let effectiveView: AuditView = defaultAuditView
  if (view) {
    if (view.sorts.length > 0) {
      effectiveView = view
    } else {
      effectiveView = { ...view, sorts: defaultAuditView.sorts }
    }
  }
  const viewWithDateBounds: AuditView = {
    ...effectiveView,
    filters: effectiveView.filters.flatMap((filter) => {
      if (filter.field !== 'createdAt' || !/^\d{4}-\d{2}-\d{2}$/.test(filter.value)) {
        return [filter]
      }
      const start = zonedDayBoundary(filter.value, 'start', timeZone)
      const end = zonedDayBoundary(filter.value, 'end', timeZone)
      if (filter.operator === 'is' || filter.operator === 'isNot') {
        return [{ ...filter, value: `${start}|${end}` } satisfies AuditViewFilter]
      }
      if (filter.operator === 'before') {
        return [{ ...filter, value: start }]
      }
      if (filter.operator === 'after') {
        return [{ ...filter, value: end }]
      }
      return [filter]
    })
  }
  const listInput: ListAuditEventsInput = {
    ...(actorUserId !== undefined && { actorUserId }),
    ...(eventType !== undefined && { eventType }),
    ...(since !== undefined && { since: zonedDayBoundary(since, 'start', timeZone) }),
    ...(until !== undefined && { until: zonedDayBoundary(until, 'end', timeZone) }),
    ...(cursor !== undefined && { cursor }),
    view: viewWithDateBounds
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
        const [page, members, selectedEvent] = yield* Effect.all(
          [
            log.list(listInput),
            membership.listMembers,
            input.event ? log.get(input.event) : Effect.succeed(null)
          ],
          { concurrency: 'unbounded' }
        )
        return {
          selectedEvent,
          events: page.items,
          nextCursor: page.nextCursor,
          filters: input.filters,
          view: effectiveView,
          members: members.map((member) => ({ id: member.id, name: member.name }))
        }
      })
    ),
    { userId: session.user.id }
  )
}
