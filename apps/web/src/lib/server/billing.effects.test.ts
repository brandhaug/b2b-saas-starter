import { type WorkspaceId } from '@b2b-saas-starter/db/ids'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Effect, Layer } from 'effect'
import { withWideEventFacts } from '@b2b-saas-starter/logger'
import {
  Billing,
  type BillingLifecycle,
  type BillingSynchronizationStatus
} from '@b2b-saas-starter/billing/billing'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { seedMembers } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  testResolvedWorkspaceContext,
  type WorkspaceContextInterface
} from '@b2b-saas-starter/capabilities/workspace-context'
import { planById } from '@b2b-saas-starter/billing/plan-catalog'

type Role = 'owner' | 'admin' | 'member'
type TestState = { role: Role; facts: Readonly<Record<string, unknown>> }
const state = vi.hoisted<TestState>(() => ({ role: 'owner', facts: {} }))
const reconcileCalls = vi.hoisted<
  Array<{ workspaceId: WorkspaceId; reason: string | undefined }>
>(() => [])
const portalReturnUrls = vi.hoisted<Array<string>>(() => [])
const suspensionOperations = vi.hoisted<Array<string>>(() => [])
const roles: ReadonlyArray<'owner' | 'admin'> = ['owner', 'admin']

// The real permission guard runs; only the session read and the deployment's
// base URL are fixed here.
vi.mock('./auth', async () => {
  const effect = await import('effect')
  function session() {
    return {
      user: { id: `usr_${state.role}` },
      session: { id: `ses_${state.role}` }
    }
  }
  return {
    requireRequestSession: async () => session(),
    requireRequestSessionEffect: effect.Effect.sync(session)
  }
})

vi.mock('cloudflare:workers', async (importOriginal) => {
  const original = await importOriginal<{ readonly env: object }>()
  return {
    ...original,
    env: { ...original.env, BETTER_AUTH_URL: 'https://app.example.test/' }
  }
})

vi.mock('../capabilities', () => ({
  runWorkspaceCapabilities: async (_slug: string, effect: Effect.Effect<unknown>) => {
    const ids = await import('@b2b-saas-starter/db/ids')
    const context = {
      workspace: {
        id: ids.WorkspaceId.make('wrk_starter'),
        slug: 'starter-lab',
        name: 'Starter Lab',
        planId: 'team'
      },
      actor: {
        userId: ids.UserId.make(`usr_${state.role}`),
        role: state.role,
        systemRole: state.role === 'owner' ? 'admin' : 'user',
        banned: false
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
        interval: null,
        access: { planId: 'starter', paid: false, reason: 'unpaid', endsAt: null },
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
          reason: 'price_not_configured'
        })
      ),
      startPortalSession: (input: { readonly returnUrl: string }) =>
        Effect.sync(() => {
          portalReturnUrls.push(input.returnUrl)
          return { url: 'https://billing.stripe.com/p/session/test' }
        }),
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
      getSelection: Effect.succeed({ apiTokenIds: [], webhookEndpointIds: [] }),
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
          paused: false
        })
    })
    const tokens = Layer.mock(ApiTokenRegistry, { list: Effect.succeed([]) })
    const webhooks = Layer.mock(WebhookEndpoints, { list: Effect.succeed([]) })
    const membership = Layer.mock(WorkspaceMembership, {
      listMembers: Effect.succeed(seedMembers)
    })
    const feed = Layer.mock(NotificationFeed, { unreadCount: Effect.succeed(0) })
    const authentication = Layer.mock(StrongAuthentication, {
      require: () => Effect.void,
      requireRecent: () => Effect.void
    })
    const suspension = Layer.mock(WorkspaceSuspensionService, {
      requireAllowed: (_workspaceId, operation) =>
        Effect.sync(() => {
          suspensionOperations.push(operation)
        })
    })
    const contextLayer = testResolvedWorkspaceContext(context)
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- this mock is the Promise boundary replacing runWorkspaceCapabilities
    return Effect.runPromise(
      Effect.scoped(
        withWideEventFacts(effect, (facts) =>
          Effect.sync(() => {
            state.facts = { ...facts }
          })
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              billing,
              resources,
              tokens,
              webhooks,
              membership,
              feed,
              authentication,
              suspension,
              contextLayer
            )
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
    state.facts = {}
    reconcileCalls.length = 0
    portalReturnUrls.length = 0
    suspensionOperations.length = 0
  })

  it('reconciles the verified workspace on checkout return', async () => {
    await expect(
      reconcileCheckoutReturnHandler({ workspaceSlug: 'starter-lab' })
    ).resolves.toMatchObject({ outcome: 'delayed' })
    expect(reconcileCalls).toEqual([
      { workspaceId: 'wrk_starter', reason: 'checkout_return' }
    ])
  })

  it('does not reconcile for a member without organization:update', async () => {
    state.role = 'member'
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
      expect(state.facts).toMatchObject({
        billingOutcome: 'pricing_unavailable',
        billingFailureReason: 'price_not_configured'
      })
      expect(payload.currentPlanId).toBe('starter')
      expect(payload.seatUsage.used).toBe(seedMembers.length)
    }
  )

  it.each(roles)(
    'hands %s to the portal with a server-composed return URL under billing recovery',
    async (role) => {
      state.role = role
      await expect(
        startPortalSessionHandler({ workspaceSlug: 'starter-lab' })
      ).resolves.toEqual({ url: 'https://billing.stripe.com/p/session/test' })
      expect(portalReturnUrls).toEqual([
        'https://app.example.test/workspaces/starter-lab/billing'
      ])
      expect(suspensionOperations).toEqual(['billing_recovery'])
    }
  )

  it('refuses the portal handoff to a member without organization:update', async () => {
    state.role = 'member'
    await expect(
      startPortalSessionHandler({ workspaceSlug: 'starter-lab' })
    ).rejects.toMatchObject({ _tag: 'AuthorizationDenied' })
    expect(portalReturnUrls).toEqual([])
  })
})
