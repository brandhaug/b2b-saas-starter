import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  buildSeedBookingScenario,
  emptySeedSchedulingStore,
  SeedBookingPublication
} from '@b2b-saas-starter/capabilities'
import { resolvePublicBookingPage } from './public-booking-page.ts'
import { isBookingRequest } from './booking-dispatch.ts'
import {
  GenericNotFoundPage,
  PublishedMerchantPage,
  UnavailableMerchantPage
} from '../routes/$merchantSlug.tsx'

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

    if (published.kind !== 'published') throw new Error('expected published page')
    render(<PublishedMerchantPage page={published.page} />)
    const cta = screen.getByRole('link', { name: 'Book an appointment' })
    expect(cta.getAttribute('href')).toBe('/mara-booking-studio/booking')
    expect(
      isBookingRequest(new URL(cta.getAttribute('href')!, 'https://public.test'))
    ).toBe(true)
    expect(cta).toBeInstanceOf(HTMLAnchorElement)
  })

  it('renders unavailable noindex and generic 404 variants', () => {
    const unavailable = render(<UnavailableMerchantPage />)
    expect(screen.getByText('Bookings are currently unavailable')).toBeTruthy()
    expect(
      document.head.querySelector('meta[name="robots"]')?.getAttribute('content')
    ).toBe('noindex')
    unavailable.unmount()
    render(<GenericNotFoundPage />)
    expect(screen.getByRole('heading', { name: '404' })).toBeTruthy()
  })
})
