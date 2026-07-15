import { describe, expect, it, vi } from 'vitest'
import {
  BOOKING_LOCALES,
  BOOKING_CATALOG_VERSION,
  bookingCatalogs,
  formatBookingCurrency,
  formatBookingDate,
  formatBookingPhone,
  formatBookingTime,
  localizeMerchantContent,
  persistBookingLocale,
  resolveBookingLocale,
  translateBookingError,
  translateBookingMessage,
  walkInCatalog
} from './booking-localization.ts'

describe('Booking localization contract', () => {
  it('ships one complete typed catalog for every supported Booking Locale', () => {
    expect(BOOKING_CATALOG_VERSION).toBe(1)
    expect(BOOKING_LOCALES).toEqual(['en', 'es', 'fr', 'ro'])
    const englishKeys = Object.keys(bookingCatalogs.en).sort()

    for (const locale of BOOKING_LOCALES) {
      expect(Object.keys(bookingCatalogs[locale]).sort()).toEqual(englishKeys)
      expect(Object.values(bookingCatalogs[locale]).every(Boolean)).toBe(true)
      expect(Object.keys(walkInCatalog[locale]).sort()).toEqual(
        Object.keys(walkInCatalog.en).sort()
      )
      expect(Object.keys(walkInCatalog[locale].status).sort()).toEqual(
        Object.keys(walkInCatalog.en.status).sort()
      )
    }

    expect(translateBookingMessage('ro', 'action.continue')).toBe('Continuă')
    expect(translateBookingMessage('ro', 'label.appointment_at')).toBe('la')
    expect(translateBookingMessage('ro', 'label.duration_minutes_short')).toBe('min')
    expect(translateBookingError('fr', 'validation.email_invalid')).toBe(
      'Saisissez une adresse courriel valide.'
    )
    const diagnostics: string[] = []
    expect(
      translateBookingError('es', 'future.error', (code) => diagnostics.push(code))
    ).toBe('Algo salió mal. Inténtalo de nuevo.')
    expect(diagnostics).toEqual(['future.error'])
    expect(
      translateBookingMessage('ro', 'future.message', (key) => diagnostics.push(key))
    ).toBe('Ceva nu a funcționat. Încearcă din nou.')
    expect(diagnostics).toEqual(['future.error', 'future.message'])
  })

  it('resolves and persists locale without making it part of route identity', () => {
    expect(
      resolveBookingLocale({
        sessionLocale: 'fr',
        persistedLocale: 'ro',
        acceptedLanguages: ['es-MX']
      })
    ).toBe('fr')
    expect(
      resolveBookingLocale({
        sessionLocale: 'unsupported',
        persistedLocale: null,
        acceptedLanguages: ['de-DE', 'es-MX']
      })
    ).toBe('es')
    expect(resolveBookingLocale({ acceptedLanguages: ['xx'] })).toBe('en')

    const storage = { setItem: vi.fn() }
    persistBookingLocale('ro', storage)
    expect(storage.setItem).toHaveBeenCalledWith('booking.locale', 'ro')
  })

  it('formats presentation values from explicit locale, timezone, currency, and country facts', () => {
    const instant = '2026-07-11T18:30:00.000Z'
    expect(formatBookingDate('en', instant, 'Europe/Bucharest')).toBe(
      'Saturday, July 11, 2026'
    )
    expect(formatBookingTime('ro', instant, 'Europe/Bucharest')).toBe('21:30')
    expect(formatBookingCurrency('fr', 12_345, 'EUR')).toMatch(/123,45\s€/)
    expect(formatBookingPhone('+40722123456', 'RO')).toBe('0722 123 456')
    expect(formatBookingPhone('+442079460018', 'GB')).toBe('020 7946 0018')
  })

  it('marks source-language fallback for untranslated merchant-authored content', () => {
    expect(
      localizeMerchantContent(
        { sourceLocale: 'en', sourceText: 'Signature cut', translations: {} },
        'es'
      )
    ).toEqual({
      text: 'Signature cut',
      locale: 'en',
      isSourceLanguageFallback: true
    })
    expect(
      localizeMerchantContent(
        {
          sourceLocale: 'en',
          sourceText: 'Signature cut',
          translations: { es: 'Corte exclusivo' }
        },
        'es'
      )
    ).toEqual({
      text: 'Corte exclusivo',
      locale: 'es',
      isSourceLanguageFallback: false
    })
  })
})
