import { Option, Result, Schema } from 'effect'
import { Base64 } from 'effect/encoding'
import { type GlobalWebhookDelivery } from './webhook-delivery-admin.ts'
import {
  clampPageLimit,
  type ListPageInput,
  type Page
} from '../internal/keyset-cursor.ts'
import {
  asciiFold,
  isActiveTableFilter,
  tableFieldOperators,
  tableFilterMatches,
  type TableFieldKind,
  type TableFilterOperandKind
} from '../internal/table-filter.ts'

const DeliveryViewField = Schema.Literals([
  'endpointUrl',
  'workspace',
  'eventType',
  'status',
  'attempts',
  'lastAttemptAt'
])
export type DeliveryViewField = typeof DeliveryViewField.Type

/**
 * Each column of the global deliveries view: its table-field kind, which
 * fixes the operators it offers and how both interpreters compare it, and the
 * value the in-memory interpreter reads. `deliveryColumns`
 * (`webhook-delivery-view.live.ts`) is the SQL side of the same record.
 */
const deliveryFields = {
  endpointUrl: { kind: 'text', value: (row) => row.endpointUrl },
  workspace: { kind: 'text', value: (row) => row.workspace.name },
  eventType: { kind: 'text', value: (row) => row.eventType },
  status: { kind: 'select', value: (row) => row.status },
  attempts: { kind: 'number', value: (row) => row.attempts },
  lastAttemptAt: { kind: 'date', value: (row) => row.lastAttemptAt }
} as const satisfies Record<
  DeliveryViewField,
  {
    readonly kind: TableFieldKind
    readonly value: (row: GlobalWebhookDelivery) => string | number | null
  }
>

/** Schema caps; a full view binds at most 64 filter and 28 cursor parameters. */
export const deliveryViewLimits = { filters: 32, sorts: 6 } as const

const FilterValue = Schema.String.check(Schema.isMaxLength(512))

function fieldFilter<const F extends DeliveryViewField>(field: F) {
  return Schema.Struct({
    field: Schema.Literal(field),
    operator: Schema.Literals(tableFieldOperators[deliveryFields[field].kind]),
    value: FilterValue,
    endValue: Schema.optionalKey(FilterValue)
  })
}

export const DeliveryViewFilter = Schema.Union([
  fieldFilter('endpointUrl'),
  fieldFilter('workspace'),
  fieldFilter('eventType'),
  fieldFilter('status'),
  fieldFilter('attempts'),
  fieldFilter('lastAttemptAt')
])
export type DeliveryViewFilter = typeof DeliveryViewFilter.Type
export const DeliveryView = Schema.Struct({
  match: Schema.Literals(['all', 'any']),
  filters: Schema.Array(DeliveryViewFilter).check(
    Schema.isMaxLength(deliveryViewLimits.filters)
  ),
  sorts: Schema.Array(
    Schema.Struct({
      field: DeliveryViewField,
      direction: Schema.Literals(['asc', 'desc'])
    })
  ).check(Schema.isMaxLength(deliveryViewLimits.sorts))
})
export type DeliveryView = typeof DeliveryView.Type

/** How a field's kind reads its stored value: only `number` compares numerically. */
export function deliveryOperandKind(field: DeliveryViewField): TableFilterOperandKind {
  if (deliveryFields[field].kind === 'number') {
    return 'number'
  }
  return 'text'
}

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
    filters: view.filters.filter(isActiveTableFilter),
    sorts
  }
}

/**
 * The sortable projection of a field, which cursors carry: numbers padded so
 * they order as text, absent values as `''`.
 */
function deliveryViewValue(
  row: GlobalWebhookDelivery,
  field: DeliveryViewField
): string {
  const value = deliveryFields[field].value(row)
  if (deliveryOperandKind(field) === 'number') {
    return String(value).padStart(20, '0')
  }
  return String(value ?? '')
}

const Cursor = Schema.Struct({
  view: Schema.String,
  values: Schema.Array(Schema.String).check(
    Schema.isMaxLength(deliveryViewLimits.sorts)
  ),
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
  const decoded = Base64.decodeString(cursor)
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
  return tableFilterMatches(
    filter,
    deliveryOperandKind(filter.field),
    deliveryFields[filter.field].value(row),
    asciiFold
  )
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
    nextCursor = Base64.encode(encodeCursor(positionOf(last, view)))
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
