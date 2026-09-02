import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}

/**
 * Only allow same-origin path redirects (prevents open redirects via the
 * `?redirect=` search param on /sign-in). Anything that is not a plain
 * absolute path falls back to /workspaces.
 */
export function safeRedirect(raw: string | undefined): string {
  return raw?.startsWith('/') && !raw.startsWith('//') ? raw : '/workspaces'
}

/**
 * A search param shape of nothing but optional strings — the whole vocabulary
 * the auth-flow routes need (`?redirect=`, `?token=`, `?error=`). This is a
 * five-line narrowing instead of an `effect/Schema` decode on purpose: these
 * validators are module-level imports of every route file, and the route tree
 * ships statically to the browser, so an effect import here would pin the
 * Effect runtime onto pages (sign-in, sign-up) that never run a capability.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening, effect/noAs, anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
// TanStack Router hands `validateSearch` an untyped search record at this
// module's boundary — the parse step for that boundary lives here and only
// here. The `as` states the boundary contract: router search records are
// string-keyed objects; anything else falls through to an empty result.
export function pickOptionalStrings(
  search: unknown,
  keys: ReadonlyArray<string>
): Record<string, string | undefined> {
  const picked: Record<string, string | undefined> = {}
  if (typeof search !== 'object' || search === null) {
    return picked
  }
  const record = search as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      picked[key] = value
    }
  }
  return picked
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening, effect/noAs, anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion

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
