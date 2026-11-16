import {
  columnFilteringFeature,
  constructTable,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  type Row,
  type TableFeatures,
  type RowData
} from '@tanstack/table-core'
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings'
import { presentationSettings } from './i18n'
import { Option, Schema } from 'effect'
import {
  isActiveTableFilter,
  tableFieldOperators,
  TableFilterOperator,
  tableFilterMatches,
  type TableFieldKind
} from '@b2b-saas-starter/capabilities/internal/table-filter'

export type TableViewMatch = 'all' | 'any'

export type TableViewField = {
  readonly id: string
  readonly label: string
  readonly kind: TableFieldKind
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>
}

export type TableView = {
  readonly query?: string
  readonly pageIndex?: number
  readonly match: TableViewMatch
  readonly filters: ReadonlyArray<{
    readonly field: string
    readonly operator: TableFilterOperator
    readonly value: string
  }>
  readonly sorts: ReadonlyArray<{
    readonly field: string
    readonly direction: 'asc' | 'desc'
  }>
}

export const defaultTableView: TableView = { match: 'all', filters: [], sorts: [] }

const MAX_INPUT_LENGTH = 16_384
const MAX_ITEMS = 32
const decodeEnvelope = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
)
const decodeItems = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))
const decodeFilter = Schema.decodeUnknownOption(
  Schema.Struct({
    field: Schema.String,
    operator: TableFilterOperator,
    value: Schema.String.check(Schema.isMaxLength(512))
  })
)
const decodeSort = Schema.decodeUnknownOption(
  Schema.Struct({ field: Schema.String, direction: Schema.Literals(['asc', 'desc']) })
)
const decodeQuery = Schema.decodeUnknownOption(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))
)
const decodePageIndex = Schema.decodeUnknownOption(
  Schema.Int.check(Schema.isGreaterThan(0))
)

export function parseTableView(
  serialized: string | undefined,
  fields: ReadonlyArray<TableViewField>
): TableView {
  if (!serialized || serialized.length > MAX_INPUT_LENGTH) {
    return defaultTableView
  }
  const envelope = decodeEnvelope(serialized)
  if (Option.isNone(envelope)) {
    return defaultTableView
  }
  const decoded = envelope.value
  const fieldIds = new Set(fields.map((field) => field.id))
  const parsedFilters = Option.getOrElse(decodeItems(decoded.filters), () => [])
    .slice(0, MAX_ITEMS)
    .flatMap((candidate) => {
      const filter = decodeFilter(candidate)
      if (Option.isNone(filter)) {
        return []
      }
      const { field, operator, value } = filter.value
      const fieldSpec = fields.find((item) => item.id === field)
      const validOption =
        fieldSpec?.kind !== 'select' ||
        value === '' ||
        fieldSpec.options?.some((option) => option.value === value)
      const validOperator = validOperatorForField(fieldSpec, operator)
      const validValue = validValueForField(fieldSpec, value)
      if (!fieldIds.has(field) || !validOption || !validOperator || !validValue) {
        return []
      }
      return [{ field, operator, value }]
    })
  const seenFilterFields = new Set<string>()
  const filters = parsedFilters.filter((filter) => {
    if (seenFilterFields.has(filter.field)) {
      return false
    }
    seenFilterFields.add(filter.field)
    return true
  })
  const parsedSorts = Option.getOrElse(decodeItems(decoded.sorts), () => [])
    .slice(0, MAX_ITEMS)
    .flatMap((candidate) => {
      const sort = decodeSort(candidate)
      if (Option.isNone(sort) || !fieldIds.has(sort.value.field)) {
        return []
      }
      return [sort.value]
    })
  const seenSortFields = new Set<string>()
  const sorts = parsedSorts.filter((sort) => {
    if (seenSortFields.has(sort.field)) {
      return false
    }
    seenSortFields.add(sort.field)
    return true
  })
  let view: TableView = {
    match: decoded.match === 'any' ? 'any' : 'all',
    filters,
    sorts
  }
  const query = decodeQuery(decoded.query)
  if (Option.isSome(query)) {
    view = { ...view, query: query.value }
  }
  const pageIndex = decodePageIndex(decoded.pageIndex)
  if (Option.isSome(pageIndex)) {
    view = { ...view, pageIndex: pageIndex.value }
  }
  return view
}

