import {
  AuditEventLog,
  type ListAuditEventsInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { Effect, Schema } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { workspacePage } from './page-frame'
import {
  type LoadWorkspaceAuditEventsInput,
  type WorkspaceAuditPayload
} from './workspace-audit'

/**
 * The audit payload assembly and its server-only wiring, reached only
 * through dynamic `import()` inside the handler of
 * `loadWorkspaceAuditEventsServerFn` (`workspace-audit.ts`): handler bodies
 * are stripped from the client build, so this graph ships to the server
 * alone. `workspace-audit.ts` holds the client-safe half and the reason
 * for the split.
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

/**
 * The server fn's input schema, decoded here rather than in
 * `workspace-audit.ts`: the client stub never runs validators, and a
 * module-level Schema construct in the client-safe file would drag the
 * Effect Schema chunk onto every page. The filter keys stay optional and
 * unconstrained — the page's search params are lenient on purpose, and an
 * unknown event type or an undecodable cursor addresses an empty result,
 * not an error.
 */
const WorkspaceAuditInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  filters: Schema.Struct({
    actorUserId: Schema.optionalKey(Schema.String),
    eventType: Schema.optionalKey(Schema.String),
    since: Schema.optionalKey(Schema.String),
    until: Schema.optionalKey(Schema.String)
  }),
  cursor: Schema.optionalKey(Schema.String)
})

const decodeAuditInput = Schema.decodeUnknownSync(WorkspaceAuditInput)

export async function loadWorkspaceAuditEventsHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<WorkspaceAuditPayload> {
  const input = decodeAuditInput(data)
  const session = await requireRequestSession()
  return loadWorkspaceAuditEvents({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id,
    filters: input.filters,
    ...(input.cursor !== undefined && { cursor: input.cursor })
  })
}
