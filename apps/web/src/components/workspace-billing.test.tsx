import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { PLANS } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { type WorkspaceViewer } from '@/lib/permissions'
import { renderWithRouter } from '@/test/router-harness'
import {
  BillingPlans,
  type StartCheckout,
  type StartPortalSession
} from './workspace-billing'

/**
 * The billing page's own seams: the two server functions are ports, so the
 * tests assert what the page does with them — render the portal button only
 * when Stripe is configured, hide it from viewers who cannot manage billing,
 * and hand the returned URL to the browser.
 */

const owner: WorkspaceViewer = { role: 'owner' }
const member: WorkspaceViewer = { role: 'member' }

const checkout: StartCheckout = vi.fn(async () => ({
  url: 'https://checkout.stripe.com/c/pay/test'
}))
const portal: StartPortalSession = vi.fn(async () => ({
  url: 'https://billing.stripe.com/p/session/test'
}))

async function renderPlans(options?: {
  readonly stripeConfigured?: boolean
  readonly viewer?: WorkspaceViewer
  readonly currentPlanId?: string
}) {
  return renderWithRouter(
    <BillingPlans
      workspaceSlug="starter-lab"
      currentPlanId={options?.currentPlanId ?? 'team'}
      plans={PLANS}
      stripeConfigured={options?.stripeConfigured ?? true}
      canManageBilling={(options?.viewer ?? owner).role !== 'member'}
      startCheckout={checkout}
      startPortalSession={portal}
    />,
    { path: '/workspaces/starter-lab/billing' }
  )
}

describe('BillingPlans', () => {
  it('hands the portal URL to the browser when Stripe is configured', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    try {
      await renderPlans()
      fireEvent.click(screen.getByRole('button', { name: /manage billing/i }))
      await vi.waitFor(() => {
        expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test')
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders no portal button when Stripe is unconfigured', async () => {
    await renderPlans({ stripeConfigured: false })
    expect(screen.queryByRole('button', { name: /manage billing/i })).toBeNull()
    // The honest degradation note stays, so the page explains itself.
    screen.getByText(/Stripe is not configured on this deployment/)
  })

  it('renders no portal button for a viewer who cannot manage billing', async () => {
    await renderPlans({ viewer: member })
    expect(screen.queryByRole('button', { name: /manage billing/i })).toBeNull()
  })

  it('words the seat line off the plan record, not a plan id', async () => {
    await renderPlans({ currentPlanId: 'starter' })
    // The current-plan sentence uses the flat plan's included seats...
    screen.getByText(/up to 3 seats/)
    // ...while the per-seat plan's card says what actually bills.
    screen.getByText('Billed per member')
    screen.getByText(/\$12\/seat\/mo/)
  })
})
