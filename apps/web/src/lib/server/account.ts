import { type AccountDeletionPlan } from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { type AccountPagePayload } from './account.effects'
import { type NotificationPreferenceRow } from './notification-preferences'

/**
 * The account page's server functions, in a **client-safe** module — the
 * client-safe half of the `account.effects.ts` split; see apps/web/AGENTS.md
 * for the rule and `scripts/assert-client-boundary.mjs` for the enforcement.
 * Each input is written once, as its Effect Schema: the validator is the
 * single strict decode, and the derived type types both the client stub and
 * the effects handler.
 */

/** The composed `/account` loader payload: the plan plus the preference rows. */
export type AccountPageData = AccountPagePayload & {
  readonly preferences: ReadonlyArray<NotificationPreferenceRow>
}

/** The `/account` route's composed loader read, identity-keyed by the session. */
export const loadAccountPageServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<AccountPageData> => {
  const { loadAccountPageHandler } = await import('./account.effects')
  return loadAccountPageHandler()
})

const DeleteAccountInput = Schema.Struct({
  password: Schema.NonEmptyString
})

export type DeleteAccountInput = typeof DeleteAccountInput.Type

/** What deleting the account would do to each workspace, for the panel. */
export type { AccountDeletionPlan }

/**
 * Runs the deletion. Resolves with the deletion plan — the session is gone by
 * the time it resolves, so the panel's only remaining job is to leave for
 * `/sign-in`.
 */
export const deleteAccountServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(DeleteAccountInput))
  .handler(async ({ data }): Promise<AccountDeletionPlan> => {
    const { deleteAccountHandler } = await import('./account-delete.effects')
    return deleteAccountHandler(data)
  })
