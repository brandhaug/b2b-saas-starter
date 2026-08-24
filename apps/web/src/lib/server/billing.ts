import { type AuthorizationDenied } from '@b2b-saas-starter/authz/src/errors.ts'
import {
  Billing,
  PLANS,
  type Plan
} from '@b2b-saas-starter/capabilities/src/billing/billing.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/src/workspace-context.ts'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema, type Scope } from 'effect'
import { env as cloudflareEnv } from 'cloudflare:workers'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

/**
 * The billing page payload: the workspace's current plan, the catalog, and
 * whether checkout is actually wired. `stripeConfigured` is computed from the
 * worker env at request time — it is presentation posture, not a secret — so
 * the page can say "billing is not configured" honestly instead of rendering
 * a button that can only fail.
 */
export type WorkspaceBillingPayload = {
  readonly viewer: { readonly role: WorkspaceRole } | null
  readonly workspaceName: string
  readonly unreadCount: number
  readonly plans: readonly Plan[]
  readonly currentPlanId: string
  /** True when `STRIPE_SECRET_KEY` (and every paid plan's price id) is set. */
  readonly stripeConfigured: boolean
}

function stripeConfiguredFromEnv(): boolean {
  return (
    cloudflareEnv.STRIPE_SECRET_KEY !== undefined &&
    cloudflareEnv.STRIPE_SECRET_KEY.length > 0 &&
    cloudflareEnv.STRIPE_PRICE_ID_TEAM !== undefined &&
    cloudflareEnv.STRIPE_PRICE_ID_TEAM.length > 0
  )
}

/** The billing route's loader effect. Hard-gated like the other pages. */
const billingPayload: Effect.Effect<
  WorkspaceBillingPayload,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | Billing | NotificationFeed
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ notification: ['read'] })
  const ctx = yield* WorkspaceContext
  const billing = yield* Billing
  const feed = yield* NotificationFeed
  const [plan, unreadCount] = yield* Effect.all(
    [billing.currentPlan, feed.unreadCount],
    {
      concurrency: 'unbounded'
    }
  )
  return {
    viewer: ctx.actor ? { role: ctx.actor.role } : null,
    workspaceName: ctx.workspace.name,
    unreadCount,
    plans: PLANS,
    currentPlanId: plan.id,
    stripeConfigured: stripeConfiguredFromEnv()
  }
})

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
