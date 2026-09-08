import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Effect, Layer } from 'effect'
import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  Billing,
  type BillingLifecycle,
  type BillingSynchronizationStatus
} from '@b2b-saas-starter/billing/billing'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  testWorkspaceContext,
  type WorkspaceContextInterface
} from '@b2b-saas-starter/capabilities/workspace-context'
import { planById } from '@b2b-saas-starter/billing/plan-catalog'

type TestState = { role: 'owner' | 'admin'; denyPermission: boolean }
const state = vi.hoisted<TestState>(() => ({ role: 'owner', denyPermission: false }))
const reconcileCalls = vi.hoisted<
  Array<{ workspaceId: string; reason: string | undefined }>
>(() => [])
const permissionCalls = vi.hoisted<Array<unknown>>(() => [])
const roles: ReadonlyArray<'owner' | 'admin'> = ['owner', 'admin']

vi.mock('./auth', () => ({
  requireRequestSession: async () => ({ user: { id: `usr_${state.role}` } })
}))

vi.mock('./authorize', () => ({
  requireWorkspacePermission: (permission: unknown) => {
    permissionCalls.push(permission)
    if (state.denyPermission) {
      return Effect.fail(new AuthorizationDenied({ reason: 'insufficient_permission' }))
    }
    return Effect.succeed(undefined)
  },
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
        Effect.succeed({ url: 'https://billing.stripe.com/p/session/test' }),
      reconcileWorkspace: (input) => {
        reconcileCalls.push({ workspaceId: input.workspaceId, reason: input.reason })
        return Effect.succeed({
          workspaceId: input.workspaceId,
          outcome: 'delayed',
          drift: ['provider_snapshot_missing']
        })
      }
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
    const contextLayer = testWorkspaceContext(
      context.workspace,
      context.actor,
      context.actorType
    )
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

const {
  loadWorkspaceBillingHandler,
  startPortalSessionHandler,
  reconcileCheckoutReturnHandler
} = await import('./billing.effects')

describe('billing loader recovery controls', () => {
  beforeEach(() => {
    state.role = 'owner'
    state.denyPermission = false
    reconcileCalls.length = 0
    permissionCalls.length = 0
  })

  it('reconciles the verified workspace on checkout return', async () => {
    await expect(
      reconcileCheckoutReturnHandler({ workspaceSlug: 'starter-lab' })
    ).resolves.toMatchObject({ outcome: 'delayed' })
    expect(reconcileCalls).toEqual([
      { workspaceId: 'wrk_starter', reason: 'checkout_return' }
    ])
    expect(permissionCalls).toEqual([{ organization: ['update'] }])
  })

  it('does not reconcile when the workspace permission is denied', async () => {
    state.denyPermission = true
    await expect(
      reconcileCheckoutReturnHandler({ workspaceSlug: 'starter-lab' })
    ).rejects.toMatchObject({ _tag: 'AuthorizationDenied' })
    expect(reconcileCalls).toEqual([])
  })

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
