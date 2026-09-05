import { type AccountDeletionPlan } from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import { createServerFn } from '@tanstack/react-start'

import { type AccountPagePayload } from './account.effects'
import { expectRecord, expectString } from './input-shape'
import { type NotificationPreferenceRow } from './notification-preferences'

/**
 * The account page's server functions, in a **client-safe** module.
 *
 * This file is statically imported by the `/account` route, and the route tree
 * ships to the browser — so the capability effects, the Better Auth session
 * gate and the plugin binding live in `account-delete.ts` and
 * `account.effects.ts`, reached only through dynamic `import()` inside the
 * handlers, exactly like the invitation flow (`invitations.ts` /
 * `invitations.effects.ts`).
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

type DeleteAccountInput = {
  readonly password: string
}

/**
 * The server fn's validator, a plain shape check that runs on the server only
 * (TanStack strips `.validator()` from the client build): it is the server's
 * first decode, and the strict schema decodes again in
 * `account-delete.ts`. This probe IS the I/O boundary, so `unknown` in and
 * `throw` out is the contract, the same exemption `pickOptionalStrings`
 * carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters, effect/noThrowStatement, effect/noNewError
function decodeDeleteInput(input: unknown): DeleteAccountInput {
  const record = expectRecord(input, 'delete-account input')
  const password = expectString(record, 'password', 'delete-account input')
  if (password === '') {
    throw new Error('Invalid delete-account input: password')
  }
  return { password }
}
// oxlint-enable anti-slop/no-unknown-parameters, effect/noThrowStatement, effect/noNewError

/** What deleting the account would do to each workspace, for the panel. */
export type { AccountDeletionPlan }

/**
 * Runs the deletion. Resolves with the deletion plan — the session is gone by
 * the time it resolves, so the panel's only remaining job is to leave for
 * `/sign-in`.
 */
export const deleteAccountServerFn = createServerFn({ method: 'POST' })
  .validator(decodeDeleteInput)
  .handler(async ({ data }): Promise<AccountDeletionPlan> => {
    const { deleteAccountHandler } = await import('./account-delete')
    return deleteAccountHandler(data)
  })
