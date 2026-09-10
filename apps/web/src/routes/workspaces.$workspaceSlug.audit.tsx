import { createFileRoute, useRouter } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { workspaceRouteError } from '@/components/workspace-route-error'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceAuditPage } from '@/components/workspace-audit-page'
import { type ApplyWorkspaceAuditSearch } from '@/lib/audit-search'
import { m } from '@b2b-saas-starter/i18n/messages'
import { pickOptionalStrings } from '@/lib/utils'
import {
  loadWorkspaceAuditEventsServerFn,
  type WorkspaceAuditFilters
} from '@/lib/server/workspace-audit'

/** The audit page's denial and failure copy, rendered inside the shell. */
const AuditRouteError = workspaceRouteError({
  deniedTitle: m.audit_access_denied,
  deniedDescription: m.audit_forbidden_description,
  failedTitle: m.audit_unavailable,
  failedDescription: m.audit_load_failed
})

/**
 * The audit page is read-only, so its whole state lives in the URL: filters and
 * the keyset cursor are search params, which makes a filtered view shareable
 * and lets the router re-run the loader per change. Lenient on purpose — an
 * unknown event type or an undecodable cursor addresses an empty result, not
 * an error (mirrors the capability's read contract).
 *
 * The search keys are picked with `pickOptionalStrings`, not effect/Schema:
 * `validateSearch` runs client-side in the route shell the whole route tree
 * carries, and a Schema construct here would pin the 145 kB Effect Schema
 * chunk onto every page — the same trade the auth-flow routes make
 * (see apps/web's intent node).
 */
const AUDIT_SEARCH_KEYS: ReadonlyArray<string> = [
  'actor',
  'eventType',
  'since',
  'until',
  'cursor',
  'event'
]

type AuditSearch = {
  readonly actor?: string | undefined
  readonly eventType?: string | undefined
  readonly since?: string | undefined
  readonly until?: string | undefined
  readonly event?: string | undefined
  readonly cursor?: string | undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the router hands `validateSearch` an untyped record; `pickOptionalStrings` (which carries the same exemption) is the parse step
function decodeSearch(search: unknown): AuditSearch {
  return pickOptionalStrings(search, AUDIT_SEARCH_KEYS)
}

function filtersFromSearch(search: AuditSearch): WorkspaceAuditFilters {
  const filters: WorkspaceAuditFilters = {}
  if (search.actor !== undefined) {
    filters.actorUserId = search.actor
  }
  if (search.eventType !== undefined) {
    filters.eventType = search.eventType
  }
  if (search.since !== undefined) {
    filters.since = search.since
  }
  if (search.until !== undefined) {
    filters.until = search.until
  }
  return filters
}

export const Route = createFileRoute('/workspaces/$workspaceSlug/audit')({
  validateSearch: (search) => decodeSearch(search),
  loaderDeps: ({ search }) => ({ search: decodeSearch(search) }),
  loader: {
    // Search changes reload this same route. Show the route pending state while
    // a selected event is fetched so detail failures do not look like a
    // missing event.
    staleReloadMode: 'blocking',
    handler: ({ params, deps }) =>
      loadWorkspaceAuditEventsServerFn({
        data: {
          workspaceSlug: params.workspaceSlug,
          filters: filtersFromSearch(deps.search),
          ...(deps.search.cursor !== undefined && { cursor: deps.search.cursor }),
          ...(deps.search.event && { event: deps.search.event })
        }
      })
  },
  pendingComponent: RoutePending,
  errorComponent: AuditRouteError,
  component: WorkspaceAuditRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle(m.public_meta_audit(), params.workspaceSlug) }]
  })
})

/** Thin wrapper: hands the router's data and navigator to the page so tests
 * render the page with plain props — no route tree, no mocked hooks. */
function WorkspaceAuditRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  // Full replacement, not a merge with the previous search: the page always
  // hands back complete state (a filter change drops the cursor by omitting
  // it), which is exactly what keyset pagination needs.
  function applySearch(nextSearch: Parameters<ApplyWorkspaceAuditSearch>[0]): void {
    void router.navigate({ to: '.', search: nextSearch })
  }
  return (
    <WorkspaceAuditPage
      workspaceSlug={workspaceSlug}
      data={data}
      selectedEventId={search.event || null}
      closeEvent={() => {
        if (router.state.location.state.auditEventOpened) {
          router.history.back()
        } else {
          const listSearch = { ...search }
          delete listSearch.event
          void router.navigate({ to: '.', search: listSearch, replace: true })
        }
      }}
      applySearch={applySearch}
      systemRole={Route.useRouteContext().session.user.role}
    />
  )
}
