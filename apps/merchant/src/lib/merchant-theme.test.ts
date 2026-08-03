// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyMerchantTimeTheme,
  merchantThemeBootScript,
  merchantTimeThemeForHour
} from './merchant-theme.ts'

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    clear: vi.fn(),
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn()
  })
})

afterEach(() => {
  vi.useRealTimers()
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('class')
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-merchant-time-theme')
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('merchantTimeThemeForHour', () => {
  it.each([
    [0, 'night'],
    [4, 'night'],
    [5, 'morning'],
    [10, 'morning'],
    [11, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [19, 'evening'],
    [20, 'night'],
    [23, 'night']
  ] as const)('maps hour %i to %s', (hour, expected) => {
    expect(merchantTimeThemeForHour(hour)).toBe(expected)
  })

  it('sets the time-derived PWA surface before the first paint', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T18:00:00'))
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    document.head.innerHTML = `
      <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
      <meta name="theme-color" content="#171717" media="(prefers-color-scheme: dark)">
    `

    window.eval(merchantThemeBootScript)

    expect(document.documentElement.dataset.merchantTimeTheme).toBe('evening')
    expect(document.documentElement.style.backgroundColor).toBe('rgb(255, 247, 237)')
    expect(
      Array.from(
        document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      ).map((meta) => meta.content)
    ).toEqual(['rgb(255 247 237)', 'rgb(255 247 237)'])
  })

  it('keeps the live iOS status-bar theme color aligned with the app surface', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff">'

    applyMerchantTimeTheme(new Date('2026-07-22T20:00:00'))

    expect(document.documentElement.style.backgroundColor).toBe('rgb(17, 23, 32)')
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
    ).toBe('rgb(17 23 32)')
  })
})
