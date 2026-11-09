import { Context, type Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

export const PERSONAL_DATA_EXPORT_TTL_MS = 86_400_000

/**
 * The owner of the `personal_data_exports` lifecycle (ADR 0077). The table
 * has no status column to declare transitions over: an archive is born
 * ready — `request` renders it synchronously — and dies by `expires_at`,
 * one TTL later. The predicates below are that whole machine; both adapters
 * compute horizons and refusals through them.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - `personal_data_exports_expiry_idx` pages cleanup by `(expires_at, id)`
 *   (migration `20260909075657_petite_squadron_sinister`), and the
 *   `personal_data_exports` rule in `retention-rules.ts` scans the same
 *   clock.
 * - the cascading `user_id` and `session_id` foreign keys (same migration)
 *   delete an artifact with the account or session that asked for it;
 *   Live's download filter `expires_at > now` is the SQL mirror of
 *   {@link isExpiredPersonalDataExport}.
 * - the `assistant_workspace_suspension` trigger (migration
 *   `20260915114634_friendly_madame_hydra`) deletes a suspended workspace's
 *   conversation creators' artifacts on a committed suspension transition.
 */

/** The expiry a new archive is born with: one TTL past its request. */
export function personalDataExportExpiresAt(now: number): number {
  return now + PERSONAL_DATA_EXPORT_TTL_MS
}

/** Whether an artifact is past its expiry at `now` — the whole lifecycle decision. */
export function isExpiredPersonalDataExport(expiresAt: number, now: number): boolean {
  return expiresAt <= now
}

export const PersonalDataExportReceipt = Schema.Struct({
  id: Schema.String,
  expiresAt: Schema.String
})
export type PersonalDataExportReceipt = typeof PersonalDataExportReceipt.Type
export type PersonalDataExportDownload = {
  readonly fileName: string
  readonly json: string
}
export type PersonalDataExportInterface = {
  readonly request: (
    userId: string,
    sessionId: string
  ) => Effect.Effect<PersonalDataExportReceipt, CapabilityUnavailable>
  readonly download: (
    userId: string,
    sessionId: string,
    exportId: string
  ) => Effect.Effect<PersonalDataExportDownload, CapabilityUnavailable>
}
export class PersonalDataExports extends Context.Service<
  PersonalDataExports,
  PersonalDataExportInterface
>()('@b2b-saas-starter/capabilities/PersonalDataExports') {}
