import { type AccountDeletionPlan } from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The account-deletion server function, in a **client-safe** module.
 *
 * This file is statically imported by the `/account` route, and the route tree
 * ships to the browser — so the capability effects, the Better Auth session
 * gate and the plugin binding live in `account.effects.ts` and are reached
 * only through dynamic `import()` inside the handler, exactly like the
 * invitation flow (`invitations.ts` / `invitations.effects.ts`). The plan read
 * needs no server fn: the route's loader calls `loadAccountPage` directly, the
 * same way the workspace routes call their loaders' server modules.
 */

const DeleteAccountInput = Schema.Struct({
  password: Schema.NonEmptyString
})

const decodeDelete = Schema.decodeUnknownSync(DeleteAccountInput)

/** What deleting the account would do to each workspace, for the panel. */
export type { AccountDeletionPlan }

/**
 * Runs the deletion. Resolves with the deletion plan — the session is gone by
 * the time it resolves, so the panel's only remaining job is to leave for
 * `/sign-in`.
 */
export const deleteAccountServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeDelete(input))
  .handler(async ({ data }): Promise<AccountDeletionPlan> => {
    const { deleteAccountHandler } = await import('./account-delete')
    return deleteAccountHandler({ password: data.password })
  })
