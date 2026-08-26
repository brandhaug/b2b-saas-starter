/**
 * The full matcher surface the governance contracts draw from. Each contract
 * file narrows this down on purpose with a `Pick`, so its cases can only
 * reach for matchers the contract actually promises across adapters.
 */
export type ContractExpectMatchers<A> = {
  readonly toBe: (expected: A) => void
  readonly toEqual: (expected: A) => void
  readonly toHaveLength: (expected: number) => void
  readonly toContain: (expected: A) => void
  /**
   * Subset assertion for structured results (audit events, delivery rows):
   * only the named fields must match, so a case stays honest about which
   * columns both adapters can promise.
   */
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- vitest's toMatchObject takes an arbitrary field subset; a concrete owner type would lie about which fields a case may assert
  readonly toMatchObject: (expected: Record<string, unknown>) => void
}

/**
 * The narrowed entry point each contract file takes: one `expect` that may
 * only produce the matchers the contract promises across adapters.
 */
export type ContractExpect = <A>(actual: A) => Pick<ContractExpectMatchers<A>, 'toBe'>
