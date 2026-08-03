import { describe, expect, it } from 'vitest'
import { mobileEdgeSpringOffset } from './use-mobile-edge-scroll-spring.ts'

describe('mobileEdgeSpringOffset', () => {
  it('springs down after a fast fling reaches the top edge', () => {
    expect(
      mobileEdgeSpringOffset({
        atBottom: false,
        atTop: true,
        velocity: -1
      })
    ).toBe(12)
  })

  it('springs up after a fast fling reaches the bottom edge', () => {
    expect(
      mobileEdgeSpringOffset({
        atBottom: true,
        atTop: false,
        velocity: 2
      })
    ).toBe(-16)
  })

  it('leaves slow and mid-list scrolling entirely native', () => {
    expect(
      mobileEdgeSpringOffset({
        atBottom: false,
        atTop: true,
        velocity: -0.2
      })
    ).toBe(0)
    expect(
      mobileEdgeSpringOffset({
        atBottom: false,
        atTop: false,
        velocity: -2
      })
    ).toBe(0)
  })
})
