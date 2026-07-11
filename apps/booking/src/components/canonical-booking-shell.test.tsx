// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanonicalBookingShell } from './canonical-booking-shell.tsx'

vi.mock('./server-backed-booking-flow.tsx', () => ({
  ServerBackedBookingFlow: () => <p>Booking journey</p>
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('Canonical Booking Shell', () => {
  it('hydrates the Session locale and persists changes with history replacement', async () => {
    const localeStorage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => localeStorage.get(key) ?? null,
        setItem: (key: string, value: string) => localeStorage.set(key, value)
      }
    })
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
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
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Language'
        }) as unknown as HTMLSelectElement
      ).value
    ).toBe('fr')
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'ro' }
    })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/mara/booking/session/bsn_tab/context',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ locale: 'ro', embedding: 'widget' })
        })
      )
    )
    expect(window.location.pathname).toBe('/mara/booking/downtown/any/services')
    expect(new URLSearchParams(window.location.search).get('locale')).toBe('ro')
  })
})
