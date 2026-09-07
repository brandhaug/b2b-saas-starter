import { describe, expect, it } from 'vite-plus/test'
import { isLocale, localeFromLanguage } from './locale.ts'

describe('isLocale', () => {
  it('accepts only the shipped locale identifiers', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('nb')).toBe(true)
    expect(isLocale('de')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
})

describe('localeFromLanguage', () => {
  it('maps Norwegian language tags to Bokmål', () => {
    expect(localeFromLanguage('nb-NO')).toBe('nb')
    expect(localeFromLanguage('no')).toBe('nb')
    expect(localeFromLanguage(['sv-SE', 'nb-NO'])).toBe('nb')
  })

  it('honors the first supported Accept-Language entry', () => {
    expect(localeFromLanguage('sv;q=1, en-US;q=0.8')).toBe('en')
    expect(localeFromLanguage('sv, nb;q=0.8, en;q=0.7')).toBe('nb')
  })

  it('uses quality values and ignores explicitly rejected languages', () => {
    expect(localeFromLanguage('en;q=0.2, nb;q=0.9')).toBe('nb')
    expect(localeFromLanguage('nb;q=0, en;q=0.5')).toBe('en')
  })

  it('ignores entries with malformed quality values', () => {
    expect(localeFromLanguage('en;q=invalid, nb;q=0.8')).toBe('nb')
    expect(localeFromLanguage('nb;q=not-a-number, en;q=0.5')).toBe('en')
  })

  it('falls back to English for unsupported or absent languages', () => {
    expect(localeFromLanguage(undefined)).toBe('en')
    expect(localeFromLanguage('*')).toBe('en')
    expect(localeFromLanguage('de-DE')).toBe('en')
  })
})
