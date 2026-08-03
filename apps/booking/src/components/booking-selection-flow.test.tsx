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
    expect(within(cart).getByTestId('text:serviceName').textContent).toBe(
      'Signature Cut'
    )
    expect(within(cart).getByTestId('text:barberTotal').textContent).toBe('$45.00')
    expect(
      (within(cart).getByTestId('btn:chooseTime') as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('preserves the title and scroll chrome contract', () => {
    render(
      <BookingSelectionFlow
        journey={soloJourney}
        busy={false}
        onChooseServices={vi.fn()}
      />
    )

    const title = screen.getByTestId('container:title')
    const scrollable = screen.getByTestId('container:scrollable')
    const initialClass = title.className
    Object.defineProperty(scrollable, 'scrollTop', {
      configurable: true,
      value: 24,
      writable: true
    })
    fireEvent.scroll(scrollable)
    expect(title.className).not.toBe(initialClass)
    expect(screen.getByText('Choose a service')).toBeTruthy()
  })

  it('expands Service information without selecting the Service', () => {
    const chooseServices = vi.fn()
    render(
      <BookingSelectionFlow
        journey={soloJourney}
        busy={false}
        onChooseServices={chooseServices}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'More information about Signature Cut' })
    )
    expect(screen.getByText('A precise cut, wash, and style.')).toBeTruthy()
    expect(chooseServices).not.toHaveBeenCalled()
    expect(screen.getByTestId('service:svc_cut').getAttribute('aria-pressed')).toBe(
      'false'
    )
  })

  it('activates a Service card from the keyboard and disables cards while busy', () => {
    const chooseServices = vi.fn()
    const view = render(
      <BookingSelectionFlow
        journey={soloJourney}
        busy={false}
        onChooseServices={chooseServices}
      />
    )

    const service = screen.getByTestId('service:svc_cut')
    expect(service.getAttribute('role')).toBe('button')
    expect(service.tabIndex).toBe(0)
    fireEvent.keyDown(service, { key: 'Enter' })
    expect(chooseServices).toHaveBeenCalledWith({
      primaryServiceId: 'svc_cut',
      additionalServiceIds: []
    })

    view.rerender(
      <BookingSelectionFlow
        journey={soloJourney}
        busy
        onChooseServices={chooseServices}
      />
    )
    expect(service.getAttribute('aria-disabled')).toBe('true')
    expect(service.tabIndex).toBe(-1)
  })

  it('disables order actions while checkout is pending', () => {
    render(
      <BookingSelectionFlow
        journey={{
          ...soloJourney,
          selection: { primaryServiceId: 'svc_cut', additionalServiceIds: [] }
        }}
        busy={false}
        onChooseServices={vi.fn()}
        continuation={{
          title: 'Choose a time',
          content: <div>Scheduling</div>,
          onBack: vi.fn(),
          pendingCheckout: { ctaLabel: 'Preparing order' }
        }}
      />
    )

    expect((screen.getByTestId('btn:viewOrder') as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(screen.getByTestId('btn:viewOrder').textContent).toContain('Preparing order')
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

  it('searches and selects a Shop before continuing to Services', async () => {
    const chooseShop = vi.fn()
    const journey: BookingJourney = {
      ...soloJourney,
      shops: [
        ...soloJourney.shops,
        {
          id: 'shp_river',
          slug: 'river',
          name: 'Riverside',
          addressLines: ['21 Mercer Street', 'New York, NY 10013']
        }
      ]
    }
    const view = render(
      <BookingSelectionFlow
        journey={journey}
        busy={false}
        onChooseShop={chooseShop}
        onChooseServices={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Mercer' } })
    expect(screen.queryByRole('button', { name: 'Main Shop' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /riverside/i }))
    expect(chooseShop).toHaveBeenCalledWith('shp_river')

    view.rerender(
      <BookingSelectionFlow
        journey={{ ...journey, shopId: 'shp_river', version: 2 }}
        busy={false}
        onChooseShop={chooseShop}
        onChooseServices={vi.fn()}
      />
    )
    await waitFor(() => expect(screen.getByText('Choose a service')).toBeTruthy())
  })

  it('supports keyboard category filtering and restores focus on Escape', () => {
    const journey: BookingJourney = {
      ...soloJourney,
      services: [
        ...soloJourney.services,
        {
          id: 'svc_misc',
          name: 'Consultation',
          category: null,
          priceMinor: 1000,
          currency: 'USD',
          durationMinutes: 15,
          eligibleProviderIds: ['prv_owner']
        }
      ]
    }
    render(
      <BookingSelectionFlow journey={journey} busy={false} onChooseServices={vi.fn()} />
    )

    const trigger = screen.getByRole('button', { name: 'Service category' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(screen.getByTestId('category:Grooming'), { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('category:uncategorized'))
    expect(screen.getByTestId('service:svc_misc')).toBeTruthy()
    expect(screen.queryByTestId('service:svc_cut')).toBeNull()
  })

  it('clears a pending Service highlight after a newer journey rejects it', async () => {
    const chooseServices = vi.fn()
    const view = render(
      <BookingSelectionFlow
        journey={soloJourney}
        busy={false}
        onChooseServices={chooseServices}
      />
    )

    fireEvent.click(screen.getByTestId('service:svc_cut'))
    view.rerender(
      <BookingSelectionFlow
        journey={soloJourney}
        busy
        onChooseServices={chooseServices}
      />
    )
    view.rerender(
      <BookingSelectionFlow
        journey={{ ...soloJourney, version: 2 }}
        busy={false}
        onChooseServices={chooseServices}
      />
    )
    await waitFor(() =>
      expect(screen.getByTestId('service:svc_cut').dataset.autoSelected).toBe('false')
    )
  })

  it('closes the order summary, restores focus, and preserves scroll position', async () => {
    render(
      <BookingSelectionFlow
        journey={{
          ...soloJourney,
          selection: { primaryServiceId: 'svc_cut', additionalServiceIds: [] }
        }}
        busy={false}
        onChooseServices={vi.fn()}
      />
    )
    const opener = screen.getByTestId('btn:viewOrder')
    fireEvent.click(opener)
    const scrollable = screen.getByTestId('container:scrollable')
    Object.defineProperty(scrollable, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true
    })
    fireEvent.click(screen.getByTestId('btn:close'))
    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(scrollable.scrollTop).toBe(0)
  })
})
