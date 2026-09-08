import { expect, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { emailDeliveryContractCases } from '@b2b-saas-starter/email-delivery/email-delivery.contract'
import { LiveEmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery.live'
import { LIVE_SUITE_TIMEOUT, TestDatabase } from '../testing/live-harness.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('Live email delivery', (it) => {
  for (const test of emailDeliveryContractCases(expect)) {
    // The retention contract creates 502 messages through the public capability;
    // on a contended CI runner that setup can exceed the default test budget.
    it.effect(test.name, () => test.assert.pipe(Effect.provide(LiveEmailDelivery)), {
      timeout: 60_000
    })
  }
})
