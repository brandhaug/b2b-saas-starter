import { Billing } from '@b2b-saas-starter/capabilities/billing/billing'
import { PLANS, type Plan } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import { env as cloudflareEnv } from 'cloudflare:workers'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'

/**
 * The billing page payload: the workspace's current plan, the catalog, and
 * whether checkout is actually wired. `stripeConfigured` comes from the
 * Billing capability itself — the one definition of "Stripe is configured",
 * the same predicate `startCheckout` enforces — so the page can say "billing
 * is not configured" honestly instead of rendering a button that can only
 * fail.
 */
export type WorkspaceBillingPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly workspaceName: string
  readonly unreadCount: number
  readonly plans: ReadonlyArray<Plan>
  readonly currentPlanId: string
  /** True when the Billing capability has its provider wired. */
  readonly stripeConfigured: boolean
}

/** The billing route's loader effect. Hard-gated like the other pages. */
const billingPayload: WorkspacePageFrame<WorkspaceBillingPayload> = workspacePage(
  { notification: ['read'] },
  (ctx) =>
    Effect.flatMap(Billing, (billing) =>
      Effect.map(
        Effect.all(
          {
            unreadCount,
            plan: billing.currentPlan,
            stripeConfigured: billing.configured
          },
          { concurrency: 'unbounded' }
        ),
        (segments) => ({
          workspaceName: ctx.workspace.name,
          unreadCount: segments.unreadCount,
          plans: PLANS,
          currentPlanId: segments.plan.id,
          stripeConfigured: segments.stripeConfigured
        })
      )
    )
)

/** The billing route's loader. */
export function loadWorkspaceBilling(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceBillingPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, billingPayload, {
    userId: input.userId
  })
}

// All input constraints live in the schema — no imperative re-validation.
const StartCheckoutInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  planId: Schema.NonEmptyString
})
const decodeCheckoutInput = Schema.decodeUnknownSync(StartCheckoutInput)

/**
 * The upgrade action below the session and permission gates. Redirect URLs
 * are composed server-side from the configured base URL — the client names
 * only its slug and the plan — so a crafted success/cancel URL cannot turn
 * the checkout handoff into an open redirect.
 */
export const startCheckoutServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeCheckoutInput(input))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const session = await requireRequestSession()
    const base = cloudflareEnv.BETTER_AUTH_URL.replace(/\/$/, '')
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        yield* requireWorkspacePermission({ organization: ['update'] })
        const billing = yield* Billing
        const backTo = `${base}/workspaces/${encodeURIComponent(data.workspaceSlug)}/billing`
        return yield* billing.startCheckout({
          planId: data.planId,
          successUrl: `${backTo}?checkout=success`,
          cancelUrl: `${backTo}?checkout=canceled`
        })
      }),
      { userId: session.user.id }
    )
  })
