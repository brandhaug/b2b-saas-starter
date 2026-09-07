import { expect, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { emailDeliveryContractCases } from './email-delivery.contract.ts'
import { LiveEmailDelivery } from './email-delivery.live.ts'
import { LIVE_SUITE_TIMEOUT, TestDatabase } from '../testing/live-harness.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('Live email delivery', (it) => {
  for (const test of emailDeliveryContractCases(expect)) {
    // The retention contract creates 502 messages through the public capability.
    it.effect(test.name, () => test.assert.pipe(Effect.provide(LiveEmailDelivery)), {
      timeout: 30_000
    })
  }
})
