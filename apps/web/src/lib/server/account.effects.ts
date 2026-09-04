import { Effect } from 'effect'
import {
  AccountLifecycle,
  type AccountDeletionPlan
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'

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
