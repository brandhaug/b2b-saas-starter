import { presentationSettings } from './i18n'

/* oxlint-disable effect/noAs -- the readonly literal tuple is the public operator contract. */
export const tableFilterOperators = [
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
] as const
/* oxlint-enable effect/noAs */

export type TableFilterOperator = (typeof tableFilterOperators)[number]
export type TableViewMatch = 'all' | 'any'

export type TableViewField = {
  readonly id: string
  readonly label: string
  readonly kind: 'text' | 'select' | 'date' | 'number'
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>
}

export type TableView = {
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
const operatorSet = new Set<string>(tableFilterOperators)

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- operator input was parsed from the JSON boundary below. */
function isTableFilterOperator(value: unknown): value is TableFilterOperator {
  return typeof value === 'string' && operatorSet.has(value)
}
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- sort direction is narrowed by the predicate.
function isSortDirection(value: unknown): value is 'asc' | 'desc' {
  return value === 'asc' || value === 'desc'
}

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, effect/noTryCatch -- JSON URL payload is intentionally narrowed at this browser boundary. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512) {
    return undefined
  }
  return value
}

export function parseTableView(
  serialized: string | undefined,
  fields: ReadonlyArray<TableViewField>
): TableView {
  if (!serialized || serialized.length > MAX_INPUT_LENGTH) {
    return defaultTableView
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(serialized)
  } catch {
    return defaultTableView
  }
  if (!isRecord(decoded)) {
    return defaultTableView
  }
  const fieldIds = new Set(fields.map((field) => field.id))
  const parsedFilters = Array.isArray(decoded.filters)
    ? decoded.filters.slice(0, MAX_ITEMS).flatMap((candidate) => {
        if (!isRecord(candidate)) {
          return []
        }
        const field = candidate.field
        const operator = candidate.operator
        const value = normalizeValue(candidate.value)
        const fieldSpec =
          typeof field === 'string'
            ? fields.find((item) => item.id === field)
            : undefined
        const validOption =
          fieldSpec?.kind !== 'select' ||
          value === '' ||
          fieldSpec.options?.some((option) => option.value === value)
        const validOperator = validOperatorForField(fieldSpec, operator)
        const validValue = validValueForField(fieldSpec, value ?? '')
        if (
          typeof field !== 'string' ||
          !fieldIds.has(field) ||
          typeof operator !== 'string' ||
          !isTableFilterOperator(operator) ||
          value === undefined ||
          !validOption ||
          !validOperator ||
          !validValue
        ) {
          return []
        }
        return [{ field, operator, value }]
      })
    : []
  const seenFilterFields = new Set<string>()
  const filters = parsedFilters.filter((filter) => {
    if (seenFilterFields.has(filter.field)) {
      return false
    }
    seenFilterFields.add(filter.field)
    return true
  })
  const parsedSorts = Array.isArray(decoded.sorts)
    ? decoded.sorts.slice(0, MAX_ITEMS).flatMap((candidate) => {
        if (!isRecord(candidate)) {
          return []
        }
        const field = candidate.field
        const direction = candidate.direction
        if (
          typeof field !== 'string' ||
          !fieldIds.has(field) ||
          !isSortDirection(direction)
        ) {
          return []
        }
        return [{ field, direction }]
      })
    : []
  const seenSortFields = new Set<string>()
  const sorts = parsedSorts.filter((sort) => {
    if (seenSortFields.has(sort.field)) {
      return false
    }
    seenSortFields.add(sort.field)
    return true
  })
  return {
    match: decoded.match === 'any' ? 'any' : 'all',
    filters,
    sorts
  }
}

export function serializeTableView(view: TableView): string | undefined {
  if (view.filters.length === 0 && view.sorts.length === 0 && view.match === 'all') {
    return undefined
  }
  return JSON.stringify({
    match: view.match,
    filters: view.filters.slice(0, MAX_ITEMS),
    sorts: view.sorts.slice(0, MAX_ITEMS)
  })
}
export function operatorsForTableField(
  field: TableViewField
): ReadonlyArray<TableFilterOperator> {
  switch (field.kind) {
    case 'date': {
      return ['is', 'isNot', 'before', 'after', 'isEmpty', 'isNotEmpty']
    }
    case 'number': {
      return ['is', 'isNot', 'gt', 'lt', 'isEmpty', 'isNotEmpty']
    }
    case 'select': {
      return ['is', 'isNot', 'isEmpty', 'isNotEmpty']
    }
    case 'text': {
      return ['contains', 'notContains', 'is', 'isNot', 'isEmpty', 'isNotEmpty']
    }
  }
}

