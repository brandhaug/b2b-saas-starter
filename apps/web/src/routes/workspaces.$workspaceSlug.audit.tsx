import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Schema } from 'effect'
import { RoutePending } from '@/components/route-pending'
import {
  WorkspaceAuditPage,
  type ApplyWorkspaceAuditSearch
} from '@/components/workspace-audit-page'
import {
  loadWorkspaceAuditEvents,
  type LoadWorkspaceAuditEventsInput,
  type WorkspaceAuditFilters
} from '@/lib/server/workspace-audit'

const optionalString = Schema.optionalKey(Schema.String)

/**
 * The audit page is read-only, so its whole state lives in the URL: filters and
 * the keyset cursor are search params, which makes a filtered view shareable
 * and lets the router re-run the loader per change. Lenient on purpose — an
 * unknown event type or an undecodable cursor addresses an empty result, not
 * an error (mirrors the capability's read contract).
 */
const AuditSearch = Schema.Struct({
  actor: optionalString,
  eventType: optionalString,
  since: optionalString,
  until: optionalString,
  cursor: optionalString
})
type AuditSearch = typeof AuditSearch.Type

const decodeSearch = Schema.decodeUnknownSync(AuditSearch)

function filtersFromSearch(search: AuditSearch): WorkspaceAuditFilters {
  const filters: WorkspaceAuditFilters = {}
  if (search.actor !== undefined) filters.actorUserId = search.actor
  if (search.eventType !== undefined) filters.eventType = search.eventType
  if (search.since !== undefined) filters.since = search.since
  if (search.until !== undefined) filters.until = search.until
  return filters
}

export const Route = createFileRoute('/workspaces/$workspaceSlug/audit')({
  validateSearch: (search) => decodeSearch(search),
  loaderDeps: ({ search }) => ({ search: decodeSearch(search) }),
  loader: ({ params, context, deps }) => {
    const input: LoadWorkspaceAuditEventsInput = {
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id,
      filters: filtersFromSearch(deps.search)
    }
    if (deps.search.cursor !== undefined) input.cursor = deps.search.cursor
    return loadWorkspaceAuditEvents(input)
  },
  pendingComponent: RoutePending,
  component: WorkspaceAuditRoute
})

/** Thin wrapper: hands the router's data and navigator to the page so tests
 * render the page with plain props — no route tree, no mocked hooks. */
function WorkspaceAuditRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const router = useRouter()
  // Full replacement, not a merge with the previous search: the page always
  // hands back complete state (a filter change drops the cursor by omitting
  // it), which is exactly what keyset pagination needs.
  function applySearch(search: Parameters<ApplyWorkspaceAuditSearch>[0]): void {
    void router.navigate({ to: '.', search })
  }
  return (
    <WorkspaceAuditPage
      workspaceSlug={workspaceSlug}
      data={data}
      applySearch={applySearch}
    />
  )
}
