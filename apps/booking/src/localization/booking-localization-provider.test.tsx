// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BookingLanguagePicker,
  BookingLocalizationProvider,
  useBookingLocalization
} from './booking-localization-provider.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.lang = 'en'
  vi.restoreAllMocks()
})

function CurrentLocale() {
  const { locale, message } = useBookingLocalization()
  return (
    <p>
      {locale}:{message('action.continue')}
    </p>
  )
}

describe('BookingLocalizationProvider', () => {
  it('keeps locale state outside route identity and persists changes at both boundaries', () => {
    localStorage.setItem('booking.locale', 'ro')
    const persistSession = vi.fn()
    render(
      <BookingLocalizationProvider sessionLocale="fr" onLocaleChange={persistSession}>
        <CurrentLocale />
        <BookingLanguagePicker label="Language" />
      </BookingLocalizationProvider>
    )

    expect(screen.getByText('fr:Continuer')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'es' }
    })
    expect(screen.getByText('es:Continuar')).toBeTruthy()
    expect(localStorage.getItem('booking.locale')).toBe('es')
    expect(document.documentElement.lang).toBe('es')
    expect(persistSession).toHaveBeenCalledWith('es')
    expect(window.location.pathname).toBe('/')
  })

  it('hydrates a direct link from the same Session locale without replacing its content', async () => {
    const content = (
      <BookingLocalizationProvider sessionLocale="fr">
        <CurrentLocale />
      </BookingLocalizationProvider>
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(content)
    document.body.appendChild(container)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const root = hydrateRoot(container, content)
    await act(async () => undefined)

    expect(container.textContent).toBe('fr:Continuer')
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).toLowerCase().includes('hydration')
      )
    ).toBe(false)
    await act(async () => root.unmount())
    container.remove()
  })

  it('does not let browser preference replace a normalized English Session locale', () => {
    localStorage.setItem('booking.locale', 'ro')
    render(
      <BookingLocalizationProvider sessionLocale="en-US">
        <CurrentLocale />
      </BookingLocalizationProvider>
    )

    expect(screen.getByText('en:Continue')).toBeTruthy()
  })
})
