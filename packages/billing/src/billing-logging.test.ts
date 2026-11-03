import { expect, it } from '@effect/vitest'
import { Effect, Layer, Logger } from 'effect'
import { withRequestScope } from '@b2b-saas-starter/logger'
import { diagnosticAnnotations } from '@b2b-saas-starter/logger/sanitization'
import { Billing } from './billing.ts'
import { SeedBilling } from './billing.seed.ts'
import { AuditEventLog, BillingWebhookPublisher, NotificationFeed } from './ports.ts'

it.effect('records the resolved plan on one canonical billing request event', () => {
  const records: Array<unknown> = []
  const capture = Logger.layer([
    Logger.map(Logger.formatStructured, (record) =>
      records.push(diagnosticAnnotations(record.annotations))
    )
  ])
  return Effect.gen(function* () {
    const billing = yield* Billing
    const plan = yield* withRequestScope(
      { service: 'web', event: 'billing.plan' },
      billing.currentPlanForWorkspace('wrk_logging')
    )
    expect(plan.id).toBe('team')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      workspaceId: 'wrk_logging',
      plan: 'team',
      status: 'ok'
    })
  }).pipe(
    Effect.provide(
      SeedBilling({ workspacePlans: { wrk_logging: 'team' } }).pipe(
        Layer.provide(Layer.mock(AuditEventLog, {})),
        Layer.provide(Layer.mock(NotificationFeed, {})),
        Layer.provide(Layer.mock(BillingWebhookPublisher, {}))
      )
    ),
    Effect.provide(capture)
  )
})
