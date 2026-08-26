import { Schema } from 'effect'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
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
 * The `?redirect=` search param the auth flow routes (sign-in, sign-up,
 * two-factor) carry through their hops. Single-sourced here so the schema and
 * `safeRedirect`'s fallback stay one decision.
 */
export const redirectSearchSchema = Schema.Struct({
  redirect: Schema.optional(Schema.String)
})

const decodeRedirectSearch = Schema.decodeUnknownSync(redirectSearchSchema)

/** The `validateSearch` implementation for routes carrying `?redirect=`. */
export const redirectSearch = decodeRedirectSearch
