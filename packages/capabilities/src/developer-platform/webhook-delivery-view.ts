import { Encoding, Option, Result, Schema } from 'effect'
import { type GlobalWebhookDelivery } from './webhook-endpoints.ts'
import {
  clampPageLimit,
  type ListPageInput,
  type Page
} from '../internal/keyset-cursor.ts'

const DeliveryField = Schema.Literals([
  'endpointUrl',
  'workspace',
  'eventType',
  'status',
  'attempts',
  'lastAttemptAt'
])
export const DeliveryView = Schema.Struct({
  match: Schema.Literals(['all', 'any']),
  filters: Schema.Array(
    Schema.Struct({
      field: DeliveryField,
      operator: Schema.Literals([
        'contains',
        'notContains',
        'is',
        'isNot',
        'before',
        'after',
        'gt',
        'lt',
        'isEmpty',
        'isNotEmpty'
      ]),
      value: Schema.String.check(Schema.isMaxLength(512)),
      endValue: Schema.optionalKey(Schema.String)
    })
  ).check(Schema.isMaxLength(32)),
  sorts: Schema.Array(
    Schema.Struct({ field: DeliveryField, direction: Schema.Literals(['asc', 'desc']) })
  ).check(Schema.isMaxLength(6))
})
export type DeliveryView = typeof DeliveryView.Type
export type DeliveryViewField = DeliveryView['sorts'][number]['field']
export type DeliveryViewFilter = DeliveryView['filters'][number]
export type ListGlobalDeliveriesInput = ListPageInput & {
  readonly view?: DeliveryView | undefined
}

export function deliveryView(
  input: ListGlobalDeliveriesInput | undefined
): DeliveryView {
  const view = input?.view ?? { match: 'all', filters: [], sorts: [] }
  let sorts = view.sorts
  if (sorts.length === 0) {
    sorts = [{ field: 'lastAttemptAt', direction: 'desc' }]
  }
  return {
    ...view,
    filters: view.filters.filter(
      (filter) =>
        filter.operator === 'isEmpty' ||
        filter.operator === 'isNotEmpty' ||
        filter.value.trim() !== ''
    ),
    sorts
  }
}

export function deliveryViewValue(
  row: GlobalWebhookDelivery,
  field: DeliveryViewField
): string {
  if (field === 'workspace') {
    return row.workspace.name
  }
  if (field === 'attempts') {
    return String(row.attempts).padStart(20, '0')
  }
  return row[field] ?? ''
}

const Cursor = Schema.Struct({
  view: Schema.String,
  values: Schema.Array(Schema.String).check(Schema.isMaxLength(6)),
  id: Schema.NonEmptyString
})
type Cursor = typeof Cursor.Type
const decodeCursor = Schema.decodeUnknownOption(Schema.fromJsonString(Cursor))
const encodeCursor = Schema.encodeSync(Schema.fromJsonString(Cursor))
const encodeView = Schema.encodeSync(Schema.fromJsonString(DeliveryView))

export function deliveryViewCursor(
  cursor: string | undefined,
  view: DeliveryView
): Cursor | null | undefined {
  if (cursor === undefined) {
    return undefined
  }
  if (cursor.length > 32_768) {
    return null
  }
  const decoded = Encoding.decodeBase64String(cursor)
  if (Result.isFailure(decoded)) {
    return null
  }
  const result = decodeCursor(decoded.success)
  if (Option.isNone(result)) {
    return null
  }
  const position = result.value
  if (
    position.view === encodeView(view) &&
    position.values.length === view.sorts.length
  ) {
    return position
  }
  return null
}

function compare(left: string, right: string, direction: 'asc' | 'desc'): number {
  if (left === right) {
    return 0
  }
  let order = 1
  if (left < right) {
    order = -1
  }
  if (direction === 'desc') {
    return -order
  }
  return order
}

function comparePosition(
  row: GlobalWebhookDelivery,
  position: Cursor,
  view: DeliveryView
): number {
  for (const [index, sort] of view.sorts.entries()) {
    const order = compare(
      deliveryViewValue(row, sort.field),
      position.values[index] ?? '',
      sort.direction
    )
    if (order !== 0) {
      return order
    }
  }
  return compare(row.id, position.id, 'desc')
}

function positionOf(row: GlobalWebhookDelivery, view: DeliveryView): Cursor {
  return {
    view: encodeView(view),
    values: view.sorts.map((sort) => deliveryViewValue(row, sort.field)),
    id: row.id
  }
}

function matches(row: GlobalWebhookDelivery, filter: DeliveryViewFilter): boolean {
  if (filter.field === 'attempts') {
    const expected = Number(filter.value)
    switch (filter.operator) {
      case 'isEmpty': {
        return false
      }
      case 'isNotEmpty': {
        return true
      }
      case 'is': {
        return Number.isFinite(expected) && row.attempts === expected
      }
      case 'isNot': {
        return Number.isFinite(expected) && row.attempts !== expected
      }
      case 'gt': {
        return Number.isFinite(expected) && row.attempts > expected
      }
      case 'lt': {
        return Number.isFinite(expected) && row.attempts < expected
      }
      case 'after':
      case 'before':
      case 'contains':
      case 'notContains': {
        return false
      }
    }
  }
  const value = deliveryViewValue(row, filter.field)
  const expected = filter.value
  switch (filter.operator) {
    case 'isEmpty': {
      return value === ''
    }
    case 'isNotEmpty': {
      return value !== ''
    }
    case 'contains': {
      return value.toLowerCase().includes(expected.toLowerCase())
    }
    case 'notContains': {
      return !value.toLowerCase().includes(expected.toLowerCase())
    }
    case 'is': {
      if (filter.endValue === undefined) {
        return value.toLowerCase() === expected.toLowerCase()
      }
      return value >= expected && value <= filter.endValue
    }
    case 'isNot': {
      if (filter.endValue === undefined) {
        return value.toLowerCase() !== expected.toLowerCase()
      }
      return value < expected || value > filter.endValue
    }
    case 'before':
    case 'lt': {
      return value !== '' && value < expected
    }
    case 'after':
    case 'gt': {
      return value !== '' && value > expected
    }
  }
}

export function cutDeliveryViewPage(
  rows: ReadonlyArray<GlobalWebhookDelivery>,
  limit: number,
  view: DeliveryView
): Page<GlobalWebhookDelivery> {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  let nextCursor: string | null = null
  if (rows.length > limit && last) {
    nextCursor = Encoding.encodeBase64(encodeCursor(positionOf(last, view)))
  }
  return { items, nextCursor }
}

export function seedDeliveryViewPage(
  rows: ReadonlyArray<GlobalWebhookDelivery>,
  input: ListGlobalDeliveriesInput | undefined
): Page<GlobalWebhookDelivery> {
  const view = deliveryView(input)
  const cursor = deliveryViewCursor(input?.cursor, view)
  if (cursor === null) {
    return { items: [], nextCursor: null }
  }
  const filtered = rows.filter((row) => {
    let accepts = view.filters.every((filter) => matches(row, filter))
    if (view.match === 'any' && view.filters.length > 0) {
      accepts = view.filters.some((filter) => matches(row, filter))
    }
    return accepts && (cursor === undefined || comparePosition(row, cursor, view) > 0)
  })
  const ordered = filtered.toSorted((left, right) =>
    comparePosition(left, positionOf(right, view), view)
  )
  return cutDeliveryViewPage(ordered, clampPageLimit(input?.limit), view)
}
