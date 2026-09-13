import { and, or, sql, type SQL } from 'drizzle-orm'
import {
  webhookDeliveries,
  webhookEndpoints,
  workspaces
} from '@b2b-saas-starter/db/schema'
import {
  deliveryViewCursor,
  type DeliveryView,
  type DeliveryViewField,
  type DeliveryViewFilter
} from './webhook-delivery-view.ts'

function fieldSql(field: DeliveryViewField): SQL {
  switch (field) {
    case 'endpointUrl': {
      return sql`${webhookEndpoints.url}`
    }
    case 'workspace': {
      return sql`${workspaces.name}`
    }
    case 'eventType': {
      return sql`${webhookDeliveries.eventType}`
    }
    case 'status': {
      return sql`${webhookDeliveries.status}`
    }
    case 'attempts': {
      return sql`printf('%020d', ${webhookDeliveries.attempts})`
    }
    case 'lastAttemptAt': {
      return sql`coalesce(${webhookDeliveries.lastAttemptAt}, '')`
    }
  }
}

function filterSql(filter: DeliveryViewFilter): SQL {
  if (filter.field === 'attempts') {
    const value = Number(filter.value)
    if (!Number.isFinite(value)) {
      return sql`0 = 1`
    }
    switch (filter.operator) {
      case 'isEmpty': {
        return sql`0 = 1`
      }
      case 'isNotEmpty': {
        return sql`1 = 1`
      }
      case 'is': {
        return sql`${webhookDeliveries.attempts} = ${value}`
      }
      case 'isNot': {
        return sql`${webhookDeliveries.attempts} <> ${value}`
      }
      case 'gt': {
        return sql`${webhookDeliveries.attempts} > ${value}`
      }
      case 'lt': {
        return sql`${webhookDeliveries.attempts} < ${value}`
      }
      case 'after':
      case 'before':
      case 'contains':
      case 'notContains': {
        return sql`0 = 1`
      }
    }
  }
  const field = fieldSql(filter.field)
  const value = filter.value
  switch (filter.operator) {
    case 'isEmpty': {
      return sql`${field} = ''`
    }
    case 'isNotEmpty': {
      return sql`${field} <> ''`
    }
    case 'is': {
      if (filter.endValue === undefined) {
        return sql`lower(${field}) = ${value.toLowerCase()}`
      }
      return sql`${field} >= ${value} and ${field} <= ${filter.endValue}`
    }
    case 'isNot': {
      if (filter.endValue === undefined) {
        return sql`lower(${field}) <> ${value.toLowerCase()}`
      }
      return sql`(${field} < ${value} or ${field} > ${filter.endValue})`
    }
    case 'contains': {
      return sql`instr(lower(${field}), ${value.toLowerCase()}) > 0`
    }
    case 'notContains': {
      return sql`instr(lower(${field}), ${value.toLowerCase()}) = 0`
    }
    case 'before':
    case 'lt': {
      return sql`${field} <> '' and ${field} < ${value}`
    }
    case 'after':
    case 'gt': {
      return sql`${field} <> '' and ${field} > ${value}`
    }
  }
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
      const field = fieldSql(sort.field)
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
      return sql`${fieldSql(sort.field)} asc`
    }
    return sql`${fieldSql(sort.field)} desc`
  })
  return { conditions, order: [...order, sql`${webhookDeliveries.id} desc`] }
}
