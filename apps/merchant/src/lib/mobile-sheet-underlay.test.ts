import { describe, expect, it } from 'vitest'
import { shouldReconstructMobileHomeUnderlay } from './mobile-sheet-underlay.ts'

describe('shouldReconstructMobileHomeUnderlay', () => {
  it('reconstructs home for refreshed mobile sheet routes', () => {
    expect(
      shouldReconstructMobileHomeUnderlay({
        pathname: '/customers',
        presentation: 'mobile',
        navigationState: undefined,
        documentRequest: true
      })
    ).toBe(true)
  })

  it('reconstructs after refresh even when browser history retains sheet state', () => {
    expect(
      shouldReconstructMobileHomeUnderlay({
        pathname: '/customers',
        presentation: 'mobile',
        navigationState: { mobileSheetOrigin: 'merchant-app' },
        documentRequest: true
      })
    ).toBe(true)
  })

  it('uses the retained page for an in-app sheet navigation', () => {
    expect(
      shouldReconstructMobileHomeUnderlay({
        pathname: '/customers',
        presentation: 'mobile',
        navigationState: { mobileSheetOrigin: 'merchant-app' },
        documentRequest: false
      })
    ).toBe(false)
  })

  it('does not load a mobile underlay for home, auth, or desktop routes', () => {
    expect(
      shouldReconstructMobileHomeUnderlay({
        pathname: '/appointments',
        presentation: 'mobile',
        navigationState: undefined,
        documentRequest: true
      })
    ).toBe(false)
    expect(
      shouldReconstructMobileHomeUnderlay({
        pathname: '/sign-in',
        presentation: 'mobile',
        navigationState: undefined,
        documentRequest: true
      })
    ).toBe(false)
    expect(
      shouldReconstructMobileHomeUnderlay({
        pathname: '/customers',
        presentation: 'desktop',
        navigationState: undefined,
        documentRequest: true
      })
    ).toBe(false)
  })
})
