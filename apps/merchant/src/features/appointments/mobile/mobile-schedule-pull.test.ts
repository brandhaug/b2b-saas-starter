import { describe, expect, it } from 'vitest'
import {
  mobileScheduleGreeting,
  mobileSchedulePullMaxOffset,
  mobileSchedulePullOffset,
  mobileSchedulePullRevealProgress,
  mobileSchedulePullTarget,
  mobileSchedulePullVelocity,
  shouldBeginMobileSchedulePull
} from './mobile-schedule-pull.ts'

describe('mobile schedule pull surface', () => {
  it('uses the merchant timezone for the summary greeting', () => {
    const instant = new Date('2026-07-22T15:30:00.000Z')
    expect(mobileScheduleGreeting('Europe/Bucharest', instant)).toBe('Good evening')
    expect(mobileScheduleGreeting('America/New_York', instant)).toBe('Good morning')
    expect(mobileScheduleGreeting('Europe/Bucharest', instant, 'Vlad Pop')).toBe(
      'Good evening, Vlad'
    )
  })

  it('only takes a downward gesture from the top of the appointment list', () => {
    expect(
      shouldBeginMobileSchedulePull({
        deltaX: 2,
        deltaY: 18,
        expanded: false,
        scrollTop: 0
      })
    ).toBe(true)
    expect(
      shouldBeginMobileSchedulePull({
        deltaX: 2,
        deltaY: 18,
        expanded: false,
        scrollTop: 20
      })
    ).toBe(false)
    expect(
      shouldBeginMobileSchedulePull({
        deltaX: 2,
        deltaY: -18,
        expanded: false,
        scrollTop: 0
      })
    ).toBe(false)
  })

  it('lets an upward gesture close an expanded surface', () => {
    expect(
      shouldBeginMobileSchedulePull({
        deltaX: 2,
        deltaY: -18,
        expanded: true,
        scrollTop: 0
      })
    ).toBe(true)
  })

  it('tracks the finger without moving beyond either resting position', () => {
    expect(
      mobileSchedulePullOffset({ deltaY: 120, maxOffset: 320, startOffset: 0 })
    ).toBe(120)
    expect(
      mobileSchedulePullOffset({ deltaY: 80, maxOffset: 320, startOffset: 320 })
    ).toBe(320)
    expect(
      mobileSchedulePullOffset({ deltaY: -400, maxOffset: 320, startOffset: 320 })
    ).toBe(0)
  })

  it('commits by distance or directional flick velocity', () => {
    const maxOffset = 320
    expect(mobileSchedulePullTarget({ maxOffset, offset: 180, velocity: 0 })).toBe(320)
    expect(mobileSchedulePullTarget({ maxOffset, offset: 80, velocity: 700 })).toBe(320)
    expect(mobileSchedulePullTarget({ maxOffset, offset: 240, velocity: -700 })).toBe(0)
    expect(mobileSchedulePullTarget({ maxOffset, offset: 80, velocity: 0 })).toBe(0)
    expect(mobileSchedulePullVelocity(70, 100)).toBe(700)
  })

  it('uses a bounded reveal height across phone sizes', () => {
    expect(mobileSchedulePullMaxOffset(568)).toBeCloseTo(352.16)
    expect(mobileSchedulePullMaxOffset(844)).toBeCloseTo(523.28)
    expect(mobileSchedulePullMaxOffset(1_200)).toBe(560)
  })

  it('reveals the sheet chrome early while preserving exact endpoints', () => {
    expect(mobileSchedulePullRevealProgress(0)).toBe(0)
    expect(mobileSchedulePullRevealProgress(0.5)).toBe(0.75)
    expect(mobileSchedulePullRevealProgress(1)).toBe(1)
  })
})