export function serializeTableView(view: TableView): string | undefined {
  if (
    view.filters.length === 0 &&
    view.sorts.length === 0 &&
    view.match === 'all' &&
    !view.query &&
    !view.pageIndex
  ) {
    return undefined
  }
  return JSON.stringify({
    query: view.query || undefined,
    pageIndex: view.pageIndex || undefined,
    match: view.match,
    filters: view.filters.slice(0, MAX_ITEMS),
    sorts: view.sorts.slice(0, MAX_ITEMS)
  })
}
export function operatorsForTableField(
  field: TableViewField
): ReadonlyArray<TableFilterOperator> {
  return tableFieldOperators[field.kind]
}

function validOperatorForField(
  field: TableViewField | undefined,
  operator: TableFilterOperator
): boolean {
  return field !== undefined && operatorsForTableField(field).includes(operator)
}

function validValueForField(field: TableViewField | undefined, value: string): boolean {
  if (value.length === 0) {
    return true
  }
  if (field?.kind === 'number') {
    return Number.isFinite(Number(value))
  }
  if (field?.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }
  return field?.kind !== 'date' || Number.isFinite(Date.parse(value))
}

/* oxlint-disable unicorn/no-instanceof-builtins -- Date is a supported public value type and cross-realm dates are outside this local table model. */
function valueAsText(value: TableValue): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '')
}

const calendarFormatters = new Map<string, Intl.DateTimeFormat>()

/* oxlint-disable anti-slop/no-runtime-typeof -- pure table comparisons discriminate already-typed local values, not untrusted input */
function calendarDay(value: Date | string): string | undefined {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  const instant = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(instant.getTime())) {
    return undefined
  }
  const { timeZone } = presentationSettings()
  let formatter = calendarFormatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    calendarFormatters.set(timeZone, formatter)
  }
  return formatter.format(instant)
}

type TableValue = string | number | boolean | Date | null | undefined

// SAFETY: TanStack 9.3.1's includesString.filter reads only its two string operands;
// its declaration additionally requires an unused, invariant Row<any, any>.
// oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- Narrow the verified value-only library signature.
const includesText = filterFn_includesString.filter as (a: string, b: string) => boolean
// SAFETY: TanStack 9.3.1's basic.sort calls compareBasic(a, b) without reading rows.
// oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- Narrow the verified value-only library signature.
const compareValue = sortFn_basic.sort as (
  a: string | number,
  b: string | number | undefined
) => number

/** One case fold for quick search and filters, so the two agree on a table. */
function localeFold(text: string): string {
  return text.toLocaleLowerCase()
}

/** A declared field kind decides; values are inspected only for undeclared fields. */
function comparisonKind(
  left: TableValue,
  right: TableValue,
  kind?: TableViewField['kind']
) {
  if (kind === 'number' || kind === 'date') {
    return kind
  }
  if (kind === 'text' || kind === 'select') {
    return 'text'
  }
  if (typeof left === 'number') {
    return 'number'
  }
  if (
    left instanceof Date ||
    (/^\d{4}-\d{2}-\d{2}/.test(valueAsText(left)) &&
      /^\d{4}-\d{2}-\d{2}/.test(valueAsText(right)))
  ) {
    return 'date'
  }
  return 'text'
}

function comparable(value: TableValue, kind: TableViewField['kind'], day = false) {
  if (value === null || value === undefined) {
    return
  }
  if (kind === 'number') {
    const number = Number(value)
    return Number.isFinite(number) ? number : Number.NaN
  }
  if (kind === 'date') {
    return day
      ? calendarDay(value instanceof Date ? value : String(value))
      : new Date(valueAsText(value)).getTime()
  }
  return localeFold(valueAsText(value))
}
/* oxlint-enable unicorn/no-instanceof-builtins */

