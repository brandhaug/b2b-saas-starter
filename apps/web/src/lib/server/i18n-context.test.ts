import { describe, expect, it } from 'vite-plus/test'
import { requestPresentation, withPresentation } from './i18n-context'

describe('request presentation', () => {
  it('isolates overlapping requests and falls back to anonymous UTC outside them', async () => {
    const norwegian = {
      timeZone: 'Europe/Oslo',
      authenticated: true,
      needsTimeZone: false
    }
    const american = {
      timeZone: 'America/New_York',
      authenticated: true,
      needsTimeZone: false
    }
    await Promise.all([
      withPresentation(norwegian, async () => {
        await Promise.resolve()
        expect(requestPresentation()).toEqual(norwegian)
      }),
      withPresentation(american, async () => {
        await Promise.resolve()
        expect(requestPresentation()).toEqual(american)
      })
    ])
    expect(requestPresentation()).toEqual({
      timeZone: 'UTC',
      authenticated: false,
      needsTimeZone: false
    })
  })
})
