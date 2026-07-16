import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  emptySeedSchedulingStore,
  SeedBookingPublication
} from '@b2b-saas-starter/capabilities/scheduling'
import { buildSeedBookingScenario } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { resolvePublicBookingPage } from './public-booking-page.ts'
import { isBookingRequest } from './booking-dispatch.ts'
import {
  GenericNotFoundPage,
  PublishedMerchantPage,
  UnavailableMerchantPage
} from '../routes/$merchantSlug.tsx'

const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')

describe('Public Booking Page resolution', () => {
  it('resolves publication states and renders merchant presentation contracts', async () => {
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
    const presentation = render(
      <PublishedMerchantPage
        page={published.page}
        merchantSlug={scenario.merchant.slug}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Precision grooming, made personal' })
    ).toBeTruthy()
    expect(screen.queryByText('7 signature services')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Services' })).toBeNull()
    expect(screen.queryByText('Signature Cut')).toBeNull()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.getByText('Open for appointments')).toBeTruthy()
    expect(screen.getByText('By appointment')).toBeTruthy()
    expect(screen.getByText('Studio team')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open studio gallery' }))
    const gallery = screen.getByRole('dialog', { name: 'Studio gallery' })
    expect(gallery).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Client with a fresh cut' })).toBeTruthy()
    fireEvent.keyDown(gallery, { key: 'ArrowLeft' })
    expect(screen.getByRole('img', { name: 'Precision haircut detail' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close gallery' }))

    fireEvent.click(screen.getByRole('button', { name: 'Open location map' }))
    expect(screen.getByRole('dialog', { name: 'Studio location' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close location map' }))

    const cta = screen.getByRole('link', { name: 'View booking times' })
    expect(cta.getAttribute('href')).toBe('/mara-booking-studio/booking')
    expect(
      isBookingRequest(new URL(cta.getAttribute('href')!, 'https://public.test'))
    ).toBe(true)
    expect(cta).toBeInstanceOf(HTMLAnchorElement)

    presentation.unmount()
    render(
      <PublishedMerchantPage
        page={{
          ...published.page,
          merchantSlug: 'another-studio',
          bookingPath: '/another-studio/booking'
        }}
        merchantSlug="another-studio"
      />
    )
    expect(
      screen.getByRole('heading', { name: scenario.merchant.publicName })
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Book an appointment' })).toBeTruthy()
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
