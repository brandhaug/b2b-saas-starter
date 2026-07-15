// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
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
  canSellUnassignedGiftCard: true,
  providers: [
    {
      id: 'prv_ava',
      displayName: 'Ava S.',
      shortName: 'Ava S.',
      isDefault: true,
      access: 'public',
      eligibleServiceIds: ['svc_cut', 'svc_beard']
    },
    {
      id: 'prv_noah',
      displayName: 'Noah B.',
      shortName: 'Noah B.',
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

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

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
    const title = within(screen.getByTestId('container:title'))

    rerender(
      <BookingSelectionFlow
        journey={{ ...teamJourney, providerPreference: { kind: 'any' } }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    expect(title.getByText('Choose a professional', { selector: 'p' })).toBeTruthy()
    expect(title.queryByText('Choose a service', { selector: 'p' })).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(title.getByText('Choose a professional', { selector: 'p' })).toBeTruthy()
    expect(title.queryByText('Choose a service', { selector: 'p' })).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(title.getByText('Choose a service', { selector: 'p' })).toBeTruthy()
    expect(title.queryByText('Choose a professional', { selector: 'p' })).toBeNull()
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

  it('uses the legacy NamedBarberCard DOM contract for providers', () => {
    render(
      <BookingSelectionFlow
        journey={teamJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    const card = screen.getByTestId('card:barber:prv_ava')
    expect(card.tagName).toBe('DIV')
    expect(card.getAttribute('role')).toBe('button')
    expect(screen.getByTestId('text:barberName:prv_ava').tagName).toBe('P')
    expect(screen.getByTestId('divider:barber:prv_ava').tagName).toBe('DIV')
    const availability = screen.getByTestId('text:barberAvailability:prv_ava')
    expect(availability.tagName).toBe('P')
    expect(availability.textContent).toBe('Available')
    expect(screen.getByTestId('text:chooseServiceFirst:mainText').textContent).toBe(
      'Choose aservice first'
    )
  })

  it('recreates the complete legacy professional-card grid structure', () => {
    vi.useFakeTimers()
    const onChooseGiftCard = vi.fn()
    render(
      <BookingSelectionFlow
        journey={teamJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
        onChooseGiftCard={onChooseGiftCard}
      />
    )

    const anyProvider = screen.getByTestId('card:chooseServiceFirst')
    expect(
      screen.getByTestId('text:chooseServiceFirst:mainText').querySelector('br')
    ).toBeTruthy()
    expect(
      screen.getByTestId('text:chooseServiceFirst:subText').querySelector('br')
    ).toBeTruthy()
    expect(anyProvider.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 38 37')

    const avatar = screen.getByTestId('avatar:barber:prv_ava')
    expect(avatar.querySelector('p')?.textContent).toBe('AS')

    const giftCard = screen.getByTestId('card:buyGiftCard')
    expect(giftCard.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 48 30')
    expect(screen.getByTestId('text:title').querySelector('br')).toBeTruthy()
    expect(screen.getByTestId('text:subtitle').querySelector('br')).toBeTruthy()
    fireEvent.click(giftCard)
    expect(giftCard.getAttribute('aria-pressed')).toBe('true')
    expect(onChooseGiftCard).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(onChooseGiftCard).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('renders the legacy short provider name instead of the full catalog name', () => {
    render(
      <BookingSelectionFlow
        journey={{
          ...teamJourney,
          providers: teamJourney.providers.map((provider) =>
            provider.id === 'prv_ava'
              ? {
                  ...provider,
                  displayName: 'Mara Ionescu',
                  shortName: 'Mara I.'
                }
              : provider
          )
        }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    const name = screen.getByTestId('text:barberName:prv_ava')
    expect(name.textContent).toBe('Mara I.')
    expect(name.getAttribute('title')).toBe('Mara I.')
  })

  it('disables a professional with no derived availability', () => {
    render(
      <BookingSelectionFlow
        journey={{
          ...teamJourney,
          providers: teamJourney.providers.map((provider) =>
            provider.id === 'prv_ava'
              ? { ...provider, nextAvailableAt: null }
              : provider
          )
        }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    expect(
      screen.getByTestId('card:barber:prv_ava').getAttribute('aria-disabled')
    ).toBe('true')
    expect(screen.getByTestId('text:barberAvailability:prv_ava').textContent).toBe(
      'Not available'
    )
  })

  it('shows the legacy selected provider card state before route advancement', () => {
    const chooseProvider = vi.fn()
    render(
      <BookingSelectionFlow
        journey={teamJourney}
        busy={false}
        onChooseProvider={chooseProvider}
        onChooseServices={vi.fn()}
      />
    )

    const card = screen.getByTestId('card:barber:prv_ava')
    const defaultClassName = card.className
    expect(card.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(card)

    expect(chooseProvider).toHaveBeenCalledWith({
      kind: 'specific',
      providerId: 'prv_ava'
    })
    expect(card.getAttribute('aria-pressed')).toBe('true')
    expect(card.className).not.toBe(defaultClassName)
  })

  it('clears the selected provider card state when navigating back', async () => {
    render(
      <BookingSelectionFlow
        journey={{
          ...teamJourney,
          providerPreference: { kind: 'specific', providerId: 'prv_ava' }
        }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() =>
      expect(
        screen.getByTestId('card:barber:prv_ava').getAttribute('aria-pressed')
      ).toBe('false')
    )
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
    await waitFor(() => expect(screen.getByTestId('service:svc_cut')).toBeTruthy())
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
          shortName: 'Private P.',
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
    const title = within(screen.getByTestId('container:title'))
    await waitFor(() =>
      expect(title.getByText('Choose a professional', { selector: 'p' })).toBeTruthy()
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /private p\..*private access/i })
          .getAttribute('aria-disabled')
      ).toBe('true')
    )
  })

  it('skips Provider choice for Solo, hands off to Additional Services, and opens the full order summary without moving the page behind it', () => {
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
    fireEvent.click(screen.getByTestId('service:svc_cut'))
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: null,
      additionalServiceIds: []
    })
    fireEvent.click(screen.getByTestId('service:svc_beard'))
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: 'svc_cut',
      additionalServiceIds: ['svc_beard']
    })
    const viewOrder = screen.getByTestId('btn:viewOrder')
    expect(viewOrder.parentElement?.getAttribute('data-testid')).toBe(
      'container:viewOrderSafeArea'
    )
    const scrollable = screen.getByTestId('container:scrollable')
    Object.defineProperty(scrollable, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true
    })
    viewOrder.focus()
    const emulateBrowserFocusScroll = (event: FocusEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('[data-testid="cart:booking"]')
      ) {
        scrollable.scrollTop = 120
      }
    }
    document.addEventListener('focusin', emulateBrowserFocusScroll)
    fireEvent.click(viewOrder)
    document.removeEventListener('focusin', emulateBrowserFocusScroll)
    const cart = screen.getByTestId('cart:booking')
    expect(cart.tagName).toBe('DIV')
    expect(cart.getAttribute('data-cart-state')).toBe('expanded')
    expect(screen.getByRole('dialog', { name: /order summary/i })).toBe(cart)
    expect(document.activeElement).toBe(viewOrder)
    expect(scrollable.scrollTop).toBe(0)
    expect(screen.getAllByText('$45.00').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Choose time' }))
    expect(continueToTime).toHaveBeenCalledOnce()
  })

  it('uses the legacy service-card contract and waits through its selected transition before add-ons', async () => {
    vi.useFakeTimers()
    const chooseServices = vi.fn()
    const serviceJourney: BookingJourney = {
      ...teamJourney,
      providerPreference: { kind: 'specific', providerId: 'prv_ava' }
    }
    const view = render(
      <BookingSelectionFlow
        journey={serviceJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={chooseServices}
      />
    )

    const serviceCard = screen.getByTestId('service:svc_cut')
    expect(serviceCard.tagName).toBe('DIV')
    expect(serviceCard.getAttribute('data-auto-selected')).toBe('false')
    expect(within(serviceCard).getByTestId('text:name').textContent).toBe(
      'Signature Cut'
    )
    expect(within(serviceCard).getByTestId('text:duration').textContent).toBe('45 min')
    expect(within(serviceCard).getByTestId('text:price').textContent).toBe('$45.00')
    expect(serviceCard.getAttribute('role')).toBe('button')
    expect(serviceCard.getAttribute('tabindex')).toBe('0')

    fireEvent.keyDown(serviceCard, { key: 'Enter' })
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: 'svc_cut',
      additionalServiceIds: []
    })
    chooseServices.mockClear()

    fireEvent.click(serviceCard)
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: 'svc_cut',
      additionalServiceIds: []
    })
    view.rerender(
      <BookingSelectionFlow
        journey={{
          ...serviceJourney,
          version: serviceJourney.version + 1,
          selection: { primaryServiceId: 'svc_cut', additionalServiceIds: [] },
          compatibleAdditionalServiceIds: ['svc_beard']
        }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={chooseServices}
      />
    )

    expect(
      screen.getByTestId('service:svc_cut').getAttribute('data-auto-selected')
    ).toBe('true')
    expect(screen.queryByText('Anything you wish to add?')).toBeNull()
    await vi.advanceTimersByTimeAsync(249)
    expect(screen.queryByText('Anything you wish to add?')).toBeNull()
    await vi.advanceTimersByTimeAsync(251)
    expect(screen.getByText('Anything you wish to add?')).toBeTruthy()
    vi.useRealTimers()
  })

  it('clears a pending service highlight when a newer journey rejects the selection', async () => {
    const chooseServices = vi.fn()
    const serviceJourney: BookingJourney = {
      ...teamJourney,
      providerPreference: { kind: 'specific', providerId: 'prv_ava' }
    }
    const view = render(
      <BookingSelectionFlow
        journey={serviceJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={chooseServices}
      />
    )

    fireEvent.click(screen.getByTestId('service:svc_cut'))
    view.rerender(
      <BookingSelectionFlow
        journey={serviceJourney}
        busy
        onChooseProvider={vi.fn()}
        onChooseServices={chooseServices}
      />
    )
    view.rerender(
      <BookingSelectionFlow
        journey={{ ...serviceJourney, version: serviceJourney.version + 1 }}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={chooseServices}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByTestId('service:svc_cut').getAttribute('data-auto-selected')
      ).toBe('false')
    )
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
              shortName: 'Private P.',
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
      providerPreference: { kind: 'any' },
      services: [
        ...teamJourney.services,
        {
          id: 'svc_misc',
          name: 'Consultation',
          category: null,
          priceMinor: 1000,
          currency: 'USD',
          durationMinutes: 15,
          eligibleProviderIds: ['prv_ava']
        }
      ]
    }
    const { rerender } = render(
      <BookingSelectionFlow
        journey={anyJourney}
        busy={false}
        onChooseProvider={vi.fn()}
        onChooseServices={vi.fn()}
      />
    )
    const categorySelect = screen.getByTestId('select:categories')
    expect(categorySelect.tagName).toBe('DIV')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(within(categorySelect).getByTestId('text:category').textContent).toBe(
      'All categories'
    )
    const categoryTrigger = screen.getByRole('button', { name: 'Service category' })
    expect(categoryTrigger.getAttribute('aria-controls')).toBeTruthy()
    expect(
      document.getElementById(categoryTrigger.getAttribute('aria-controls')!)
    ).toBeTruthy()
    expect(categoryTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('category:Grooming').getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(categoryTrigger, { key: 'Enter' })
    expect(categoryTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('category:Grooming').getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(screen.getByTestId('category:Grooming'), { key: 'Escape' })
    expect(categoryTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(categoryTrigger)
    fireEvent.click(categorySelect)
    fireEvent.click(screen.getByTestId('category:uncategorized'))
    expect(screen.getByTestId('service:svc_misc')).toBeTruthy()
    expect(screen.queryByTestId('service:svc_cut')).toBeNull()
    fireEvent.click(categoryTrigger)
    fireEvent.click(screen.getByTestId('category:Grooming'))
    expect(within(categorySelect).getByTestId('text:category').textContent).toBe(
      'Grooming'
    )
    expect(screen.getByTestId('service:svc_beard')).toBeTruthy()
    expect(screen.queryByTestId('service:svc_cut')).toBeNull()

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
