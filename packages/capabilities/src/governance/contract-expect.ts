/**
 * The slice of vitest's `expect` every contract file draws from. One type, so
 * a shared case can only reach for matchers every contract promises across
 * adapters — a case that wants more is usually asserting something only one
 * adapter can honestly deliver.
 */
export type ContractExpect = <A>(actual: A) => {
  readonly toBe: (expected: A) => void
  readonly toEqual: (expected: A) => void
  readonly toHaveLength: (expected: number) => void
  readonly toContain: (expected: A) => void
  /**
   * Partial match for "the fields I care about on a row I just looked up" —
   * including a row an array `find` may not have found, which this reports as
   * a null/undefined actual with a diff rather than a coerced `false`.
   */
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- vitest's own signature: any partial of the actual. Narrowing it would force `value !== undefined && {…}` coercions back at every call site.
  readonly toMatchObject: (expected: Record<string, unknown>) => void
}
