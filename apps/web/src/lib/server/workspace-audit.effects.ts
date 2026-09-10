import {
  AuditEventLog,
  type ListAuditEventsInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requestPresentation } from './i18n-context'
import { workspacePage } from './page-frame'
import { type WorkspaceAuditInput, type WorkspaceAuditPayload } from './workspace-audit'

/**
 * The audit payload assembly and its server-only wiring, reached only
 * through dynamic `import()` inside the handler of
 * `loadWorkspaceAuditEventsServerFn` (`workspace-audit.ts`); see
 * apps/web/AGENTS.md. `workspace-audit.ts` holds the client-safe half and
 * the reason for the split.
 */

/**
 * The offset `timeZone` is at on a given instant, in milliseconds east of
 * UTC. Read off Intl rather than a table, so DST is the platform's problem.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset'
  }).formatToParts(instant)
  // `GMT+02:00`, or a bare `GMT` at zero offset.
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset)
  if (match === null) {
    return 0
  }
  const [, sign, hours, minutes] = match
  const magnitude = (Number(hours ?? '0') * 60 + Number(minutes ?? '0')) * 60_000
  return sign === '-' ? -magnitude : magnitude
}

/**
 * The instant a `YYYY-MM-DD` day boundary falls on in `timeZone`. The page
 * renders every timestamp in the request's presentation zone
 * (`lib/format-date.ts`), so "since the 14th" has to mean that zone's 14th;
 * widening to UTC bounds would silently shift the range by the offset.
 */
export function zonedDayBoundary(
  day: string,
  edge: 'start' | 'end',
  timeZone: string
): string {
  const wall = Date.parse(
    edge === 'start' ? `${day}T00:00:00.000Z` : `${day}T23:59:59.999Z`
  )
  // Two passes: the first offset is read at a guessed instant, which lands on
  // the wrong side of a DST transition exactly when the offset changes that
  // day; re-reading it at the corrected instant settles the boundary.
  const guess = wall - zoneOffsetMs(new Date(wall), timeZone)
  return new Date(wall - zoneOffsetMs(new Date(guess), timeZone)).toISOString()
}

export async function loadWorkspaceAuditEventsHandler(
  input: WorkspaceAuditInput
): Promise<WorkspaceAuditPayload> {
  const session = await requireRequestSession()
  const { filters, cursor } = input
  // Spreads keep an absent filter absent; the date filters are the only ones
  // that transform. `YYYY-MM-DD` widens to inclusive instant bounds in the
  // zone the page renders in — the only place that knows the wire contract
  // is ISO timestamps.
  const { timeZone } = requestPresentation()
  const { actorUserId, eventType, since, until } = filters
  const listInput: ListAuditEventsInput = {
    ...(actorUserId !== undefined && { actorUserId }),
    ...(eventType !== undefined && { eventType }),
    ...(since !== undefined && { since: zonedDayBoundary(since, 'start', timeZone) }),
    ...(until !== undefined && { until: zonedDayBoundary(until, 'end', timeZone) }),
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
          members: members.map((member) => ({ id: member.id, name: member.name }))
        }
      })
    ),
    { userId: session.user.id }
  )
}
