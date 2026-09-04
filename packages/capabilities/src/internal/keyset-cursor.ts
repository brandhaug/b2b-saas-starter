import { Effect, Encoding, Result } from 'effect'

/**
 * The one keyset-cursor codec every paged list read shares — capabilities
 * (Seed and Live), the web app's audit page, the REST contract, and the MCP
 * tools all hand the same opaque string back and forth (ADR 0057).
 *
 * A cursor addresses a *position*, not an offset: the sort key of the last
 * item on a page plus its id as the tie-break, base64-encoded as
 * `"<key> <id>"`. Rows inserted between two page fetches never shift,
 * duplicate, or hide rows the caller has not yet seen — that stability is
 * why offset pagination was rejected.
 *
 * The cursor carries no signature and is opaque to clients. An undecodable
 * cursor addresses no position and yields an empty page rather than an
 * error, because a nonsense position holds nothing.
 */

/** One bounded slice of a list read; `nextCursor` is null on the last page. */
export type Page<T> = {
  readonly items: ReadonlyArray<T>
  readonly nextCursor: string | null
}

/** What a paged list read accepts: continue after a cursor, take fewer rows. */
export type ListPageInput = {
  /**
   * Opaque keyset cursor from a previous page's `nextCursor`. `| undefined`
   * on purpose: MCP tool args carry optional keys, and both adapters treat
   * an absent key and an explicit `undefined` the same way.
   */
  readonly cursor?: string | undefined
  /** Page size; clamped to [1, {@link MAX_PAGE_LIMIT}]. */
  readonly limit?: number | undefined
}

/** The page size every paged read serves when the caller names none. */
export const DEFAULT_PAGE_LIMIT = 50

/** The largest page any paged read will serve, whatever the caller asks. */
export const MAX_PAGE_LIMIT = 200

export function clampPageLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_PAGE_LIMIT
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_LIMIT)
}

/** A cursor's position: the sort key plus the id that breaks its ties. */
export type KeysetCursorPosition = {
  readonly key: string
  readonly id: string
}

export function encodeKeysetCursor(position: KeysetCursorPosition): string {
  return Encoding.encodeBase64(`${position.key} ${position.id}`)
}

/**
 * `null` for a cursor that addresses no position — the caller serves an
 * empty page rather than failing, because a malformed cursor is not an error
 * any list contract knows how to name.
 */
export function decodeKeysetCursor(cursor: string): KeysetCursorPosition | null {
  const decoded = Encoding.decodeBase64String(cursor)
  if (Result.isFailure(decoded)) {
    return null
  }
  const separator = decoded.success.indexOf(' ')
  // The first space separates key from id — an id may itself contain none,
  // but a payload with no separator (or an empty half) is no position.
  if (separator <= 0 || separator >= decoded.success.length - 1) {
    return null
  }
  return {
    key: decoded.success.slice(0, separator),
    id: decoded.success.slice(separator + 1)
  }
}

/**
 * The direction a list is ordered in. `'desc'` reads newest-first
 * (`(createdAt DESC, id DESC)`); `'asc'` reads forward (`id ASC`). A page
 * resumes *strictly past* the cursor in whichever direction the list runs.
 */
export type KeysetOrder = 'desc' | 'asc'

/** Whether `(key, id)` sits strictly after `position` in `order`. */
export function keysetIsAfter(
  order: KeysetOrder,
  position: KeysetCursorPosition,
  key: string,
  id: string
): boolean {
  if (order === 'desc') {
    return key < position.key || (key === position.key && id < position.id)
  }
  return key > position.key || (key === position.key && id > position.id)
}

/**
 * The in-memory half of the paging recipe for Seed adapters (and any caller
 * holding already-filtered rows): drops the rows at or before the cursor,
 * sorts what remains in the list's order, and cuts one page off the front.
 * `rows` are the *filtered* collection — workspace, actor, and any
 * domain filters stay the caller's job.
 */
