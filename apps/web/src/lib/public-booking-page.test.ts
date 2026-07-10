import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  buildSeedBookingScenario,
  emptySeedSchedulingStore,
  SeedBookingPublication
} from '@b2b-saas-starter/capabilities'
import { resolvePublicBookingPage } from './public-booking-page.ts'

const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')

describe('Public Booking Page resolution', () => {
  it('distinguishes published, unpublished, and unknown slugs', async () => {
    const store = emptySeedSchedulingStore(scenario)
    const layer = SeedBookingPublication(store)
    const published = await Effect.runPromise(
      Effect.provide(resolvePublicBookingPage(scenario.merchant.slug), layer)
    )
    store.pageStatus = 'unpublished'
    const unpublished = await Effect.runPromise(
      Effect.provide(resolvePublicBookingPage(scenario.merchant.slug), layer)
    )
    const unknown = await Effect.runPromise(
      Effect.provide(resolvePublicBookingPage('unknown'), layer)
    )

    expect(published.kind).toBe('published')
    expect(unpublished).toEqual({ kind: 'unpublished' })
    expect(unknown).toEqual({ kind: 'unknown' })
  })
})
