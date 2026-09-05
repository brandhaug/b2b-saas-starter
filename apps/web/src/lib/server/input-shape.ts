// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noNewError, effect/noThrowStatement, unicorn/prefer-type-error
/**
 * Plain shape-check probes for server-fn validators in the client-safe
 * `lib/server/*.ts` modules.
 *
 * A module-level `Schema.Struct` in one of those files would drag the Effect
 * Schema chunk onto the route tree, which ships to the browser on every page.
 * TanStack strips `.validator()` from the client build, so the validator runs
 * server-side only and can stay a plain shape check — the server's first
 * decode — while the strict schema decodes again in the sibling
 * `.effects.ts` before anything runs (see `invitations.ts` for the reference
 * split and the rationale, and AGENTS.md for the rule).
 *
 * These probes ARE the I/O boundary, so `unknown` in and `throw` out is the
 * contract, the same exemption `pickOptionalStrings` carries (lib/utils.ts).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

export function expectString(
  record: Record<string, unknown>,
  key: string,
  label: string
): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${label}: ${key}`)
  }
  return value
}

export function expectOptionalString(
  record: Record<string, unknown>,
  key: string,
  label: string
): string | undefined {
  const value = record[key]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${label}: ${key}`)
  }
  return value
}
