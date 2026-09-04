import { Effect } from 'effect'
import {
  AccountLifecycle,
  type AccountDeletionPlan
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import {
  notificationPreferencesPayload,
  type NotificationPreferencesPayload
} from './notification-preferences'

/**
 * The `/account` page's server behaviour — the read half is a plain module
 * function (the loader calls it directly, testable against the Seed layer
 * like `loadWorkspaceDashboard`); the delete is a server fn whose handler
 * lives here behind its session gate.
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
export function loadAccountPageData(input: {
  readonly userId: string
}): Promise<
  AccountPagePayload & { readonly preferences: NotificationPreferencesPayload }
> {
  return runCapabilities(
    Effect.map(
      Effect.all(
        {
          deletionPlan: Effect.flatMap(AccountLifecycle, (lifecycle) =>
            lifecycle.planDeletion(input.userId)
          ),
          preferences: notificationPreferencesPayload(input)
        },
        { concurrency: 'unbounded' }
      ),
      ({ deletionPlan, preferences }) => ({ deletionPlan, preferences })
    )
  )
}

/**
 * Loads the deletion plan. Identity-keyed by design — the plan spans every
 * workspace the user belongs to, before any single one is selected.
 */
export async function loadAccountPage(input: {
  readonly userId: string
}): Promise<AccountPagePayload> {
  const deletionPlan = await runCapabilities(
    Effect.flatMap(AccountLifecycle, (lifecycle) =>
      lifecycle.planDeletion(input.userId)
    )
  )
  return { deletionPlan }
}

export async function deleteAccountHandler(input: {
  readonly password: string
}): Promise<AccountDeletionPlan> {
  const session = await requireRequestSession()
  // The binding is imported lazily so this module (reached from the route
  // tree only through a dynamic import) never pulls the Better Auth server
  // instance into the client bundle.
  const { webAccountLifecycleBinding } = await import('./account-binding')
  return runCapabilities(
    Effect.flatMap(AccountLifecycle, (lifecycle) =>
      lifecycle.deleteAccount({ userId: session.user.id, password: input.password })
    ),
    { accountLifecycleBinding: webAccountLifecycleBinding }
  )
}
