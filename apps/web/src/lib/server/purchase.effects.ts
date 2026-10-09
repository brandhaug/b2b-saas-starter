import { Effect } from 'effect'
import { env } from 'cloudflare:workers'
import { Billing } from '@b2b-saas-starter/billing/billing'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { authorize, memberPrincipal } from '@b2b-saas-starter/authz/client'
import { requireEmailVerification } from '@b2b-saas-starter/env/server'
import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { type PurchaseInput, type PurchasePayload } from './purchase'

export async function loadPurchaseHandler(
  input: PurchaseInput
): Promise<PurchasePayload> {
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.gen(function* () {
      const billing = yield* Billing
      const membership = yield* WorkspaceMembership
      const workspaces = yield* membership.listWorkspacesForUser(session.user.id)
      const plans = yield* billing.displayedPlans.pipe(Effect.orElseSucceed(() => []))
      return {
        plan:
          plans.find(
            (plan) => plan.id === input.planId && plan.purchase === 'self_serve'
          ) ?? null,
        stripeConfigured: yield* billing.configured,
        emailVerificationRequired:
          requireEmailVerification(env.ENVIRONMENT) && !session.user.emailVerified,
        workspaces: workspaces.flatMap(({ workspace, member }) =>
          authorize(memberPrincipal(member.role), { organization: ['update'] }).success
            ? [{ slug: workspace.slug, name: workspace.name }]
            : []
        )
      }
    })
  )
}
