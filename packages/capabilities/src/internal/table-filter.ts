import { Schema } from 'effect'

/**
 * The filter vocabulary every table view speaks — the audit log and global
 * deliveries views here, and the web app's in-memory tables — and the one
 * semantics both backends implement. Client-safe: the web app imports it.
 *
 * - `isEmpty` / `isNotEmpty` test presence and ignore the value. Absent and
 *   `''` are empty.
 * - Text `contains` and `is` fold case with the backend's `TextFold`: D1's
 *   `lower()` folds ASCII only, so Live and Seed pass `asciiFold` to agree row
 *   for row; the web app's tables pass the fold their quick search uses.
 * - `notContains` and `isNot` are exact complements, so an empty value
 *   matches them.
 * - `before`/`lt` and `after`/`gt` are synonyms. Ordering compares raw values
 *   (ISO timestamps compare lexicographically) and never matches an empty
 *   value.
 * - `is` / `isNot` with an `endValue` test the inclusive range
 *   `[value, endValue]`. Text ranges and text ordering are case-sensitive.
 * - On a number field, a value that is not a finite number matches no row
 *   under every value-bearing operator, negations included, and `contains`
 *   has no numeric meaning.
 *
 * Callers drop inactive conditions (`isActiveTableFilter`) before planning:
 * a blank draft must not widen an `any` match.
 */
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
export const TableFilterOperator = Schema.Literals(tableFilterOperators)
export type TableFilterOperator = typeof TableFilterOperator.Type

/** The operators a table field offers, by how the field presents its value. */
export const tableFieldOperators = {
  text: ['contains', 'notContains', 'is', 'isNot', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  date: ['is', 'isNot', 'before', 'after', 'isEmpty', 'isNotEmpty'],
  number: ['is', 'isNot', 'gt', 'lt', 'isEmpty', 'isNotEmpty']
} as const satisfies Record<string, ReadonlyArray<TableFilterOperator>>
export type TableFieldKind = keyof typeof tableFieldOperators

/** How a backend reads the stored value: text, or a number column. */
export type TableFilterOperandKind = 'text' | 'number'

export type TableFilterCondition = {
  readonly operator: TableFilterOperator
  readonly value: string
  readonly endValue?: string | undefined
}

export function isActiveTableFilter(condition: TableFilterCondition): boolean {
  return (
    condition.operator === 'isEmpty' ||
    condition.operator === 'isNotEmpty' ||
    condition.value.trim().length > 0
  )
}

export type TableFilterOperand =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }

/**
 * A condition after its value has been validated and folded once. Each
 * backend interprets these shapes — `tableFilterMatches` in memory,
 * `tableFilterSql` (`table-filter-query.ts`) in D1 — and nothing else.
 */
export type TableFilterPlan =
  | { readonly test: 'never' }
  | { readonly test: 'empty'; readonly negated: boolean }
  | { readonly test: 'contains'; readonly needle: string; readonly negated: boolean }
  | {
      readonly test: 'equals'
      readonly operand: TableFilterOperand
      readonly negated: boolean
    }
  | {
      readonly test: 'between'
      readonly start: TableFilterOperand
      readonly end: TableFilterOperand
      readonly negated: boolean
    }
  | { readonly test: 'below' | 'above'; readonly operand: TableFilterOperand }

/** Folds text case for `contains` and `is`; applied to the needle and the value. */
export type TextFold = (text: string) => string

/** ASCII-only, matching SQLite's built-in `lower()`. */
export function asciiFold(text: string): string {
  return text.replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase())
}

type Planner = (
  condition: TableFilterCondition,
  kind: TableFilterOperandKind,
  fold: TextFold
) => TableFilterPlan

const never: TableFilterPlan = { test: 'never' }

const operatorPlans = {
  isEmpty: () => ({ test: 'empty', negated: false }),
  isNotEmpty: () => ({ test: 'empty', negated: true }),
  contains: (condition, kind, fold) => containsPlan(condition, kind, fold, false),
  notContains: (condition, kind, fold) => containsPlan(condition, kind, fold, true),
  is: (condition, kind, fold) => equalsPlan(condition, kind, fold, false),
  isNot: (condition, kind, fold) => equalsPlan(condition, kind, fold, true),
  before: (condition, kind) => orderPlan(condition, kind, 'below'),
  lt: (condition, kind) => orderPlan(condition, kind, 'below'),
  after: (condition, kind) => orderPlan(condition, kind, 'above'),
  gt: (condition, kind) => orderPlan(condition, kind, 'above')
} satisfies Record<TableFilterOperator, Planner>