function validOperatorForField(
  field: TableViewField | undefined,
  operator: unknown
): boolean {
  return (
    field !== undefined &&
    isTableFilterOperator(operator) &&
    operatorsForTableField(field).includes(operator)
  )
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
function valueAsText(
  value: string | number | boolean | Date | null | undefined
): string {
  if (value === null || value === undefined) {
    return ''
  }
  return value instanceof Date ? value.toISOString() : String(value)
}

const calendarFormatters = new Map<string, Intl.DateTimeFormat>()

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

function compareValues(
  left: string | number | boolean | Date | null | undefined,
  right: string,
  field: TableViewField | undefined
): number | undefined {
  if (left === null || left === undefined || right.length === 0) {
    return undefined
  }
  if (field?.kind === 'number' || typeof left === 'number') {
    const leftNumber = typeof left === 'number' ? left : Number(left)
    const rightNumber = Number(right)
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : undefined
  }
  if (
    field?.kind === 'date' ||
    left instanceof Date ||
    (typeof left === 'string' &&
      /^\d{4}-\d{2}-\d{2}/.test(left) &&
      /^\d{4}-\d{2}-\d{2}/.test(right))
  ) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(right)) {
      const leftDay = calendarDay(left instanceof Date ? left : String(left))
      if (leftDay === undefined) {
        return undefined
      }
      if (leftDay < right) {
        return -1
      }
      if (leftDay > right) {
        return 1
      }
      return 0
    }
    const leftTime = left instanceof Date ? left.getTime() : Date.parse(String(left))
    const rightTime = Date.parse(right)
    return Number.isFinite(leftTime) && Number.isFinite(rightTime)
      ? leftTime - rightTime
      : undefined
  }
  const leftText = valueAsText(left).toLocaleLowerCase()
  const rightText = right.toLocaleLowerCase()
  if (leftText < rightText) {
    return -1
  }
  if (leftText > rightText) {
    return 1
  }
  return 0
}
/* oxlint-enable unicorn/no-instanceof-builtins */

function matches(
  actual: string | number | boolean | Date | null | undefined,
  filter: TableView['filters'][number],
  field: TableViewField | undefined
): boolean {
  const text = valueAsText(actual)
  if (filter.operator === 'isEmpty') {
    return text.trim().length === 0
  }
  if (filter.operator === 'isNotEmpty') {
    return text.trim().length > 0
  }
  if (filter.value.trim().length === 0) {
    return true
  }
  if (actual === null || actual === undefined) {
    return filter.operator === 'isNot'
  }
  const comparison = compareValues(actual, filter.value, field)
  if (comparison === undefined) {
    return false
  }
  switch (filter.operator) {
    case 'contains': {
      return text.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())
    }
    case 'notContains': {
      return !text.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())
    }
    case 'is': {
      return comparison === 0
    }
    case 'isNot': {
      return comparison !== 0
    }
    case 'before': {
      return comparison < 0
    }
    case 'after': {
      return comparison > 0
    }
    case 'gt': {
      return comparison > 0
    }
    case 'lt': {
      return comparison < 0
    }
  }
}

export function applyTableView<T>(
  rows: ReadonlyArray<T>,
  view: TableView,
  getValue: (
    row: T,
    field: string
  ) => string | number | boolean | Date | null | undefined
): Array<T> {
  const activeFilters = view.filters.filter(
    (filter) =>
      filter.field.length > 0 &&
      (filter.operator === 'isEmpty' ||
        filter.operator === 'isNotEmpty' ||
        filter.value.trim().length > 0)
  )
  const filtered = rows.filter((row) => {
    if (activeFilters.length === 0) {
      return true
    }
    const results = activeFilters.map((filter) =>
      matches(getValue(row, filter.field), filter, undefined)
    )
    return view.match === 'any' ? results.some(Boolean) : results.every(Boolean)
  })
  return filtered
    .map((row, index) => ({ row, index }))
    .toSorted((left, right) => {
      for (const sort of view.sorts) {
        const leftValue = getValue(left.row, sort.field)
        const rightValue = getValue(right.row, sort.field)
        const comparison = compareSortValues(leftValue, rightValue, undefined)
        if (comparison !== 0) {
          return sort.direction === 'asc' ? comparison : -comparison
        }
      }
      return left.index - right.index
    })
    .map(({ row }) => row)
}

function compareSortValues(
  left: string | number | boolean | Date | null | undefined,
  right: string | number | boolean | Date | null | undefined,
  field: TableViewField | undefined
): number {
  const leftEmpty = left === null || left === undefined
  const rightEmpty = right === null || right === undefined
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) {
      return 0
    }
    return leftEmpty ? 1 : -1
  }
  return compareValues(left, valueAsText(right), field) ?? 0
}
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */
