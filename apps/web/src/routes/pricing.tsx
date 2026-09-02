import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The starter is MIT — it does not sell plans, so there is no pricing page.
 * The real plan vocabulary (Starter / Team / Enterprise with entitlement
 * ceilings) is the `PLANS` constant in
 * `packages/capabilities/src/billing/plan-catalog.ts`, rendered by the
 * workspace Billing page and documented in the Stripe billing guide — which is
 * where this URL lands.
 */
export const Route = createFileRoute('/pricing')({
  beforeLoad: () => {
    throw redirect({
      to: '/docs/$category/$slug',
      params: { category: 'integrations', slug: 'stripe-billing' },
      replace: true
    })
  }
})
