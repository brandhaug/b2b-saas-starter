import { Effect, Layer, Ref } from 'effect'
import { expect, it } from '@effect/vitest'
import { SeedAuditEventLog } from '../governance/audit-event-log.ts'
import { SeedAccountPreferences } from '../governance/account-preferences.ts'
import { SeedNotificationFeed } from '../notifications/notification-feed.seed.ts'
import { SeedNotificationPreferences } from '../notifications/notification-preferences.ts'
import { Billing } from './billing.ts'
import { SeedBilling, type SeedProviderSubscriptionFixture } from './billing.seed.ts'
import { initialSnapshot, lifecycleContract } from './billing-lifecycle.contract.ts'

it.effect('Seed reconciles the full lifecycle and enforces deadlines on reads', () =>
  Effect.gen(function* () {
    const providerState = yield* Ref.make<
      ReadonlyMap<string, SeedProviderSubscriptionFixture>
    >(new Map())
    const audit = SeedAuditEventLog([])
    const feed = SeedNotificationFeed([]).pipe(
      Layer.provide(
        Layer.merge(SeedNotificationPreferences([]), SeedAccountPreferences([]))
      ),
      Layer.provide(audit)
    )
    const billingLayer = SeedBilling({ stripeConfigured: true, providerState }).pipe(
      Layer.provide(audit),
      Layer.provide(feed)
    )
    yield* Effect.gen(function* () {
      const billing = yield* Billing
      yield* lifecycleContract(expect, {
        set: (snapshot) =>
          Ref.set(
            providerState,
            new Map([
              [
                'wrk_lifecycle',
                {
                  workspaceId: 'wrk_lifecycle',
                  customerId: 'cus_lifecycle',
                  subscriptionId: 'sub_lifecycle',
                  subscriptionItemId: 'si_lifecycle',
                  seatQuantity: 0,
                  ...initialSnapshot,
                  ...snapshot
                }
              ]
            ])
          ),
        sync: (eventId) =>
          billing
            .processProviderEvent({
              workspaceId: 'wrk_lifecycle',
              providerEventId: eventId,
              eventType: 'customer.subscription.updated'
            })
            .pipe(Effect.asVoid),
        plan: billing
          .currentPlanForWorkspace('wrk_lifecycle')
          .pipe(Effect.map((plan) => plan.id)),
        grace: billing.lifecycleStatus.pipe(
          Effect.provide(
            testWorkspaceContext({
              id: 'wrk_lifecycle',
              slug: 'lifecycle',
              name: 'Lifecycle',
              planId: 'starter'
            })
          ),
          Effect.map((state) => state.graceEndsAt)
        )
      })
    }).pipe(Effect.provide(billingLayer))
  })
)
import { testWorkspaceContext } from '../workspace-context.ts'
