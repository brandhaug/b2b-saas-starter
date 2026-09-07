import { describe, expect, it, vi } from 'vite-plus/test'
import { Effect, Layer } from 'effect'
import {
  Billing,
  type BillingLifecycle,
  type BillingSynchronizationStatus
} from '@b2b-saas-starter/capabilities/billing/billing'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { ResourceEntitlements } from '@b2b-saas-starter/capabilities/billing/resource-entitlements'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  WorkspaceContext,
  type WorkspaceContextInterface
} from '@b2b-saas-starter/capabilities/workspace-context'
import { planById } from '@b2b-saas-starter/capabilities/billing/plan-catalog'

type TestState = { role: 'owner' | 'admin' }
const state = vi.hoisted<TestState>(() => ({ role: 'owner' }))
const roles: ReadonlyArray<'owner' | 'admin'> = ['owner', 'admin']

vi.mock('./auth', () => ({
  requireRequestSession: async () => ({ user: { id: `usr_${state.role}` } })
}))

vi.mock('./authorize', () => ({
  requireWorkspacePermission: () => Effect.succeed(undefined),
  whenPermitted: (_permission: unknown, effect: Effect.Effect<unknown>) => effect
}))

vi.mock('../capabilities', () => ({
  runWorkspaceCapabilities: async (_slug: string, effect: Effect.Effect<unknown>) => {
    const context = {
      workspace: {
        id: 'wrk_starter',
        slug: 'starter-lab',
        name: 'Starter Lab',
        planId: 'team'
      },
      actor: {
        userId: `usr_${state.role}`,
        role: state.role,
        systemRole: state.role === 'owner' ? 'admin' : 'user'
      },
      actorType: 'user'
    } satisfies WorkspaceContextInterface
    const billing = Layer.mock(Billing, {
      configured: Effect.succeed(true),
      currentPlan: Effect.succeed(planById('starter')),
      synchronizationStatus: Effect.succeed({
        status: 'current',
        lastSyncedAt: null
      } satisfies BillingSynchronizationStatus),
      lifecycleStatus: Effect.succeed({
        status: 'unpaid',
        planId: 'team',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        graceEndsAt: null
      } satisfies BillingLifecycle),
      displayedPlans: Effect.fail(
        new CapabilityUnavailable({
          capability: 'billing',
          reason: 'price_lookup_failed'
        })
      ),
      startPortalSession: (_input: { readonly returnUrl: string }) =>
        Effect.succeed({ url: 'https://billing.stripe.com/p/session/test' })
    })
    const resources = Layer.mock(ResourceEntitlements, {
      getSelection: () => Effect.succeed({ apiTokenIds: [], webhookEndpointIds: [] }),
      summarize: ({
        resource
      }: {
        readonly resource: 'api_token' | 'webhook_endpoint'
      }) =>
        Effect.succeed({
          resource,
          limit: resource === 'api_token' ? 2 : 1,
          used: 0,
          eligibleIds: [],
          selectedIds: [],
          activeIds: [],
          paused: false,
          requiresSelection: false
        })
    })
    const tokens = Layer.mock(ApiTokenRegistry, { list: Effect.succeed([]) })
    const webhooks = Layer.mock(WebhookEndpoints, { list: Effect.succeed([]) })
    const feed = Layer.mock(NotificationFeed, { unreadCount: Effect.succeed(0) })
    const contextLayer = Layer.succeed(WorkspaceContext, context)
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- this mock is the Promise boundary replacing runWorkspaceCapabilities
    return Effect.runPromise(
      Effect.scoped(
        effect.pipe(
          Effect.provide(
            Layer.mergeAll(billing, resources, tokens, webhooks, feed, contextLayer)
          )
        )
      )
    )
  }
}))

const { loadWorkspaceBillingHandler, startPortalSessionHandler } =
  await import('./billing.effects')

describe('billing loader recovery controls', () => {
  it.each(roles)(
    'renders the billing payload when provider pricing fails for %s',
    async (role) => {
      state.role = role
      const payload = await loadWorkspaceBillingHandler({
        workspaceSlug: 'starter-lab'
      })
      expect(payload.pricingUnavailable).toBe(true)
      expect(payload.plans).toEqual([])
      expect(payload.currentPlanId).toBe('starter')
    }
  )

  it.each(roles)('keeps the portal handoff available for %s', async (role) => {
    state.role = role
    await expect(
      startPortalSessionHandler({ workspaceSlug: 'starter-lab' })
    ).resolves.toEqual({ url: 'https://billing.stripe.com/p/session/test' })
  })
})
