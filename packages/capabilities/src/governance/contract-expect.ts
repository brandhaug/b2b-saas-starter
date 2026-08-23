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
}
