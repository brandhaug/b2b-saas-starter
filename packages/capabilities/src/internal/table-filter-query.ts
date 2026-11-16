import { sql, type SQL } from 'drizzle-orm'

import {
  asciiFold,
  planTableFilter,
  type TableFilterCondition,
  type TableFilterOperand,
  type TableFilterOperandKind
} from './table-filter.ts'

/**
 * The SQL interpreter of `table-filter.ts`, shared by every Live adapter that
 * serves a table view. `column` is the raw stored value; nullable text is
 * coalesced to `''` here, so empty means the same thing it means in memory.
 * Text folds with `asciiFold` because `lower()` folds nothing else.
 *
 * Each condition binds at most two parameters (a range's two ends; every
 * other plan one or none), and `column` must bind none. D1 refuses a
 * statement with more than 100 bound parameters, so a view's schema caps its
 * filters and sorts to fit: global deliveries bind at most 2 x 32 filters,
 * 28 cursor values for 6 sorts and 4 of their own, pinned at the caps by
 * `webhook-delivery-view.contract.ts`.
 */
export function tableFilterSql(
  condition: TableFilterCondition,
  kind: TableFilterOperandKind,
  column: SQL
): SQL {
  const plan = planTableFilter(condition, kind, asciiFold)
  switch (plan.test) {
    case 'never': {
      return sql`0 = 1`
    }
    case 'empty': {
      return truth(sql`coalesce(${column}, '') = ''`, plan.negated)
    }
    case 'contains': {
      return truth(
        sql`instr(lower(coalesce(${column}, '')), ${plan.needle}) > 0`,
        plan.negated
      )
    }
    case 'equals': {
      if (plan.operand.kind === 'text') {
        return truth(
          sql`lower(coalesce(${column}, '')) = ${plan.operand.value}`,
          plan.negated
        )
      }
      return truth(sql`${column} = ${plan.operand.value}`, plan.negated)
    }
    case 'between': {
      const value = comparable(column, plan.start)
      return truth(
        sql`${value} >= ${plan.start.value} and ${value} <= ${plan.end.value}`,
        plan.negated
      )
    }
    case 'below': {
      return truth(
        sql`${comparable(column, plan.operand)} < ${plan.operand.value}`,
        false
      )
    }
    case 'above': {
      return truth(
        sql`${comparable(column, plan.operand)} > ${plan.operand.value}`,
        false
      )
    }
  }
}

/**
 * Ordering never matches an empty value: an empty text column becomes NULL,
 * and `truth` reads NULL as no match.
 */
function comparable(column: SQL, operand: TableFilterOperand): SQL {
  if (operand.kind === 'text') {
    return sql`nullif(coalesce(${column}, ''), '')`
  }
  return column
}

/** NULL-safe: a predicate over an absent value is false, its negation true. */
function truth(predicate: SQL, negated: boolean): SQL {
  if (negated) {
    return sql`not coalesce(${predicate}, 0)`
  }
  return sql`coalesce(${predicate}, 0)`
}
