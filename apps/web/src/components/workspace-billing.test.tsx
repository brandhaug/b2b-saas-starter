import { type BillingSynchronizationStatus } from '@b2b-saas-starter/billing/billing'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  PLANS,
  planById,
  resourceEntitlement,
  type ResourceEntitlement
} from '@b2b-saas-starter/billing/plan-catalog'
import { type WorkspaceViewer } from '@/lib/permissions'
import { renderWithRouter } from '@/test/router-harness'
import {
  BillingPlans,
  PublicBillingPlans,
  type BillingPlan,
  type StartCheckout,
  type StartPortalSession,
  type SelectBillingResources
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
const selectResources: SelectBillingResources = vi.fn(async () => ({
  apiTokenIds: ['tok_1', 'tok_2'],
  webhookEndpointIds: ['wh_1']
}))

function withProviderPrice(plan: BillingPlan): BillingPlan {
  return {
    ...plan,
    providerPrice: plan.id === 'team' ? { amount: 12.5, currency: 'USD' } : plan.price
  }
}

async function renderPlans(options?: {
  readonly stripeConfigured?: boolean
  readonly status?: BillingSynchronizationStatus['status']
  readonly viewer?: WorkspaceViewer
  readonly currentPlanId?: string
  readonly apiTokens?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly webhookEndpoints?: ReadonlyArray<{
    readonly id: string
    readonly url: string
  }>
  readonly plans?: ReadonlyArray<BillingPlan>
  readonly pricingUnavailable?: boolean
  readonly viewerRole?: WorkspaceViewer['role']
  readonly lifecycleStatus?:
    | 'active'
    | 'trialing'
    | 'incomplete'
    | 'past_due'
    | 'unpaid'
    | 'paused'
    | 'canceled'
  readonly graceEndsAt?: string | null
  readonly subscribedPlanId?: string
  readonly selectResources?: SelectBillingResources
  readonly resourceSelection?: {
    readonly apiTokenIds: ReadonlyArray<string>
    readonly webhookEndpointIds: ReadonlyArray<string>
  } | null
  readonly resourceEntitlements?: {
    readonly apiTokens: ResourceEntitlement
    readonly webhookEndpoints: ResourceEntitlement
  }
  readonly cancelAtPeriodEnd?: boolean
  readonly currentPeriodEnd?: string | null
}) {
  return renderWithRouter(
    <BillingPlans
      workspaceSlug="starter-lab"
      currentPlanId={options?.currentPlanId ?? 'team'}
      plans={options?.plans ?? PLANS}
      pricingUnavailable={options?.pricingUnavailable ?? false}
      lifecycle={{
        status: options?.lifecycleStatus ?? 'active',
        planId: options?.subscribedPlanId ?? options?.currentPlanId ?? 'team',
        currentPeriodEnd: options?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: options?.cancelAtPeriodEnd ?? false,
        trialEnd: null,
        graceEndsAt: options?.graceEndsAt ?? null
      }}
      synchronization={{ status: options?.status ?? 'current', lastSyncedAt: null }}
      stripeConfigured={options?.stripeConfigured ?? true}
      canManageBilling={(options?.viewer ?? owner).role !== 'member'}
      apiTokens={options?.apiTokens ?? []}
      webhookEndpoints={options?.webhookEndpoints ?? []}
      resourceSelection={options?.resourceSelection ?? null}
      resourceEntitlements={
        options?.resourceEntitlements ?? {
          apiTokens: resourceEntitlement(
            planById(options?.currentPlanId ?? 'team'),
            'api_token',
            (options?.apiTokens ?? []).map(({ id }) => id),
            options?.resourceSelection ?? undefined
          ),
          webhookEndpoints: resourceEntitlement(
            planById(options?.currentPlanId ?? 'team'),
            'webhook_endpoint',
            (options?.webhookEndpoints ?? []).map(({ id }) => id),
            options?.resourceSelection ?? undefined
          )
        }
      }
      selectBillingResources={options?.selectResources ?? selectResources}
      startCheckout={checkout}
      startPortalSession={portal}
    />,
    { path: '/workspaces/starter-lab/billing' }
  )
}

describe('BillingPlans', () => {
  it('shows delayed updates without presenting an unverified upgrade', async () => {
    await renderPlans({ currentPlanId: 'starter', status: 'delayed' })
    expect(screen.getByRole('status').textContent).toContain('retrying automatically')
    screen.getByText(/up to 3 seats/)
  })

  it('shows scheduled cancellation for an active subscription', async () => {
    await renderPlans({
      currentPlanId: 'team',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2027-01-31T00:00:00.000Z'
    })
    expect(screen.getByText(/Cancellation is scheduled/)).toBeTruthy()
  })

  it('explains pending updates and conflicts', async () => {
    const view = await renderPlans({ status: 'pending' })
    expect(screen.getByRole('status').textContent).toContain('updates are pending')
    view.unmount()
    await renderPlans({ status: 'conflict' })
    expect(screen.getByRole('status').textContent).toContain('Contact support')
  })

  it('hands the portal URL to the browser when Stripe is configured', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', {
      assign,
      href: 'http://localhost/workspaces/starter-lab/billing'
    })
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

  it('offers no sales motion for a self-serve plan on an unconfigured deployment', async () => {
    await renderPlans({ stripeConfigured: false, currentPlanId: 'starter' })
    // Team is self-serve: without Stripe there is nothing to click and no
    // sales team to contact, so the card says checkout is unavailable...
    expect(screen.getByText(/Checkout is not available right now/)).toBeTruthy()
    expect(screen.queryByText(/Contact sales to move to Team/)).toBeNull()
    // ...while the sales-led tier keeps the contact line it always had.
    expect(screen.getByText(/Contact sales to move to Enterprise/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /upgrade to team/i })).toBeNull()
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
    screen.getByText(/\$12\.00\/seat\/mo/)
  })

  it('lets owners select at most two tokens and one webhook after downgrade', async () => {
    await renderPlans({
      currentPlanId: 'starter',
      lifecycleStatus: 'incomplete',
      apiTokens: [
        { id: 'tok_1', name: 'First token' },
        { id: 'tok_2', name: 'Second token' },
        { id: 'tok_3', name: 'Third token' }
      ],
      webhookEndpoints: [
        { id: 'wh_1', url: 'https://example.test/hook-one' },
        { id: 'wh_2', url: 'https://example.test/hook-two' }
      ]
    })
    expect(screen.getByText(/Choose resources to keep active/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'First token' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Second token' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Third token' }))
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'https://example.test/hook-one' })
    )
    fireEvent.click(screen.getByRole('button', { name: /save selection/i }))
    await vi.waitFor(() => expect(selectResources).toHaveBeenCalled())
    expect(selectResources).toHaveBeenLastCalledWith({
      data: {
        workspaceSlug: 'starter-lab',
        apiTokenIds: ['tok_1', 'tok_2'],
        webhookEndpointIds: ['wh_1']
      }
    })
  })

  it('does not expose resource selection to ordinary members', async () => {
    await renderPlans({
      viewer: member,
      currentPlanId: 'starter',
      lifecycleStatus: 'incomplete',
      subscribedPlanId: 'team',
      apiTokens: [
        { id: 'tok_1', name: 'First token' },
        { id: 'tok_2', name: 'Second token' },
        { id: 'tok_3', name: 'Third token' }
      ],
      webhookEndpoints: [
        { id: 'wh_1', url: 'https://example.test/hook-one' },
        { id: 'wh_2', url: 'https://example.test/hook-two' }
      ]
    })
    expect(screen.queryByText(/Choose resources to keep active/)).toBeNull()
    expect(screen.getByText(/Some workspace features are restricted/)).toBeTruthy()
  })

  it('preserves configured currency precision in plan prices', async () => {
    const plans: ReadonlyArray<BillingPlan> = PLANS.map(withProviderPrice)
    await renderPlans({ plans })
    expect(screen.getByText('$12.50/seat/mo')).toBeTruthy()
  })

  it('does not show workspace access copy on public pricing', async () => {
    await renderWithRouter(
      <PublicBillingPlans
        plans={PLANS}
        pricingUnavailable={false}
        stripeConfigured={false}
      />,
      { path: '/pricing' }
    )
    expect(screen.queryByText(/Some workspace features are restricted/)).toBeNull()
    expect(screen.getAllByText('Catalog example price').length).toBeGreaterThan(0)
  })

  it('renders the workspace recovery page when configured pricing is unavailable', async () => {
    await renderPlans({
      pricingUnavailable: true,
      plans: [],
      currentPlanId: 'starter'
    })
    expect(screen.getByText(/Plan pricing is temporarily unavailable/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /manage billing/i })).toBeTruthy()
  })

  it('drops selected resources that are no longer visible', async () => {
    await renderPlans({
      currentPlanId: 'starter',
      lifecycleStatus: 'incomplete',
      resourceSelection: {
        apiTokenIds: ['tok_revoked', 'tok_1'],
        webhookEndpointIds: ['wh_revoked']
      },
      apiTokens: [
        { id: 'tok_1', name: 'First token' },
        { id: 'tok_2', name: 'Second token' },
        { id: 'tok_3', name: 'Third token' }
      ],
      webhookEndpoints: [
        { id: 'wh_1', url: 'https://example.test/hook-one' },
        { id: 'wh_2', url: 'https://example.test/hook-two' }
      ]
    })
    expect(screen.queryByRole('checkbox', { name: 'tok_revoked' })).toBeNull()
    expect(
      screen.getByRole('checkbox', { name: 'First token' }).getAttribute('aria-checked')
    ).toBe('true')
    expect(
      screen
        .getByRole('checkbox', { name: 'https://example.test/hook-one' })
        .getAttribute('aria-checked')
    ).toBe('false')
  })

  it('prioritizes ended unpaid access over a retained grace deadline', async () => {
    await renderPlans({
      currentPlanId: 'starter',
      lifecycleStatus: 'unpaid',
      graceEndsAt: '2027-01-31T00:00:00.000Z'
    })
    expect(screen.getByText(/marked this subscription unpaid/)).toBeTruthy()
    expect(screen.queryByText(/Paid access remains available until/)).toBeNull()
  })

  it('uses effective entitlement rather than raw lifecycle status for member copy', async () => {
    await renderPlans({
      viewer: member,
      currentPlanId: 'starter',
      lifecycleStatus: 'active',
      subscribedPlanId: 'team'
    })
    expect(screen.getByText(/Some workspace features are restricted/)).toBeTruthy()
  })

  it('restricts members when terminal cancellation leaves excess resources partially active', async () => {
    await renderPlans({
      viewer: member,
      currentPlanId: 'starter',
      subscribedPlanId: 'starter',
      resourceEntitlements: {
        apiTokens: {
          resource: 'api_token',
          limit: 2,
          used: 3,
          eligibleIds: ['tok_1', 'tok_2', 'tok_3'],
          selectedIds: ['tok_1', 'tok_2'],
          activeIds: ['tok_1', 'tok_2'],
          paused: false
        },
        webhookEndpoints: {
          resource: 'webhook_endpoint',
          limit: 1,
          used: 0,
          eligibleIds: [],
          selectedIds: [],
          activeIds: [],
          paused: false
        }
      }
    })
    expect(screen.getByText(/Contact an owner or admin/)).toBeTruthy()
  })

  it('does not restrict a valid paid trial', async () => {
    await renderPlans({
      viewer: member,
      currentPlanId: 'team',
      lifecycleStatus: 'trialing',
      subscribedPlanId: 'team'
    })
    expect(screen.queryByText(/Some workspace features are restricted/)).toBeNull()
  })
})
