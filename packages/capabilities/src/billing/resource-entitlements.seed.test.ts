import { type SubscriptionState } from '@b2b-saas-starter/billing/billing'
import { WebhookEndpoints } from '../developer-platform/webhook-endpoints.ts'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { failureTag } from '../internal/failure-tag.ts'
import { Array, Effect, Exit, Layer } from 'effect'
import { expect, it } from '@effect/vitest'
import { SeedAuditEventLog, AuditEventLog } from '../governance/audit-event-log.ts'
import { SeedNotificationFeed } from '../notifications/notification-feed.seed.ts'
import { SeedNotificationPreferences } from '../notifications/notification-preferences.ts'
import { SeedAccountPreferences } from '../governance/account-preferences.ts'
import { SeedApiTokenRegistry } from '../developer-platform/api-token-registry.seed.ts'
import { SeedWebhookEndpoints } from '../developer-platform/webhook-endpoints.seed.ts'
import { SeedWebhookPublisher } from '../developer-platform/webhook-publisher.ts'
import { ApiTokenRegistry } from '../developer-platform/api-token-registry.ts'
import { SeedLayer } from '../layers.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { BillingAuditLayer, BillingNotificationLayer } from '../billing-adapters.ts'
import { SeedBilling } from '@b2b-saas-starter/billing/billing.seed'
import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { SeedResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements.seed'
import {
  resourceEntitlementsContract,
  resourceAdmissionContract,
  resourceDeadlineCases
} from './resource-entitlements.contract.ts'

function seedFixture(
  state: Partial<SubscriptionState>,
  audit: Layer.Layer<AuditEventLog> = SeedAuditEventLog([])
) {
  const feed = SeedNotificationFeed([]).pipe(
    Layer.provide(
      Layer.merge(SeedNotificationPreferences([]), SeedAccountPreferences([])).pipe(
        Layer.provide(audit)
      )
    )
  )
  const billing = SeedBilling({
    subscriptions: [
      {
        workspaceId: seedWorkspaceRecord.id,
        customerId: 'cus_resources',
        subscriptionId: 'sub_resources',
        seatQuantity: 1,
        subscribedPlanId: 'team',
        ...state
      }
    ]
  }).pipe(
    Layer.provide(BillingAuditLayer.pipe(Layer.provide(audit))),
    Layer.provide(BillingNotificationLayer.pipe(Layer.provide(feed)))
  )
  const selection = SeedResourceEntitlements().pipe(
    Layer.provide(BillingAuditLayer),
    Layer.provide(billing),
    Layer.provide(audit)
  )
  return Layer.mergeAll(
    billing,
    selection,
    SeedApiTokenRegistry([]),
    SeedWebhookEndpoints([])
  ).pipe(
    Layer.provide(selection),
    Layer.provide(billing),
    Layer.provideMerge(audit),
    Layer.provide(feed),
    Layer.provide(SeedWebhookPublisher),
    Layer.provideMerge(testWorkspaceContext(seedWorkspaceRecord))
  )
}
for (const scenario of resourceDeadlineCases) {
  it.effect(`Seed resource authority after ${scenario.name}`, () =>
    resourceEntitlementsContract(expect).pipe(
      Effect.provide(seedFixture(scenario.state))
    )
  )
}
it.effect(
  'Seed resource admission releases token states and retains disabled webhook slots',
  () =>
    resourceAdmissionContract(expect).pipe(
      Effect.provide(
        seedFixture({
          status: 'active',
          paymentVerified: true,
          lastPaymentAt: '2026-09-01T00:00:00.000Z',
          subscribedPlanId: 'starter'
        })
      )
    )
)
it.effect(
  'Seed webhook admission serializes concurrent creates at the Starter cap',
  () =>
    Effect.gen(function* () {
      const endpoints = yield* WebhookEndpoints
      const outcomes = yield* Effect.all(
        [1, 2].map((id) =>
          Effect.exit(
            endpoints.create({
              url: `https://example.com/concurrent-${id}`,
              events: []
            })
          )
        ),
        { concurrency: 'unbounded' }
      )
      const successful = outcomes.filter(Exit.isSuccess)
      const failed = outcomes.filter(Exit.isFailure)
      expect(successful).toHaveLength(1)
      expect(failed).toHaveLength(1)
      expect(failureTag(Array.getUnsafe(failed, 0))).toBe('PlanLimitExceeded')
    }).pipe(
      Effect.provide(
        seedFixture({
          status: 'active',
          paymentVerified: true,
          lastPaymentAt: '2026-09-01T00:00:00.000Z',
          subscribedPlanId: 'starter'
        })
      )
    )
)
it.effect('full SeedLayer exposes the selection that rotation changes', () =>
  Effect.gen(function* () {
    const tokens = yield* ApiTokenRegistry
    const selection = yield* ResourceEntitlements
    const created = yield* tokens.create({
      name: 'dynamic inventory',
      scopes: ['read']
    })
    yield* selection.select({ apiTokenIds: [created.id], webhookEndpointIds: [] })
    const replaced = yield* tokens.replace({
      tokenId: created.id,
      scopes: ['read'],
      overlapSeconds: 0
    })
    expect((yield* selection.getSelection()).apiTokenIds).toEqual([replaced.id])
  }).pipe(
    Effect.provide(SeedLayer),
    Effect.provide(testWorkspaceContext(seedWorkspaceRecord))
  )
)

it.effect('Seed audit failure leaves selection unchanged', () =>
  Effect.gen(function* () {
    const selection = yield* ResourceEntitlements
    expect(
      failureTag(
        yield* Effect.exit(
          selection.select({ apiTokenIds: [], webhookEndpointIds: [] })
        )
      )
    ).toBe('CapabilityUnavailable')
    expect(yield* selection.getSelection()).toEqual({
      apiTokenIds: [],
      webhookEndpointIds: []
    })
  }).pipe(
    Effect.provide(
      seedFixture(
        { status: 'trialing', trialEnd: '2026-09-02T00:00:00.000Z' },
        Layer.mock(AuditEventLog, {
          record: () =>
            Effect.fail(
              new CapabilityUnavailable({
                capability: 'audit',
                reason: 'forced failure'
              })
            )
        })
      )
    )
  )
)
