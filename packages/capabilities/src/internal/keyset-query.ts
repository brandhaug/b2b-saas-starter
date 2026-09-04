import { and, eq, gt, lt, or, type Column, type SQL } from 'drizzle-orm'

import { decodeKeysetCursor, type KeysetOrder } from './keyset-cursor.ts'

/**
 * The SQL half of the paging recipe (ADR 0057) — how one paged D1 read
 * resumes from the request's cursor. Every Live adapter asks this module the
 * same question and gets one of three answers, so the "strictly past the
 * position" predicate (and its `(key, id)` tie-break) is written once, not
 * once per capability.
 */

/** The column pair a paged read orders and resumes on. */
export type KeysetColumns = {
  /** The sort key — `createdAt` for timestamped lists, `id` otherwise. */
  readonly key: Column
  /** The tie-break — always the row id. */
  readonly id: Column
}

/**
 * How a read resumes:
 *
 * - `first` — no cursor on the request; serve the list's head.
 * - `resume` — a decodable cursor; the condition selects rows strictly past
 *   its position in the list's order. ISO timestamps compare
 *   lexicographically, so plain column comparison is correct.
 * - `empty` — an undecodable cursor addresses no position; the caller serves
 *   an empty page rather than failing, exactly as the Seed adapters do.
 */
export type KeysetResume =
  | { readonly kind: 'first' }
  | { readonly kind: 'resume'; readonly condition: SQL }
  | { readonly kind: 'empty' }

export function keysetResume(
  order: KeysetOrder,
  columns: KeysetColumns,
  cursor: string | undefined
): KeysetResume {
  if (cursor === undefined) {
    return { kind: 'first' }
  }
  const position = decodeKeysetCursor(cursor)
  if (position === null) {
    return { kind: 'empty' }
  }
  const { key, id } = columns
  let condition: SQL | undefined
  if (order === 'desc') {
    condition = or(
      lt(key, position.key),
      and(eq(key, position.key), lt(id, position.id))
    )
  } else {
    condition = or(
      gt(key, position.key),
      and(eq(key, position.key), gt(id, position.id))
    )
  }
  // drizzle types `or` as optional even though both operands above are
  // defined conditions, so the first branch never runs.
  if (condition === undefined) {
    return { kind: 'first' }
  }
  return { kind: 'resume', condition }
}
