import { Effect } from 'effect'
import {
  AccountLifecycle,
  type AccountDeletionPlan
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'

import { runCapabilities } from '../capabilities'
import {
  notificationPreferencesPayload,
  type NotificationPreferenceRow
} from './notification-preferences'

/**
 * The `/account` page's server reads — plain module functions the route's
 * loader calls directly, testable against the Seed layer like
 * `loadWorkspaceDashboard`. The delete is a server fn whose handler lives in
 * `account-delete.ts`, reached through a dynamic import (see `account.ts`).
 *
 * This surface is user-level, not workspace-level: no `WorkspaceContext`, no
 * workspace permission gate — the ownership rule lives in the capability, and
 * the only authorization question ("is this the account owner?") is the
 * session itself.
 */

/** The page payload: what deleting the account would do to each workspace. */
export type AccountPagePayload = {
  readonly deletionPlan: AccountDeletionPlan
}

/**
 * The `/account` route's loader read, composed here so the route's loader is
 * one call: the deletion plan and the user's notification preferences — two
 * identity-keyed reads with no workspace involved, run as one capability
 * effect (`Effect.all`, the same composition the workspace settings payload
 * uses for its segments).
 */
export function loadAccountPageData(input: { readonly userId: string }): Promise<
  AccountPagePayload & {
    readonly preferences: ReadonlyArray<NotificationPreferenceRow>
  }
> {
  return runCapabilities(
    Effect.map(
      Effect.all(
        {
          deletionPlan: Effect.flatMap(AccountLifecycle, (lifecycle) =>
            lifecycle.planDeletion(input.userId)
          ),
          preferenceRows: Effect.map(
            notificationPreferencesPayload(input),
            (payload) => payload.preferences
          )
        },
        { concurrency: 'unbounded' }
      ),
      ({ deletionPlan, preferenceRows }) => ({
        deletionPlan,
        preferences: preferenceRows
      })
    )
  )
}

/**
 * Loads the deletion plan. Identity-keyed by design — the plan spans every
 * workspace the user belongs to, before any single one is selected.
 */
