import {
  AccountLifecycle,
  type AccountDeletionPlan
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import { Effect, Schema } from 'effect'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { webAccountLifecycleBinding } from './account-binding'

/**
 * The delete half of the `/account` server behaviour, in its own module so
 * the route-imported `account.effects.ts` stays a pure-read module (reached
 * through `loadAccountPageServerFn`'s dynamic import): this file
 * holds the session gate and the plugin binding, which must never enter the
 * client bundle (see the client-boundary assert). `account.ts` reaches it
 * through a dynamic import inside the server fn's handler.
 *
 * The binding is imported lazily for the same reason: the module sits on the
 * auth runtime's import path, and the binding pulls the Better Auth server
 * instance in through `plugin-call`.
 */

const DeleteAccountInput = Schema.Struct({
  password: Schema.NonEmptyString
})

const decodeDelete = Schema.decodeUnknownSync(DeleteAccountInput)

// oxlint-disable anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
export async function deleteAccountHandler(
  data: unknown
): Promise<AccountDeletionPlan> {
  const input = decodeDelete(data)
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.flatMap(AccountLifecycle, (lifecycle) =>
      lifecycle.deleteAccount({ userId: session.user.id, password: input.password })
    ),
    { accountLifecycleBinding: webAccountLifecycleBinding }
  )
}
// oxlint-enable anti-slop/no-unknown-parameters