export function planTableFilter(
  condition: TableFilterCondition,
  kind: TableFilterOperandKind,
  fold: TextFold
): TableFilterPlan {
  return operatorPlans[condition.operator](condition, kind, fold)
}

/**
 * The in-memory interpreter: Seed adapters pass `asciiFold`, the web app's
 * tables their quick-search fold.
 */
export function tableFilterMatches(
  condition: TableFilterCondition,
  kind: TableFilterOperandKind,
  actual: string | number | null | undefined,
  fold: TextFold
): boolean {
  const plan = planTableFilter(condition, kind, fold)
  switch (plan.test) {
    case 'never': {
      return false
    }
    case 'empty': {
      return isEmpty(actual) !== plan.negated
    }
    case 'contains': {
      return fold(String(actual ?? '')).includes(plan.needle) !== plan.negated
    }
    case 'equals': {
      if (plan.operand.kind === 'number') {
        return (compare(actual, plan.operand) === 0) !== plan.negated
      }
      return (compare(foldText(actual, fold), plan.operand) === 0) !== plan.negated
    }
    case 'between': {
      const inside =
        (compare(actual, plan.start) ?? -1) >= 0 &&
        (compare(actual, plan.end) ?? 1) <= 0
      return inside !== plan.negated
    }
    case 'below': {
      return compare(actual, plan.operand) === -1
    }
    case 'above': {
      return compare(actual, plan.operand) === 1
    }
  }
}

function operand(
  value: string,
  kind: TableFilterOperandKind
): TableFilterOperand | undefined {
  if (kind === 'text') {
    return { kind, value }
  }
  const number = Number(value)
  if (value.trim() === '' || !Number.isFinite(number)) {
    return undefined
  }
  return { kind, value: number }
}

function containsPlan(
  condition: TableFilterCondition,
  kind: TableFilterOperandKind,
  fold: TextFold,
  negated: boolean
): TableFilterPlan {
  if (kind === 'number') {
    return never
  }
  return { test: 'contains', needle: fold(condition.value), negated }
}

function equalsPlan(
  condition: TableFilterCondition,
  kind: TableFilterOperandKind,
  fold: TextFold,
  negated: boolean
): TableFilterPlan {
  const start = operand(condition.value, kind)
  if (start === undefined) {
    return never
  }
  if (condition.endValue === undefined || condition.endValue.trim() === '') {
    if (start.kind === 'text') {
      return {
        test: 'equals',
        operand: { kind: 'text', value: fold(start.value) },
        negated
      }
    }
    return { test: 'equals', operand: start, negated }
  }
  const end = operand(condition.endValue, kind)
  if (end === undefined) {
    return never
  }
  return { test: 'between', start, end, negated }
}

function orderPlan(
  condition: TableFilterCondition,
  kind: TableFilterOperandKind,
  test: 'below' | 'above'
): TableFilterPlan {
  const value = operand(condition.value, kind)
  if (value === undefined) {
    return never
  }
  return { test, operand: value }
}

function isEmpty(actual: string | number | null | undefined): boolean {
  return actual === null || actual === undefined || actual === ''
}

function foldText(
  actual: string | number | null | undefined,
  fold: TextFold
): string | undefined {
  if (isEmpty(actual)) {
    return undefined
  }
  return fold(String(actual))
}

/** Undefined when the actual value cannot be compared: empty, or not a number. */
function compare(
  actual: string | number | null | undefined,
  against: TableFilterOperand
): -1 | 0 | 1 | undefined {
  if (actual === null || actual === undefined || actual === '') {
    return undefined
  }
  if (against.kind === 'number') {
    const number = Number(actual)
    if (!Number.isFinite(number)) {
      return undefined
    }
    return order(number, against.value)
  }
  return order(String(actual), against.value)
}

function order<A extends string | number>(left: A, right: A): -1 | 0 | 1 {
  if (left === right) {
    return 0
  }
  if (left < right) {
    return -1
  }
  return 1
}
