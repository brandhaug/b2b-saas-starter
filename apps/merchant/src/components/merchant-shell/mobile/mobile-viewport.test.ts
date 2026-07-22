import { describe, expect, it } from 'vitest'
import { mobileViewportHeight } from './mobile-viewport.ts'

describe('mobileViewportHeight', () => {
  it('uses the visible viewport while browser chrome or a keyboard is present', () => {
    expect(
      mobileViewportHeight({
        innerHeight: 844,
        visualViewport: { height: 512 }
      })
    ).toBe(512)
  })

  it('falls back to the layout viewport where Visual Viewport is unavailable', () => {
    expect(mobileViewportHeight({ innerHeight: 667, visualViewport: null })).toBe(667)
  })

  it('never returns a non-positive drag boundary', () => {
    expect(mobileViewportHeight({ innerHeight: 0, visualViewport: null })).toBe(1)
  })
})
