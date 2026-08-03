// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingJourney } from '@b2b-saas-starter/capabilities/booking'
import { BookingSelectionFlow } from './booking-selection-flow.tsx'

const soloJourney: BookingJourney = {
  version: 1,
  presentation: 'solo',
  shopId: 'shp_main',
  shops: [{ id: 'shp_main', slug: 'main', name: 'Main Shop' }],
  resolvedConfiguration: {
    merchantName: {
      text: 'Merchant',
      locale: 'en',
      isSourceLanguageFallback: false
    },
    brandName: { text: 'Brand', locale: 'en', isSourceLanguageFallback: false },
    shopName: {
      text: 'Main Shop',
      locale: 'en',
      isSourceLanguageFallback: false
    },
    premiumPalette: null,
    premiumPaletteSource: null,
    adultsOnly: false
  },
  catalogRecovery: null,
  reconciliation: [],
  providerPreference: { kind: 'specific', providerId: 'prv_owner' },
  selection: { primaryServiceId: null, additionalServiceIds: [] },
  compatibleAdditionalServiceIds: [],
  canSellUnassignedGiftCard: false,
  providers: [
    {
      id: 'prv_owner',
      displayName: 'Mara Ionescu',
      shortName: 'Mara I.',
      isDefault: true,
      access: 'public',
      eligibleServiceIds: ['svc_cut', 'svc_beard']
    }
  ],
  services: [
    {
      id: 'svc_cut',
      name: 'Signature Cut',
      description: 'A precise cut, wash, and style.',
      category: 'Haircuts',
      priceMinor: 4500,
      currency: 'USD',
      durationMinutes: 45,
      eligibleProviderIds: ['prv_owner']
    },
    {
      id: 'svc_beard',
      name: 'Beard Trim',
      category: 'Grooming',
      priceMinor: 2800,
      currency: 'USD',
      durationMinutes: 30,
      eligibleProviderIds: ['prv_owner']
    }
  ]
}

afterEach(cleanup)

describe('Booking selection flow', () => {
  it('starts at Services without rendering Provider choice controls', () => {
    render(
      <BookingSelectionFlow
        journey={soloJourney}
        busy={false}
        onChooseServices={vi.fn()}
      />
    )

    expect(screen.getByText('Choose a service')).toBeTruthy()
    expect(screen.queryByText('Choose a professional')).toBeNull()
    expect(screen.queryByRole('button', { name: /any professional/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /mara/i })).toBeNull()
  })

  it('submits the selected Service against the server-bound Owner-Provider', () => {
    const chooseServices = vi.fn()
    render(
      <BookingSelectionFlow
        journey={soloJourney}
        busy={false}
        onChooseServices={chooseServices}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Signature Cut' }))
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: 'svc_cut',
      additionalServiceIds: []
    })
  })

  it('supports compatible Additional Services and a complete order summary', () => {
    const chooseServices = vi.fn()
    const selected: BookingJourney = {
      ...soloJourney,
      selection: { primaryServiceId: 'svc_cut', additionalServiceIds: [] },
      compatibleAdditionalServiceIds: ['svc_beard']
    }
    render(
      <BookingSelectionFlow
        journey={selected}
        busy={false}
        onChooseServices={chooseServices}
        onContinue={vi.fn()}
      />
    )

    expect(screen.getByText('Anything you wish to add?')).toBeTruthy()
    fireEvent.click(screen.getByTestId('service:svc_beard'))
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: 'svc_cut',
      additionalServiceIds: ['svc_beard']
    })
    fireEvent.click(screen.getByTestId('btn:viewOrder'))
    const cart = screen.getByRole('dialog', { name: /order summary/i })
    expect(within(cart).getByTestId('text:cart:subtotal').textContent).toBe('$45.00')
  })

  it('renders an explicit empty-catalog recovery state', () => {
    render(
      <BookingSelectionFlow
        journey={{ ...soloJourney, providers: [], services: [] }}
        busy={false}
        onChooseServices={vi.fn()}
      />
    )

    expect(screen.getByText('No services are bookable')).toBeTruthy()
  })
})
