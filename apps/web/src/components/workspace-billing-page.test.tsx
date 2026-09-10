import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  resourceEntitlement,
  type ResourceSelection,
  STARTER_PLAN
} from '@b2b-saas-starter/billing/plan-catalog'
import { type BillingLifecycle } from '@b2b-saas-starter/billing/billing'
import { WorkspaceBillingPage } from './workspace-billing-page'
import {
  type ReconcileCheckout,
  type WorkspaceBillingPayload
} from '@/lib/server/billing'
import type * as BillingServer from '@/lib/server/billing'
import { type SelectBillingResources } from './workspace-billing'

const { save } = vi.hoisted(() => ({ save: vi.fn<SelectBillingResources>() }))
vi.mock('@/lib/server/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof BillingServer>()),
  selectBillingResourcesServerFn: save
}))

function withSelection(
  data: WorkspaceBillingPayload,
  selected: ResourceSelection
): WorkspaceBillingPayload {
  return {
    ...data,
    resourceSelection: selected,
    resourceEntitlements: {
      apiTokens: resourceEntitlement(
        STARTER_PLAN,
        'api_token',
        data.apiTokens.map(({ id }) => id),
        selected
      ),
      webhookEndpoints: resourceEntitlement(
        STARTER_PLAN,
        'webhook_endpoint',
        data.webhookEndpoints.map(({ id }) => id),
        selected
      )
    }
  }
}

function fixture(): WorkspaceBillingPayload {
  const tokens = ['A', 'B', 'C']
  const hooks = ['https://example.test/one', 'https://example.test/two']
  const selection = {
    apiTokenIds: ['A'],
    webhookEndpointIds: ['https://example.test/one']
  }
  return {
    viewer: { role: 'owner' },
    workspaceName: 'Starter Lab',
    unreadCount: 0,
    plans: [],
    pricingUnavailable: true,
    currentPlanId: 'starter',
    stripeConfigured: false,
    synchronization: { status: 'current', lastSyncedAt: null },
    lifecycle: {
      status: 'canceled',
      planId: 'starter',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEnd: null,
      graceEndsAt: null
    },
    resourceSelection: selection,
    resourceEntitlements: {
      apiTokens: resourceEntitlement(STARTER_PLAN, 'api_token', tokens, selection),
      webhookEndpoints: resourceEntitlement(
        STARTER_PLAN,
        'webhook_endpoint',
        hooks,
        selection
      )
    },
    apiTokens: tokens.map((id) => ({ id, name: `Token ${id}` })),
    webhookEndpoints: hooks.map((id) => ({ id, url: id }))
  }
}

/** Actual page, loader, mutation hook and router invalidation; only the server transport is replaced. */
async function renderBilling(
  initial: WorkspaceBillingPayload = fixture(),
  options: {
    readonly checkoutReturn?: boolean
    readonly reconcileCheckoutReturn?: ReconcileCheckout
  } = {}
) {
  let payload = initial
  // Counting loader runs is how the polling tests see a refresh happen.
  const billingLoads = vi.fn(() => payload)
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceSlug/billing',
    loader: billingLoads,
    component: function BillingRoute() {
      return (
        <WorkspaceBillingPage
          workspaceSlug={route.useParams().workspaceSlug}
          data={route.useLoaderData()}
          {...(options.checkoutReturn === undefined
            ? {}
            : { checkoutReturn: options.checkoutReturn })}
          {...(options.reconcileCheckoutReturn === undefined
            ? {}
            : { reconcileCheckoutReturn: options.reconcileCheckoutReturn })}
        />
      )
    }
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/workspaces/starter-lab/billing']
    })
  })
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  save.mockImplementation(async ({ data }) => {
    payload = withSelection(payload, data)
    return data
  })
  return {
    ...view,
    router,
    billingLoads,
    read: () => payload,
    update: (next: WorkspaceBillingPayload) => {
      payload = next
    }
  }
}

function deferred<A>() {
  let settle: ((value: A) => void) | undefined
  const promise = new Promise<A>((resolve) => {
    settle = resolve
  })
  if (settle === undefined) {
    throw new Error('Promise executor did not run synchronously')
  }
  return { promise, resolve: settle }
}

function checkbox(name: string) {
  return screen.getByRole('checkbox', { name })
}
async function saveSelection() {
  const previousCalls = save.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: /save selection/i }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(previousCalls + 1))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /save selection/i }).hasAttribute('disabled')
    ).toBe(false)
  )
}

beforeEach(() => {
  save.mockReset()
})

function pendingSync(): WorkspaceBillingPayload {
  return {
    ...fixture(),
    stripeConfigured: true,
    synchronization: { status: 'pending', lastSyncedAt: null }
  }
}

