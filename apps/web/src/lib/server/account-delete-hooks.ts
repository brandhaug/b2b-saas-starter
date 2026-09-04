import { type UserDeleteHooks } from '@b2b-saas-starter/auth'
import {
  AccountLifecycle,
  deletionMetadata,
  type AccountDeletionPlan
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import { Effect } from 'effect'

import { causeMessage } from '../cause-message'
import { runCapabilities } from '../capabilities'

/**
 * The app half of Better Auth's `user.deleteUser` hooks — the seam
 * `account-lifecycle.AGENTS.md` documents. The endpoint's sequencing is the
 * whole point: the password is verified before `beforeDelete` runs, so the
 * workspace teardown here can never execute for a wrong credential, and the
 * user row is gone before `afterDelete` runs, so the `account.deleted` audit
 * event must be recorded actorless.
 *
 * The plan the before-hook computes is what the after-hook records, handed
 * across keyed by the request — the one object exactly the two hooks of one
 * delete share.
 *
 * Both halves are best-effort after the store's own password check: a failed
 * `beforeDelete` aborts the delete (fail-closed — the account survives a
 * teardown that could not run), while a failed `afterDelete` record or email
 * cannot un-delete the account and is logged instead.
 */

/** Runs an account-lifecycle effect with the web app's binding. */
export type AccountLifecycleRunner = <A, E>(
  effect: Effect.Effect<A, E, AccountLifecycle>
) => Promise<A>

export type AccountDeletedEmailSender = (input: {
  readonly email: string
  readonly workspacesLeft: number
  readonly workspacesDeleted: number
}) => Promise<void>

export function makeUserDeleteHooks(deps: {
  readonly runAccountLifecycle: AccountLifecycleRunner
  readonly sendAccountDeletedEmail: AccountDeletedEmailSender
}): UserDeleteHooks {
  const plans = new WeakMap<object, AccountDeletionPlan>()

  return {
    beforeDelete: async (user, request) => {
      const plan = await deps.runAccountLifecycle(
        Effect.flatMap(AccountLifecycle, (lifecycle) =>
          lifecycle.prepareDeletion(user.id)
        )
      )
      if (request !== undefined) {
        plans.set(request, plan)
      }
    },
    afterDelete: async (user, request) => {
      const plan = request === undefined ? undefined : plans.get(request)
      if (plan === undefined) {
        // No before-hook plan means no teardown ran for this request; nothing
        // this hook could record would be true.
        return
      }
      if (request !== undefined) {
        plans.delete(request)
      }
      await deps
        .runAccountLifecycle(
          Effect.flatMap(AccountLifecycle, (lifecycle) =>
            lifecycle.recordDeleted({ userId: user.id, plan })
          )
        )
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected promise's value is `unknown` by construction; causeMessage is the parse step
        .catch((error: unknown) => {
          // The account row is already gone — the record cannot block it, but
          // a governance event silently lost is worth a line in the log. The
          // default runtime is the precedent here, like `auth-runtime.ts`'s
          // background runner.
          Effect.runFork(
            Effect.logWarning(
              `account.deleted audit event not recorded: ${causeMessage(error, 'no reason given')}`
            )
          )
        })
      await deps
        .sendAccountDeletedEmail({
          email: user.email,
          ...deletionMetadata(plan)
        })
        .catch(() => {
          // Swallowed by contract, like the two-factor notification: the
          // deletion succeeded and the dispatcher's own wide event carries
          // the failure.
        })
    }
  }
}

/**
 * The hooks the auth runtime provides: the capability run carries the web
 * app's account-lifecycle binding, and the email rides the provider-light
 * dispatcher (`auth-emails.ts`).
 */
export function defaultUserDeleteHooks(): UserDeleteHooks {
  return makeUserDeleteHooks({
    runAccountLifecycle: async (effect) => {
      // Imported at call time, never at module scope: this module sits on the
      // auth runtime's import path, and the binding pulls the Better Auth
      // server instance in through `plugin-call`.
      const { webAccountLifecycleBinding } = await import('./account-binding')
      return runCapabilities(effect, {
        accountLifecycleBinding: webAccountLifecycleBinding
      })
    },
    sendAccountDeletedEmail: async (input) => {
      const { sendAccountDeletedEmail } = await import('./auth-emails')
      return sendAccountDeletedEmail(input)
    }
  })
}