function finiteNumber(value: TableValue): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export const tableViewFeatures = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  globalFilteringFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel()
})

/** Shared by the rendered table and headless lists; only application policies
 * wrap TanStack's value predicates and comparison functions. */
export function tableViewOptions<T extends RowData>(
  view: TableView,
  getValue: (row: T, field: string) => TableValue,
  fields: ReadonlyArray<TableViewField> = []
) {
  const kinds = new Map(fields.map((field) => [field.id, field.kind]))
  const activeFilters = view.filters.filter(
    (filter) => filter.field.length > 0 && isActiveTableFilter(filter)
  )
  function globalFilterFn<F extends TableFeatures>(row: Row<F, T>, id: string) {
    // The shared table-filter interpreter decides; this only maps local values
    // onto its text or number operands. Dates compare as calendar days in the
    // presentation zone, or as instants for a full timestamp.
    function test(filter: TableView['filters'][number]) {
      const actual = getValue(row.original, filter.field)
      const kind = comparisonKind(actual, filter.value, kinds.get(filter.field))
      if (kind === 'text') {
        return tableFilterMatches(filter, 'text', valueAsText(actual), localeFold)
      }
      if (kind === 'number') {
        return tableFilterMatches(filter, 'number', finiteNumber(actual), localeFold)
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(filter.value)) {
        return tableFilterMatches(
          filter,
          'text',
          comparable(actual, kind, true),
          localeFold
        )
      }
      return tableFilterMatches(
        { ...filter, value: String(comparable(filter.value, kind)) },
        'number',
        finiteNumber(comparable(actual, kind)),
        localeFold
      )
    }
    const matchesGroup =
      activeFilters.length === 0 ||
      (view.match === 'any' ? activeFilters.some(test) : activeFilters.every(test))
    const searchValue = row.getValue<TableValue>(id)
    return (
      matchesGroup &&
      (!view.query ||
        ((typeof searchValue === 'string' || typeof searchValue === 'number') &&
          includesText(localeFold(String(searchValue)), localeFold(view.query))))
    )
  }
  function sortFn<F extends TableFeatures>(a: Row<F, T>, b: Row<F, T>, id: string) {
    const aValue = getValue(a.original, id)
    const bValue = getValue(b.original, id)
    const kind = comparisonKind(aValue, bValue, kinds.get(id))
    const left = comparable(aValue, kind)
    const right = comparable(bValue, kind)
    if (left === undefined || right === undefined) {
      return Number(left === undefined) - Number(right === undefined)
    }
    return Number.isNaN(left) || Number.isNaN(right) ? 0 : compareValue(left, right)
  }
  return {
    globalFilterFn,
    getColumnCanGlobalFilter: () => true,
    defaultColumn: { sortFn, sortUndefined: false as const },
    state: {
      globalFilter: view,
      sorting: view.sorts.map((sort) => ({
        id: sort.field,
        desc: sort.direction === 'desc'
      }))
    }
  }
}

export function applyTableView<T extends RowData>(
  rows: ReadonlyArray<T>,
  view: TableView,
  getValue: (row: T, field: string) => TableValue,
  fields: ReadonlyArray<TableViewField> = [],
  searchText?: (row: T) => string
): Array<T> {
  const table = constructTable({
    features: {
      ...tableViewFeatures,
      coreReactivityFeature: storeReactivityBindings()
    },
    data: rows,
    ...tableViewOptions(
      { ...view, query: searchText ? (view.query?.trim() ?? '') : '' },
      getValue,
      fields
    ),
    columns: [
      { id: '__search', accessorFn: (row: T) => searchText?.(row) ?? '' },
      ...view.sorts.map(({ field }) => ({
        id: field,
        accessorFn: (row: T) => getValue(row, field),
        enableGlobalFilter: false
      }))
    ]
  })
  return table.getSortedRowModel().rows.map((row) => row.original)
}
/* oxlint-enable anti-slop/no-runtime-typeof */