export function seedKeysetPage<T>(
  rows: ReadonlyArray<T>,
  order: KeysetOrder,
  positionOf: (row: T) => KeysetCursorPosition,
  input: ListPageInput | undefined
): Page<T> {
  const limit = clampPageLimit(input?.limit)
  // `undefined` = first page, `null` = undecodable (no position, empty page).
  let position: KeysetCursorPosition | null | undefined
  if (input?.cursor === undefined) {
    position = undefined
  } else {
    position = decodeKeysetCursor(input.cursor)
  }
  if (position === null) {
    return { items: [], nextCursor: null }
  }
  let remaining: ReadonlyArray<T> = rows
  if (position !== undefined) {
    remaining = rows.filter((row) => {
      const at = positionOf(row)
      return keysetIsAfter(order, position, at.key, at.id)
    })
  }
  const ordered = remaining.toSorted(keysetComparator(order, positionOf))
  return cutKeysetPage(ordered, limit, positionOf)
}

/** `(key, id)` comparison in the list's order — the sort behind every page. */
export function keysetComparator<T>(
  order: KeysetOrder,
  positionOf: (row: T) => KeysetCursorPosition
): (a: T, b: T) => number {
  let direction = 1
  if (order === 'desc') {
    direction = -1
  }
  return (a, b) => {
    const pa = positionOf(a)
    const pb = positionOf(b)
    if (pa.key !== pb.key) {
      if (pa.key < pb.key) {
        return -direction
      }
      return direction
    }
    if (pa.id !== pb.id) {
      if (pa.id < pb.id) {
        return -direction
      }
      return direction
    }
    return 0
  }
}

/**
 * Cuts one page off rows that are already ordered, emitting `nextCursor`
 * only when the limit actually cut rows off — never for an exact multiple,
 * whose next page would be empty. Live adapters fetch `limit + 1` rows so
 * the same rule decides from real data instead of a second count.
 */
export function cutKeysetPage<T>(
  orderedRows: ReadonlyArray<T>,
  limit: number,
  positionOf: (row: T) => KeysetCursorPosition
): Page<T> {
  const items = orderedRows.slice(0, limit)
  const last = items.at(-1)
  let nextCursor: string | null = null
  if (orderedRows.length > limit && last !== undefined) {
    nextCursor = encodeKeysetCursor(positionOf(last))
  }
  return { items, nextCursor }
}

/**
 * The consumer half of the paging recipe: walks a paged read cursor-to-end
 * and collects every item, following `nextCursor` until the server says the
 * list is exhausted. Contract tests assert over `items` (a truncated walk
 * fails their coverage assertions); wire-level tests also assert `exhausted`
 * to prove the cursor chain itself terminated. `maxPages` is the runaway
 * guard, not part of the contract — a cursor that never reaches `null`
 * stops the walk with `exhausted: false`.
 */
export function walkKeysetPages<A, E, R>(
  fetchPage: (input: ListPageInput) => Effect.Effect<Page<A>, E, R>,
  options?: {
    /** Page size handed to every fetch; omitted means the read's default. */
    readonly limit?: number
    /** Ceiling on fetches; the default bounds a walk well past any real list. */
    readonly maxPages?: number
  }
): Effect.Effect<{ readonly items: Array<A>; readonly exhausted: boolean }, E, R> {
  const maxPages = options?.maxPages ?? 25
  return Effect.gen(function* () {
    const items: Array<A> = []
    let cursor: string | undefined
    let exhausted = false
    for (let page = 0; page < maxPages; page += 1) {
      const result: Page<A> = yield* fetchPage({
        limit: options?.limit,
        cursor
      })
      for (const item of result.items) {
        items.push(item)
      }
      if (result.nextCursor === null) {
        exhausted = true
        break
      }
      cursor = result.nextCursor
    }
    return { items, exhausted }
  })
}
