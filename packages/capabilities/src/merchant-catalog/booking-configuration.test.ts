import { describe, expect, it } from 'vitest'
import {
  decodeBookingConfiguration,
  resolveBookingConfiguration,
  validateBookingPalette
} from './booking-configuration.ts'

const merchantPalette = {
  primaryColor: '#111111',
  primaryDark: '#121212',
  primaryDarker: '#131313',
  primaryLight: '#141414',
  primaryFontColor: '#ffffff',
  secondaryColor: '#151515',
  linkColor: '#161616'
} as const

describe('Booking catalog configuration', () => {
  it('rejects malformed persisted translations at the boundary', () => {
    expect(
      decodeBookingConfiguration({
        sourceLocale: 'en',
        nameTranslations: { es: 42 }
      })
    ).toBeNull()
  })

  it('resolves Shop over Brand over Merchant while retaining localized identities', () => {
    const resolved = resolveBookingConfiguration({
      locale: 'es',
      merchant: {
        name: 'Northstar',
        configuration: {
          sourceLocale: 'en',
          nameTranslations: { es: 'Estrella del Norte' },
          premiumPalette: merchantPalette,
          adultsOnly: true
        }
      },
      brand: {
        name: 'Northstar Grooming',
        configuration: {
          sourceLocale: 'en',
          nameTranslations: { es: 'Peluquería Northstar' },
          premiumPalette: { ...merchantPalette, primaryColor: '#222222' },
          adultsOnly: false
        }
      },
      shop: {
        name: 'Old Town',
        configuration: {
          sourceLocale: 'en',
          premiumPalette: { ...merchantPalette, primaryColor: '#333333' }
        }
      }
    })

    expect(resolved.merchantName).toEqual({
      text: 'Estrella del Norte',
      locale: 'es',
      isSourceLanguageFallback: false
    })
    expect(resolved.brandName.text).toBe('Peluquería Northstar')
    expect(resolved.shopName).toEqual({
      text: 'Old Town',
      locale: 'en',
      isSourceLanguageFallback: true
    })
    expect(resolved.premiumPalette?.primaryColor).toBe('#333333')
    expect(resolved.premiumPaletteSource).toBe('shop')
    expect(resolved.adultsOnly).toBe(false)
  })

  it('rejects incomplete or unsafe palette overrides and falls back by scope', () => {
    expect(validateBookingPalette({ primaryColor: '#111111' })).toBeNull()
    expect(
      validateBookingPalette({
        ...merchantPalette,
        linkColor: 'red; background:url(https://invalid.example)'
      })
    ).toBeNull()

    const resolved = resolveBookingConfiguration({
      locale: 'fr',
      merchant: {
        name: 'Merchant',
        configuration: { premiumPalette: merchantPalette }
      },
      brand: {
        name: 'Brand',
        configuration: { premiumPalette: { primaryColor: '#222222' } }
      },
      shop: { name: 'Shop' }
    })
    expect(resolved.premiumPalette).toEqual(merchantPalette)
    expect(resolved.premiumPaletteSource).toBe('merchant')
  })
})
