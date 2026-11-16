import { and, or, sql, type SQL } from 'drizzle-orm'
import {
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema/developer-platform'
import { workspaces } from '@b2b-saas-starter/db/schema/workspaces'
import { tableFilterSql } from '../internal/table-filter-query.ts'
import {
  deliveryOperandKind,
  deliveryViewCursor,
  type DeliveryView,
  type DeliveryViewField,
  type DeliveryViewFilter
} from './webhook-delivery-view.ts'

/**
 * The stored value of each field, the SQL side of `deliveryFields`
 * (`webhook-delivery-view.ts`): filters read it raw, sorts and cursors read
 * {@link sortSql}.
 */
const deliveryColumns = {
  endpointUrl: sql`${webhookEndpoints.url}`,
  workspace: sql`${workspaces.name}`,
  eventType: sql`${webhookDeliveries.eventType}`,
  status: sql`${webhookDeliveries.status}`,
  attempts: sql`${webhookDeliveries.attempts}`,
  lastAttemptAt: sql`${webhookDeliveries.lastAttemptAt}`
} satisfies Record<DeliveryViewField, SQL>

/** The sortable projection `deliveryViewValue` computes in memory. */
function sortSql(field: DeliveryViewField): SQL {
  const column = deliveryColumns[field]
  if (deliveryOperandKind(field) === 'number') {
    return sql`printf('%020d', ${column})`
  }
  return sql`coalesce(${column}, '')`
}

function filterSql(filter: DeliveryViewFilter): SQL {
  return tableFilterSql(
    filter,
    deliveryOperandKind(filter.field),
    deliveryColumns[filter.field]
  )
}

/** Parameterized predicates and a lexicographic resume condition for the selected sort tuple. */
export function deliveryViewQuery(view: DeliveryView, cursor: string | undefined) {
  const conditions: Array<SQL> = []
  const filters = view.filters.map(filterSql)
  let predicate = and(...filters)
  if (view.match === 'any') {
    predicate = or(...filters)
  }
  if (predicate) {
    conditions.push(predicate)
  }
  const position = deliveryViewCursor(cursor, view)
  if (position === null) {
    conditions.push(sql`0 = 1`)
  }
  if (position) {
    const alternatives: Array<SQL> = []
    const equal: Array<SQL> = []
    for (const [index, sort] of view.sorts.entries()) {
      const field = sortSql(sort.field)
      const value = position.values[index] ?? ''
      let after = sql`${field} > ${value}`
      if (sort.direction === 'desc') {
        after = sql`${field} < ${value}`
      }
      const clause = and(...equal, after)
      if (clause) {
        alternatives.push(clause)
      }
      equal.push(sql`${field} = ${value}`)
    }
    const tie = and(...equal, sql`${webhookDeliveries.id} < ${position.id}`)
    if (tie) {
      alternatives.push(tie)
    }
    const resume = or(...alternatives)
    if (resume) {
      conditions.push(resume)
    }
  }
  const order = view.sorts.map((sort) => {
    if (sort.direction === 'asc') {
      return sql`${sortSql(sort.field)} asc`
    }
    return sql`${sortSql(sort.field)} desc`
  })
  return { conditions, order: [...order, sql`${webhookDeliveries.id} desc`] }
}
