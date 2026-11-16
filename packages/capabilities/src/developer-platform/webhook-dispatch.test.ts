import { SeedResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements.seed'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { BillingAuditLayer } from '../billing-adapters.ts'
import { SeedAuditEventLog } from '../governance/audit-event-log.ts'
import { SeedLayer } from '../layers.ts'
import { SeedAccountPreferences } from '../governance/account-preferences.ts'
import { SeedNotificationFeed } from '../notifications/notification-feed.seed.ts'
import { SeedNotificationPreferences } from '../notifications/notification-preferences.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { webhookDispatchContractCases } from './webhook-dispatch.contract.ts'
import { SeedWebhookPublisher } from './webhook-publisher.ts'
import { SeedWebhooks } from './webhooks.seed.ts'

// The Live half of this contract runs in webhook-endpoints.live.test.ts.
describe('seed webhook dispatch contract', () => {
  const auditLog = SeedAuditEventLog([])
  const notificationFeed = SeedNotificationFeed([]).pipe(
    Layer.provide(
      Layer.merge(
        SeedNotificationPreferences([]).pipe(Layer.provide(auditLog)),
        SeedAccountPreferences([]).pipe(Layer.provide(auditLog))
      )
    )
  )
  const layer = Layer.mergeAll(
    Layer.merge(auditLog, testWorkspaceContext(seedWorkspaceRecord)),
    SeedWebhooks([]).pipe(
      Layer.provide(auditLog),
      Layer.provide(SeedWebhookPublisher),
      Layer.provide(notificationFeed),
      Layer.provide(SeedLayer),
      Layer.provide(
        SeedResourceEntitlements().pipe(
          Layer.provide(BillingAuditLayer),
          Layer.provide(SeedLayer)
        )
      )
    ),
    notificationFeed
  )
  for (const contractCase of webhookDispatchContractCases(expect)) {
    it.effect(contractCase.name, () => contractCase.assert.pipe(Effect.provide(layer)))
  }
})
