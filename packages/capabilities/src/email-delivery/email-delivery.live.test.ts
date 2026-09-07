import { expect, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { emailDeliveryContractCases } from './email-delivery.contract.ts'
import { LiveEmailDelivery } from './email-delivery.live.ts'
import { LIVE_SUITE_TIMEOUT, TestDatabase } from '../testing/live-harness.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('Live email delivery', (it) => {
  for (const test of emailDeliveryContractCases(expect)) {
    it.effect(test.name, () => test.assert.pipe(Effect.provide(LiveEmailDelivery)))
  }
})
