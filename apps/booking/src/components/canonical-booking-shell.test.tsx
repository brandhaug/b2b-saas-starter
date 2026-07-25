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
import { CanonicalBookingShell } from './canonical-booking-shell.tsx'

vi.mock('./server-backed-booking-flow.tsx', async () => {
  const { BookingWidgetShell } = await import('./booking-widget-shell.tsx')
  const { BookingPremiumThemeBoundary } =
    await import('../presentation/booking-premium-theme.tsx')
  const palette = {
    primaryColor: '#111111',
    primaryDark: '#222222',
    primaryDarker: '#333333',
    primaryLight: '#444444',
    primaryFontColor: '#555555',
    secondaryColor: '#666666',
    linkColor: '#777777'
  } as const
  return {
    ServerBackedBookingFlow: ({
      onTitleActionMount,
      onSignIn
    }: {
      onTitleActionMount: (element: HTMLDivElement | null) => void
      onSignIn?: () => void
    }) => (
      <BookingPremiumThemeBoundary palette={palette}>
        <BookingWidgetShell>
          <div data-testid="mock-title-actions" ref={onTitleActionMount} />
          <p>Booking journey</p>
          <button type="button" onClick={onSignIn}>
            Checkout sign in
          </button>
        </BookingWidgetShell>
      </BookingPremiumThemeBoundary>
    )
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('Canonical Booking Shell', () => {
  it('opens the sign-in popup from the checkout title action', () => {
    render(
      <CanonicalBookingShell
        merchantSlug="mara"
        sessionId="bsn_checkout_sign_in"
        locale="en"
        embedding="standalone"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Checkout sign in' }))
    expect(screen.getByRole('dialog', { name: 'Booking menu' })).toBeTruthy()
  })

  it('opens the legacy booking menu popup from the title action', async () => {
    render(
      <CanonicalBookingShell
        merchantSlug="mara"
        sessionId="bsn_menu"
        locale="en"
        embedding="standalone"
      />
    )

    const menu = screen.getByRole('button', { name: 'Booking menu' })
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(menu)

    const popup = screen.getByRole('dialog', { name: 'Booking menu' })
    expect(popup.getAttribute('data-testid')).toBe('popup:booking-menu')
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    const languageSelector = within(popup).getByRole('button', {
      name: 'Language: English'
    })
    expect(languageSelector.querySelector('span')).toBeNull()
    fireEvent.click(languageSelector)
    const languageMenu = languageSelector.parentElement?.lastElementChild
    expect(languageMenu).toBeTruthy()
    expect(languageMenu).not.toBe(languageSelector)
    expect(languageMenu?.hasAttribute('role')).toBe(false)
    expect(
      Array.from(languageMenu?.children ?? []).map((option) => option.textContent)
    ).toEqual(['English', 'Français', 'Español'])
    expect(
      Array.from(languageMenu?.children ?? []).every(
        (option) => !option.hasAttribute('role') && !option.hasAttribute('aria-checked')
      )
    ).toBe(true)
    fireEvent.click(within(popup).getByText('Sign in'))
    expect(languageSelector.parentElement?.children).toHaveLength(1)
    expect(
      (
        within(popup).getByRole('button', {
          name: 'Sign in with email'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(within(popup).getByRole('button', { name: 'Close menu' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Booking menu' })).toBeNull()
    )
    expect(menu.getAttribute('aria-expanded')).toBe('false')
  })

  it('hydrates the Session locale and persists changes with history replacement', async () => {
    const localeStorage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => localeStorage.get(key) ?? null,
        setItem: (key: string, value: string) => localeStorage.set(key, value)
      }
    })
    let resolvePersistence!: (response: Response) => void
    const persistence = new Promise<Response>((resolve) => {
      resolvePersistence = resolve
    })
    const fetchMock = vi.fn(() => persistence)
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(
      null,
      '',
      '/mara/booking/downtown/any/services?booking=bsn_tab&locale=fr&embed=widget'
    )

    const { container } = render(
      <CanonicalBookingShell
        merchantSlug="mara"
        sessionId="bsn_tab"
        locale="fr"
        embedding="widget"
      />
    )

    expect(
      container
        .querySelector('[data-booking-shell="canonical"]')
        ?.getAttribute('data-embedding')
    ).toBe('widget')
    expect(container.querySelectorAll('[data-booking-shell="canonical"]')).toHaveLength(
      1
    )
    expect(
      container.querySelector('[data-booking-shell="canonical"]')?.getAttribute('style')
    ).toContain('#111111')
    const titleActions = screen.getByTestId('mock-title-actions')
    const menu = within(titleActions).getByRole('button', {
      name: 'Menu de réservation'
    })
    expect(menu.parentElement).toBe(titleActions)
    expect(menu.getAttribute('data-testid')).toBe('btn:menu')
    expect(menu.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 10 10')
    fireEvent.click(screen.getByRole('button', { name: 'Menu de réservation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Langue: Français' }))
    fireEvent.click(screen.getByTestId('lang:es'))

    expect(new URLSearchParams(window.location.search).get('locale')).toBe('fr')
    expect(screen.getByRole('status').textContent).toBe('Preparando tu reserva…')
    expect(
      container.querySelector('[data-booking-shell="canonical"]')?.getAttribute('style')
    ).toContain('#111111')
    expect(screen.getByText('Booking journey')).toBeTruthy()
    resolvePersistence(new Response(null, { status: 204 }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/mara/booking/session/bsn_tab/context',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ locale: 'es', embedding: 'widget' })
        })
      )
    )
    expect(window.location.pathname).toBe('/mara/booking/downtown/any/services')
    expect(new URLSearchParams(window.location.search).get('locale')).toBe('es')
  })
})
