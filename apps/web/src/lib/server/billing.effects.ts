import { Billing } from '@b2b-saas-starter/capabilities/billing/billing'
import { PLANS } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { Effect } from 'effect'
import { env as cloudflareEnv } from 'cloudflare:workers'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type PortalInput,
  type StartCheckoutInput,
  type WorkspaceBillingInput,
  type WorkspaceBillingPayload
} from './billing'

/**
 * The billing payload assembly and the checkout wiring, reached only
 * through dynamic `import()` inside the handlers of `billing.ts`: handler
 * bodies are stripped from the client build, so this graph ships to the
 * server alone. `billing.ts` holds the client-safe half and the reason for
 * the split.
 */

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

/** The billing route's loader, as a plain function for tests. */
export function loadWorkspaceBilling(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceBillingPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, billingPayload, {
    userId: input.userId
  })
}

export async function loadWorkspaceBillingHandler(
  input: WorkspaceBillingInput
): Promise<WorkspaceBillingPayload> {
  const session = await requireRequestSession()
  return loadWorkspaceBilling({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id
  })
}

/**
 * The upgrade action below the session and permission gates. Redirect URLs
 * are composed server-side from the configured base URL — the client names
 * only its slug and the plan — so a crafted success/cancel URL cannot turn
 * the checkout handoff into an open redirect.
 */
export async function startCheckoutHandler(
  input: StartCheckoutInput
): Promise<{ url: string }> {
  const session = await requireRequestSession()
  const base = cloudflareEnv.BETTER_AUTH_URL.replace(/\/$/, '')
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ organization: ['update'] })
      const billing = yield* Billing
      const backTo = `${base}/workspaces/${encodeURIComponent(input.workspaceSlug)}/billing`
      return yield* billing.startCheckout({
        planId: input.planId,
        successUrl: `${backTo}?checkout=success`,
        cancelUrl: `${backTo}?checkout=canceled`
      })
    }),
    { userId: session.user.id }
  )
}

/**
 * The "Manage billing" action below the session and permission gates. The
 * return URL is composed server-side from the configured base URL — same
 * open-redirect posture as checkout — and the portal itself owns invoices,
 * payment method, and cancellation.
 */
export async function startPortalSessionHandler(
  input: PortalInput
): Promise<{ url: string }> {
  const session = await requireRequestSession()
  const base = cloudflareEnv.BETTER_AUTH_URL.replace(/\/$/, '')
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ organization: ['update'] })
      const billing = yield* Billing
      return yield* billing.startPortalSession({
        returnUrl: `${base}/workspaces/${encodeURIComponent(input.workspaceSlug)}/billing`
      })
    }),
    { userId: session.user.id }
  )
}