/** jsdom reports a visible tab; these tests own the value while they run. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('billing synchronization polling', () => {
  it('refreshes the payload while synchronization is pending and stops after it settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const view = await renderBilling(pendingSync())
      expect(view.billingLoads).toHaveBeenCalledTimes(1)
      await act(() => vi.advanceTimersByTimeAsync(10_000))
      expect(view.billingLoads).toHaveBeenCalledTimes(2)

      // Once the provider is in step the poll retires instead of running for
      // as long as the tab stays open.
      view.update({
        ...pendingSync(),
        synchronization: { status: 'current', lastSyncedAt: null }
      })
      await act(() => view.router.invalidate())
      const settled = view.billingLoads.mock.calls.length
      await act(() => vi.advanceTimersByTimeAsync(120_000))
      expect(view.billingLoads).toHaveBeenCalledTimes(settled)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits out a hidden tab and catches up when it comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const view = await renderBilling(pendingSync())
      setVisibility('hidden')
      await act(() => vi.advanceTimersByTimeAsync(60_000))
      expect(view.billingLoads).toHaveBeenCalledTimes(1)
      await act(async () => {
        setVisibility('visible')
        await Promise.resolve()
      })
      await waitFor(() => expect(view.billingLoads).toHaveBeenCalledTimes(2))
    } finally {
      setVisibility('visible')
      vi.useRealTimers()
    }
  })
})

describe('WorkspaceBillingPage route', () => {
  it('reconciles an authorized checkout return once and refreshes after success', async () => {
    const reconcile = vi.fn<ReconcileCheckout>(async () => ({
      workspaceId: 'wrk_starter',
      outcome: 'delayed',
      drift: ['provider_snapshot_missing']
    }))
    const view = await renderBilling(
      { ...fixture(), stripeConfigured: true },
      { checkoutReturn: true, reconcileCheckoutReturn: reconcile }
    )
    const invalidate = vi.spyOn(view.router, 'invalidate')
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(reconcile).toHaveBeenCalledWith({ data: { workspaceSlug: 'starter-lab' } })
  })

  it('shows pending and failure feedback for checkout reconciliation', async () => {
    const deferredReconcile = deferred<Awaited<ReturnType<ReconcileCheckout>>>()
    const reconcile = vi.fn<ReconcileCheckout>(() => deferredReconcile.promise)
    await renderBilling(
      { ...fixture(), stripeConfigured: true },
      { checkoutReturn: true, reconcileCheckoutReturn: reconcile }
    )
    await waitFor(() =>
      expect(screen.getByText(/billing updates are pending/i)).toBeTruthy()
    )
    deferredReconcile.resolve({
      workspaceId: 'wrk_starter',
      outcome: 'delayed',
      drift: ['provider_snapshot_missing']
    })
    await waitFor(() =>
      expect(screen.queryByText(/billing updates are pending/i)).toBeNull()
    )

    const failing = vi.fn<ReconcileCheckout>(async () => {
      throw new Error('reconcile failed')
    })
    await renderBilling(
      { ...fixture(), stripeConfigured: true },
      { checkoutReturn: true, reconcileCheckoutReturn: failing }
    )
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })

  it('does not reconcile a crafted return for an unpermitted viewer', async () => {
    const reconcile = vi.fn<ReconcileCheckout>(async () => ({
      workspaceId: 'wrk_starter',
      outcome: 'current',
      drift: []
    }))
    await renderBilling(
      { ...fixture(), stripeConfigured: true, viewer: { role: 'member' } },
      { checkoutReturn: true, reconcileCheckoutReturn: reconcile }
    )
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('keeps partially filled and full selections editable when pricing is unavailable', async () => {
    await renderBilling({ ...fixture(), stripeConfigured: true })
    expect(screen.getByText(/Plan pricing is temporarily unavailable/)).toBeTruthy()
    expect(checkbox('Token A').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(checkbox('Token B'))
    await saveSelection()
    expect(checkbox('Token B').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(checkbox('Token A'))
    fireEvent.click(checkbox('Token C'))
    await saveSelection()
    expect(save).toHaveBeenLastCalledWith({
      data: {
        workspaceSlug: 'starter-lab',
        apiTokenIds: ['B', 'C'],
        webhookEndpointIds: ['https://example.test/one']
      }
    })
    expect(checkbox('Token A').getAttribute('aria-checked')).toBe('false')
    expect(checkbox('Token C').getAttribute('aria-checked')).toBe('true')
  })

  it('can switch an already-selected webhook', async () => {
    await renderBilling()
    fireEvent.click(checkbox('https://example.test/one'))
    fireEvent.click(checkbox('https://example.test/two'))
    await saveSelection()
    expect(save).toHaveBeenLastCalledWith({
      data: {
        workspaceSlug: 'starter-lab',
        apiTokenIds: ['A'],
        webhookEndpointIds: ['https://example.test/two']
      }
    })
    expect(checkbox('https://example.test/two').getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('reads new inventory and selections after actual route invalidation without provider polling', async () => {
    const view = await renderBilling()
    view.update(
      withSelection(
        {
          ...view.read(),
          apiTokens: [
            { id: 'D', name: 'Token D' },
            { id: 'B', name: 'Token B' },
            { id: 'C', name: 'Token C' }
          ]
        },
        { apiTokenIds: ['D', 'C'], webhookEndpointIds: [] }
      )
    )
    await act(() => view.router.invalidate())
    expect(screen.queryByRole('checkbox', { name: 'Token A' })).toBeNull()
    expect(checkbox('Token D').getAttribute('aria-checked')).toBe('true')
    expect(checkbox('Token C').getAttribute('aria-checked')).toBe('true')
  })

  it('reloads the current replacement and deleted webhook after an in-flight save finishes', async () => {
    const view = await renderBilling()
    const pending = deferred<ResourceSelection>()
    save.mockImplementation(() => pending.promise)
    fireEvent.click(checkbox('Token B'))
    fireEvent.click(screen.getByRole('button', { name: /save selection/i }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(checkbox('Token B').getAttribute('aria-disabled')).toBe('true')
    )
    view.update(
      withSelection(
        {
          ...view.read(),
          apiTokens: [
            { id: 'D', name: 'Replacement D' },
            { id: 'B', name: 'Token B' },
            { id: 'C', name: 'Token C' }
          ],
          webhookEndpoints: [
            { id: 'https://example.test/two', url: 'https://example.test/two' }
          ]
        },
        { apiTokenIds: ['D', 'B'], webhookEndpointIds: [] }
      )
    )
    // Another loader refresh may arrive before the mutation response.
    await act(() => view.router.invalidate())
    pending.resolve({
      apiTokenIds: ['A', 'B'],
      webhookEndpointIds: ['https://example.test/one']
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /save selection/i }).hasAttribute('disabled')
      ).toBe(false)
    )
    expect(screen.queryByRole('checkbox', { name: 'Token A' })).toBeNull()
    expect(
      screen.queryByRole('checkbox', { name: 'https://example.test/one' })
    ).toBeNull()
    expect(checkbox('Replacement D').getAttribute('aria-checked')).toBe('true')
    expect(checkbox('Token B').getAttribute('aria-checked')).toBe('true')
  })

  it('explains partial restrictions to a member after terminal cancellation', async () => {
    await renderBilling({ ...fixture(), viewer: { role: 'member' } })
    expect(screen.getByText(/Some workspace features are restricted/)).toBeTruthy()
    expect(screen.getByText(/Contact an owner or admin/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /save selection/i })).toBeNull()
  })
})

const statuses: ReadonlyArray<{
  name: string
  status: BillingLifecycle['status']
  effectivePlan: string
  expected: RegExp
  cancelAtPeriodEnd?: boolean
}> = [
  {
    name: 'first incomplete payment',
    status: 'incomplete',
    effectivePlan: 'starter',
    expected: /Payment is still incomplete/
  },
  {
    name: 'expired renewal grace',
    status: 'past_due',
    effectivePlan: 'starter',
    expected: /Paid access is unavailable for this subscription/
  },
  {
    name: 'active without verified payment',
    status: 'active',
    effectivePlan: 'starter',
    expected: /Paid access is unavailable for this subscription/
  },
  {
    name: 'expired trial',
    status: 'trialing',
    effectivePlan: 'starter',
    expected: /Paid access is unavailable for this subscription/
  },
  {
    name: 'expired cancellation',
    status: 'active',
    effectivePlan: 'starter',
    cancelAtPeriodEnd: true,
    expected: /Paid access is unavailable for this subscription/
  },
  {
    name: 'provider unpaid with pending cancellation',
    status: 'unpaid',
    effectivePlan: 'starter',
    cancelAtPeriodEnd: true,
    expected: /Stripe marked this subscription unpaid/
  },
  {
    name: 'valid renewal grace',
    status: 'past_due',
    effectivePlan: 'team',
    expected: /Paid access remains available until/
  },
  {
    name: 'valid trial',
    status: 'trialing',
    effectivePlan: 'team',
    expected: /This verified trial ends/
  },
  {
    name: 'scheduled cancellation with paid access',
    status: 'active',
    effectivePlan: 'team',
    cancelAtPeriodEnd: true,
    expected: /Access continues until then/
  }
]

it.each(statuses)(
  'explains $name accurately through the page loader',
  async (scenario) => {
    const data = fixture()
    await renderBilling({
      ...data,
      currentPlanId: scenario.effectivePlan,
      lifecycle: {
        ...data.lifecycle,
        status: scenario.status,
        planId: 'team',
        cancelAtPeriodEnd: scenario.cancelAtPeriodEnd ?? false,
        graceEndsAt: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-09-02T00:00:00.000Z',
        trialEnd: '2026-09-02T00:00:00.000Z'
      }
    })
    expect(screen.getByText(scenario.expected)).toBeTruthy()
    if (scenario.status !== 'unpaid') {
      expect(screen.queryByText(/Stripe marked this subscription unpaid/)).toBeNull()
    }
  }
)
