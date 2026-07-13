// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('uses the legacy WidgetTitleContainer DOM contract', () => {
    const { container } = render(
      <BookingSelectionFlow
        journey={teamJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    const titleContainer = screen.getByTestId('container:title')
    const scrollable = screen.getByTestId('container:scrollable')
    expect(titleContainer.tagName).toBe('DIV')
    expect(scrollable.tagName).toBe('DIV')
    expect(container.querySelector('header')).toBeNull()
    expect(container.querySelector('main')).toBeNull()
    expect(titleContainer.children[0]?.tagName).toBe('DIV')
    expect(titleContainer.parentElement).toBe(container.firstElementChild)
    expect(container.querySelector('[aria-busy]')).toBeNull()
    expect(scrollable.parentElement?.parentElement?.parentElement).toBe(
      titleContainer.parentElement
    )
  })

  it('adds the legacy translucent title chrome after scrolling', async () => {
    const { rerender } = render(
      <BookingSelectionFlow
        journey={teamJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    const titleContainer = screen.getByTestId('container:title')
    const scrollable = screen.getByTestId('container:scrollable')
    const transparentClassName = titleContainer.className
    Object.defineProperty(scrollable, 'scrollTop', { configurable: true, value: 10 })
    fireEvent.scroll(scrollable)

    await waitFor(() => expect(titleContainer.className).not.toBe(transparentClassName))

    rerender(
      <BookingSelectionFlow
        journey={{ ...teamJourney, providerPreference: { kind: 'any' } }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    expect(titleContainer.className).toBe(transparentClassName)
  })

  it('waits for the page transition before replacing the title text', async () => {
    const { rerender } = render(
      <BookingSelectionFlow
        journey={teamJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    rerender(
      <BookingSelectionFlow
        journey={{ ...teamJourney, providerPreference: { kind: 'any' } }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    expect(screen.getByText('Choose a professional', { selector: 'p' })).toBeTruthy()
    expect(screen.queryByText('What can we do for you?', { selector: 'p' })).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(screen.getByText('Choose a professional', { selector: 'p' })).toBeTruthy()
    expect(screen.queryByText('What can we do for you?', { selector: 'p' })).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(screen.getByText('What can we do for you?', { selector: 'p' })).toBeTruthy()
    expect(screen.queryByText('Choose a professional', { selector: 'p' })).toBeNull()
  })

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

  it('does not cover provider or service navigation with a processing overlay', async () => {
    const { rerender } = render(
      <BookingSelectionFlow
        journey={teamJourney}
        busy
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: /any professional/i })).toBeTruthy()

    rerender(
      <BookingSelectionFlow
        journey={{ ...teamJourney, providerPreference: { kind: 'any' } }}
        busy
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    expect(screen.queryByRole('status')).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /signature cut/i })).toBeTruthy()
    )
  })

  it('uses the legacy delayed page transition when the Back chevron appears', async () => {
    render(
      <BookingSelectionFlow
        journey={{ ...teamJourney, providerPreference: { kind: 'any' } }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    const back = screen.getByRole('button', { name: 'Back' })
    expect(back.getAttribute('data-testid')).toBe('btn:back')
    const chevron = back.querySelector('svg')
    expect(chevron?.getAttribute('viewBox')).toBe('0 0 9 16')
    expect(chevron?.querySelectorAll('path')).toHaveLength(1)
    expect(chevron?.querySelector('path')?.getAttribute('d')).toContain(
      'M8.07552 15.8411'
    )
    expect(back.style.width).toBe('0px')

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(back.style.width).toBe('0px')

    await waitFor(() => expect(back.style.width).toBe('24px'))
  })

  it('uses the legacy location view before entering a multi-Shop booking', async () => {
    const chooseShop = vi.fn()
    const journey: BookingJourney = {
      ...teamJourney,
      shops: [
        ...teamJourney.shops,
        {
          id: 'shp_river',
          slug: 'river',
          name: 'Riverside',
          addressLines: ['21 Mercer Street', 'New York, NY 10013'],
          coordinates: { latitude: 40.724, longitude: -74.001 },
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
    const { container, rerender } = render(
      <BookingSelectionFlow
        journey={journey}
        busy={false}
        onChooseShop={chooseShop}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    expect(screen.getByText('Choose a location', { selector: 'p' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nearby' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'Mercer' }
    })
    expect(screen.queryByRole('button', { name: 'Main Shop' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /riverside/i }))
    expect(chooseShop).toHaveBeenCalledWith('shp_river')
    expect(screen.getByText('21 Mercer Street')).toBeTruthy()
    expect(screen.getByText('New York, NY 10013')).toBeTruthy()
    expect(screen.getByText('Choose a location', { selector: 'p' })).toBeTruthy()
    rerender(
      <BookingSelectionFlow
        journey={{ ...journey, shopId: 'shp_river', version: journey.version + 1 }}
        busy={false}
        onChooseShop={chooseShop}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(screen.getByText('Choose a professional', { selector: 'p' })).toBeTruthy()
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /private pro.*private access/i })
          .hasAttribute('disabled')
      ).toBe(true)
    )
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
