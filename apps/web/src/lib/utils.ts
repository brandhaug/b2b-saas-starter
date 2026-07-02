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
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/workspaces'
}
