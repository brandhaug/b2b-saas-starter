// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingJourney } from '@b2b-saas-starter/capabilities/booking'
import { BookingSelectionFlow } from './booking-selection-flow.tsx'

const teamJourney: BookingJourney = {
  version: 1,
  presentation: 'team',
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
    premiumPaletteSource: null
  },
  catalogRecovery: null,
  reconciliation: [],
  providerPreference: null,
  selection: { primaryServiceId: null, additionalServiceIds: [] },
  compatibleAdditionalServiceIds: [],
  providers: [
    {
      id: 'prv_ava',
      displayName: 'Ava S.',
      isDefault: true,
      access: 'public',
      eligibleServiceIds: ['svc_cut', 'svc_beard']
    },
    {
      id: 'prv_noah',
      displayName: 'Noah B.',
      isDefault: false,
      access: 'public',
      eligibleServiceIds: ['svc_cut']
    }
  ],
  services: [
    {
      id: 'svc_cut',
      name: 'Signature Cut',
      category: 'Haircuts',
      priceMinor: 4500,
      currency: 'USD',
      durationMinutes: 45,
      eligibleProviderIds: ['prv_ava', 'prv_noah']
    },
    {
      id: 'svc_beard',
      name: 'Beard Trim',
      category: 'Grooming',
      priceMinor: 2800,
      currency: 'USD',
      durationMinutes: 30,
      eligibleProviderIds: ['prv_ava']
    },
    {
      id: 'svc_noah',
      name: 'Noah Exclusive',
      category: 'Consultations',
      priceMinor: 1500,
      currency: 'USD',
      durationMinutes: 15,
      eligibleProviderIds: ['prv_noah']
    }
  ]
}

afterEach(cleanup)

describe('Booking selection flow', () => {
  it('offers Specific Provider and Any Provider choices for Team journeys', () => {
    const chooseProvider = vi.fn()
    render(
      <BookingSelectionFlow
        journey={teamJourney}
        busy={false}
        onChooseProvider={chooseProvider}
        onChooseServices={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /any professional/i }))
    fireEvent.click(screen.getByRole('button', { name: /ava s\./i }))
    expect(chooseProvider).toHaveBeenNthCalledWith(1, { kind: 'any' })
    expect(chooseProvider).toHaveBeenNthCalledWith(2, {
      kind: 'specific',
      providerId: 'prv_ava'
    })
  })

  it('switches Shops, disables restricted Providers, and applies resolved premium color', () => {
    const chooseShop = vi.fn()
    const journey: BookingJourney = {
      ...teamJourney,
      shops: [
        ...teamJourney.shops,
        {
          id: 'shp_river',
          slug: 'river',
          name: 'Riverside',
          localizedName: {
            text: 'Riverside',
            locale: 'en',
            isSourceLanguageFallback: true
          }
        }
      ],
      resolvedConfiguration: {
        ...teamJourney.resolvedConfiguration,
        premiumPalette: {
          primaryColor: '#111111',
          primaryDark: '#121212',
          primaryDarker: '#131313',
          primaryLight: '#141414',
          primaryFontColor: '#ffffff',
          secondaryColor: '#151515',
          linkColor: '#161616'
        },
        premiumPaletteSource: 'shop'
      },
      providers: [
        ...teamJourney.providers,
        {
          id: 'prv_private',
          displayName: 'Private Pro',
          isDefault: false,
          access: 'restricted',
          eligibleServiceIds: ['svc_cut']
        }
      ]
    }
    const { container } = render(
      <BookingSelectionFlow
        journey={journey}
        busy={false}
        onChooseShop={chooseShop}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Shop' }), {
      target: { value: 'shp_river' }
    })
    expect(chooseShop).toHaveBeenCalledWith('shp_river')
    expect(
      screen.getByRole('option', { name: /riverside.*original language/i })
    ).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: /private pro.*private access/i })
        .hasAttribute('disabled')
    ).toBe(true)
    expect(
      container.querySelector('[data-premium="true"]')?.getAttribute('style')
    ).toContain('#111111')
  })

  it('skips Provider choice for Solo, hands off to Additional Services, and opens the full order summary', () => {
    const chooseServices = vi.fn()
    const continueToTime = vi.fn()
    const selected: BookingJourney = {
      ...teamJourney,
      presentation: 'solo',
      providerPreference: { kind: 'specific', providerId: 'prv_ava' },
      selection: { primaryServiceId: 'svc_cut', additionalServiceIds: [] },
      compatibleAdditionalServiceIds: ['svc_beard']
    }
    render(
      <BookingSelectionFlow
        journey={selected}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={chooseServices}
        onContinue={continueToTime}
      />
    )

    expect(screen.queryByText('Choose a professional')).toBeNull()
    expect(screen.getByText('Anything you wish to add?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /remove signature cut/i }))
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: null,
      additionalServiceIds: []
    })
    fireEvent.click(screen.getByRole('button', { name: /beard trim/i }))
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: 'svc_cut',
      additionalServiceIds: ['svc_beard']
    })
    fireEvent.click(screen.getByRole('button', { name: /view order/i }))
    expect(screen.getByRole('dialog', { name: /order summary/i })).toBeTruthy()
    expect(screen.getAllByText('$45.00').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Choose time' }))
    expect(continueToTime).toHaveBeenCalledOnce()
  })

  it('renders the no-services path without advancing', () => {
    const { rerender } = render(
      <BookingSelectionFlow
        journey={{ ...teamJourney, providers: [], services: [] }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    expect(screen.getByText('No services are bookable')).toBeTruthy()
    rerender(
      <BookingSelectionFlow
        journey={{
          ...teamJourney,
          providers: [],
          services: [],
          catalogRecovery: 'invalid_associations'
        }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    expect(screen.getByText(/cannot currently be booked together/i)).toBeTruthy()
  })

  it('does not offer Any Provider services that only restricted Providers can perform', () => {
    render(
      <BookingSelectionFlow
        journey={{
          ...teamJourney,
          providerPreference: { kind: 'any' },
          providers: [
            {
              id: 'prv_private',
              displayName: 'Private Pro',
              isDefault: true,
              access: 'restricted',
              eligibleServiceIds: ['svc_private']
            }
          ],
          services: [
            {
              id: 'svc_private',
              name: 'Private Service',
              category: null,
              priceMinor: 5000,
              currency: 'USD',
              durationMinutes: 30,
              eligibleProviderIds: ['prv_private']
            }
          ]
        }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    expect(screen.getByText('No services are bookable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Private Service' })).toBeNull()
  })

  it('filters by category and hides Additional Services incompatible with Any Provider', () => {
    const anyJourney: BookingJourney = {
      ...teamJourney,
      providerPreference: { kind: 'any' }
    }
    const { rerender } = render(
      <BookingSelectionFlow
        journey={anyJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    fireEvent.change(screen.getByRole('combobox', { name: /service category/i }), {
      target: { value: 'category:1' }
    })
    expect(screen.getByRole('button', { name: 'Beard Trim' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Signature Cut' })).toBeNull()

    rerender(
      <BookingSelectionFlow
        journey={{
          ...anyJourney,
          selection: { primaryServiceId: 'svc_beard', additionalServiceIds: [] },
          compatibleAdditionalServiceIds: []
        }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /noah exclusive/i })).toBeNull()
  })
})
