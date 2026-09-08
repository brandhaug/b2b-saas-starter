import {
  AccountLifecycle,
  type AccountDeletionPlan
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import { Effect } from 'effect'
import { needsStrongAuthentication } from '@b2b-saas-starter/authz/client'
import {
  StrongAuthentication,
  StrongAuthenticationRequired
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { webAccountLifecycleBinding } from './account-binding'
import { type DeleteAccountInput } from './account'
import { makeSecurityEvidenceSink } from './security-evidence-sink'

/**
 * The delete half of the `/account` server behaviour, in its own module so
 * the route-imported `account.effects.ts` stays a pure-read module (both are
 * reached through dynamic `import()` inside `account.ts`'s handlers — see
 * apps/web/AGENTS.md for the split). This file holds the session gate and
 * the plugin binding, which must never enter the client bundle (see the
 * client-boundary assert).
 *
 * The binding is imported lazily for the same reason: the module sits on the
 * auth runtime's import path, and the binding pulls the Better Auth server
 * instance in through `plugin-call`.
 */
export async function deleteAccountHandler(
  input: DeleteAccountInput
): Promise<AccountDeletionPlan> {
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.gen(function* () {
      if (session.session.impersonatedBy) {
        return yield* Effect.fail(new StrongAuthenticationRequired())
      }
      const lifecycle = yield* AccountLifecycle
      const plan = yield* lifecycle.planDeletion(session.user.id)
      // Account deletion spans every membership, including workspaces that are
      // not active in this browser session.
      if (
        needsStrongAuthentication({ systemRole: session.user.role }) ||
        plan.steps.some((step) =>
          needsStrongAuthentication({ workspaceRole: step.role })
        )
      ) {
        const authentication = yield* StrongAuthentication
        yield* authentication.require({
          userId: session.user.id,
          sessionId: session.session.id
        })
      }
      return yield* lifecycle.deleteAccount({
        userId: session.user.id,
        password: input.password
      })
    }),
    {
      accountLifecycleBinding: webAccountLifecycleBinding,
      securityEvidence: makeSecurityEvidenceSink()
    }
  )
}
