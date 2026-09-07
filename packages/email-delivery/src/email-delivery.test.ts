import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { emailDeliveryContractCases } from './email-delivery.contract.ts'
import { SeedEmailDelivery } from './email-delivery.seed.ts'

for (const test of emailDeliveryContractCases(expect)) {
  it.effect(test.name, () => test.assert.pipe(Effect.provide(SeedEmailDelivery())))
}
