import { Option, Schema } from 'effect'
export { cn } from 'cn'

/**
 * Only allow same-origin path redirects (prevents open redirects via the
 * `?redirect=` search param on /sign-in). Anything that is not a plain
 * absolute path falls back to /workspaces.
 *
 * The second character decides it: a `/` makes the value protocol-relative
 * (`//evil.example`), and a `\` is the same thing to every browser, which
 * normalizes backslashes in the authority position — `/\evil.example` is
 * `//evil.example`. Both are off-origin, so both fall back.
 */
export function safeRedirect(raw: string | undefined): string {
  if (raw === undefined || !raw.startsWith('/')) {
    return '/workspaces'
  }
  const second = raw[1]
  return second === '/' || second === '\\' ? '/workspaces' : raw
}

const decodeSearchRecord = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Unknown)
)
const isString = Schema.is(Schema.String)
type OptionalStrings = Record<string, string | undefined>

/** Keep valid string fields independently; one malformed field does not erase its siblings. */
// oxlint-disable anti-slop/no-known-value-widening -- caller-supplied key lists define this boundary's dictionary contract
export function pickOptionalStrings(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TanStack Router and config fetches provide untrusted input at this decode boundary
  search: unknown,
  keys: ReadonlyArray<string>
): OptionalStrings {
  const picked: OptionalStrings = {}
  const decoded = decodeSearchRecord(search)
  if (Option.isNone(decoded)) {
    return picked
  }
  for (const key of keys) {
    const value = decoded.value[key]
    if (isString(value)) {
      picked[key] = value
    }
  }
  return picked
}
// oxlint-enable anti-slop/no-known-value-widening

/**
 * The `?redirect=` search param the auth flow routes (sign-in, sign-up,
 * two-factor) carry through their hops. Kept beside `safeRedirect` so the
 * accepted shape and the fallback stay one decision.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- see pickOptionalStrings: the router's search record is untyped at this boundary
export function redirectSearch(search: unknown): {
  redirect?: string | undefined
} {
  return pickOptionalStrings(search, ['redirect'])
}
