import {
  AuditEventLog,
  type ListAuditEventsInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { workspacePage } from './page-frame'
import {
  type LoadWorkspaceAuditEventsInput,
  type WorkspaceAuditInput,
  type WorkspaceAuditPayload
} from './workspace-audit'

/**
 * The audit payload assembly and its server-only wiring, reached only
 * through dynamic `import()` inside the handler of
 * `loadWorkspaceAuditEventsServerFn` (`workspace-audit.ts`); see
 * apps/web/AGENTS.md. `workspace-audit.ts` holds the client-safe half and
 * the reason for the split.
 */

/**
 * The loader as a plain function, so tests drive it directly with fixture
 * actors (`workspace-audit.test.ts`) — no request, no auth runtime. The
 * actor is the session's user; the layout route's gate has already proved
 * membership, and `runWorkspaceCapabilities` re-proves it server-side.
 */
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

export async function loadWorkspaceAuditEventsHandler(
  input: WorkspaceAuditInput
): Promise<WorkspaceAuditPayload> {
  const session = await requireRequestSession()
  return loadWorkspaceAuditEvents({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id,
    filters: input.filters,
    ...(input.cursor !== undefined && { cursor: input.cursor })
  })
}
