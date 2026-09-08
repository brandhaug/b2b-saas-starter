/* oxlint-disable effect/noAsyncFunction, effect/noGlobals -- Better Auth invokes this persistence adapter outside Effect. */
import { verification } from '@b2b-saas-starter/db/schema'
import { lte } from 'drizzle-orm'
import { type AuthConfigInterface } from './ports.ts'

/** Better Auth accepts the previous, current and next thirty-second code.
 * Retain a consumed code for its entire possible acceptance window. */
const CODE_ACCEPTANCE_WINDOW_MS = 90_000

export async function consumeTotpCode(
  options: AuthConfigInterface,
  factorId: string,
  code: string,
  now: Date
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${factorId}:${code}`)
  )
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  const id = `totp-used:${hash}`
  const expiresAt = new Date(now.getTime() + CODE_ACCEPTANCE_WINDOW_MS)
  // The primary-key conflict is the cross-session and cross-Worker lock.
  // Expired entries may be reused; ordinary verification retention removes them.
  const claimed = await options.db
    .insert(verification)
    .values({
      id,
      identifier: id,
      value: 'consumed',
      expiresAt,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: verification.id,
      set: { expiresAt, updatedAt: now },
      setWhere: lte(verification.expiresAt, now)
    })
    .returning({ id: verification.id })
  return claimed.length === 1
}
