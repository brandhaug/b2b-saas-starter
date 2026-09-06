import {
  AuditEventLog,
  type ListAuditEventsInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { workspacePage } from './page-frame'
import { type WorkspaceAuditInput, type WorkspaceAuditPayload } from './workspace-audit'

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
  const { filters, cursor } = input
  // Spreads keep an absent filter absent; the date filters are the only ones
  // that transform. `YYYY-MM-DD` widens to inclusive UTC instant bounds —
  // the only place that knows the wire contract is ISO timestamps.
  const { actorUserId, eventType, since, until } = filters
  const listInput: ListAuditEventsInput = {
    ...(actorUserId !== undefined && { actorUserId }),
    ...(eventType !== undefined && { eventType }),
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
