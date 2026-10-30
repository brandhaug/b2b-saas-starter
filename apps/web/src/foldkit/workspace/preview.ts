import { demoAuditDetails, demoFixtures } from '@/lib/demo-fixtures'
import { auditFiltersFromSearch, auditViewFromSearch } from '@/lib/audit-search'
import { applyTableView } from '@/lib/table-view'
import { type WorkspacePage } from './model'

/** Read-only projection of synthetic evidence, never live data. */
export function auditPage(url: URL): Extract<WorkspacePage, { _tag: 'audit' }> {
  const search = url.searchParams
  const filters = auditFiltersFromSearch({
    actor: search.get('actor') ?? undefined,
    eventType: search.get('eventType') ?? undefined,
    since: search.get('since') ?? undefined,
    until: search.get('until') ?? undefined
  })
  const view = auditViewFromSearch(search.get('view') ?? undefined)
  const events = applyTableView(
    demoAuditDetails.filter(
      (event) =>
        (!filters.actorUserId || event.actorUserId === filters.actorUserId) &&
        (!filters.eventType || event.eventType === filters.eventType) &&
        (!filters.since || event.createdAt >= `${filters.since}T00:00:00.000Z`) &&
        (!filters.until || event.createdAt <= `${filters.until}T23:59:59.999Z`)
    ),
    view,
    (event, key) => {
      if (key === 'actorUserId') {
        return event.actorUserId
      }
      if (key === 'actorType') {
        return event.actorType
      }
      if (key === 'eventType') {
        return event.eventType
      }
      return event.createdAt
    }
  )
  return {
    _tag: 'audit',
    data: {
      ...demoFixtures.audit,
      events,
      view,
      filters,
      selectedEvent:
        demoAuditDetails.find((event) => event.id === search.get('event')) ?? null
    }
  }
}
