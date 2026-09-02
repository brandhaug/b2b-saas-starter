/**
 * Preserves the literal element types of a string list without an `as const`
 * assertion, so an exported union can derive from the tuple itself.
 *
 * One idiom for every literal vocabulary in this package (the audit taxonomy,
 * the webhook event list): the values are written once, the union is
 * `(typeof TUPLE)[number]`, and no call site needs an `effect/noAs` lint
 * disable to say so. The stored enum vocabularies in `@b2b-saas-starter/db`'s
 * `enums.ts` keep their `as const`: that module is a dependency-free leaf the
 * schema, auth, and policy layers all read, and it imports nothing on purpose.
 */
export function literalTuple<T extends ReadonlyArray<string>>(...values: T): T {
  return values
}
