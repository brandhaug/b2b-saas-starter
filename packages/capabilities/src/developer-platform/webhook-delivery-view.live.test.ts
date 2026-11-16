import { expect, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { Database } from '@b2b-saas-starter/db/service'
import {
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema/developer-platform'
import { TestDatabase, LIVE_SUITE_TIMEOUT } from '../testing/live-harness.ts'
import { makeLiveCapabilitiesLayer } from '../layers.ts'
import { adminDeliveryFixtures } from './webhook-endpoints.admin.contract.ts'
import {
  deliveryViewEndpoints,
  deliveryViewFilterContract
} from './webhook-delivery-view.contract.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'Live delivery view filters',
  (it) => {
    it.effect('interprets filters with the shared table-filter semantics', () =>
      Effect.gen(function* () {
        const db = yield* Database
        for (const endpoint of deliveryViewEndpoints) {
          yield* db.insert(webhookEndpoints).values({
            ...endpoint,
            signingSecret: 'whsec_view_test',
            createdAt: '2026-09-01T00:00:00.000Z'
          })
        }
        yield* db.insert(webhookDeliveries).values(adminDeliveryFixtures)
        yield* deliveryViewFilterContract(expect).pipe(
          Effect.provide(makeLiveCapabilitiesLayer())
        )
      })
    )
  }
)
