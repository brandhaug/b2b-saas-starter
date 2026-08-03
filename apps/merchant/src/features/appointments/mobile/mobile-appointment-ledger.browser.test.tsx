// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { MobileAppointmentLedger } from './mobile-appointment-ledger.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const calendar = {
  date: '2026-07-23',
  timezone: 'Europe/Bucharest',
  providers: []
}

function pointerEvent(
  type: 'pointercancel' | 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: y }
  })
  return event
}

describe('MobileAppointmentLedger day swipe', () => {
  it('moves to the next day on a left swipe and the previous day on a right swipe', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSwipeDay = vi.fn()
    await act(async () =>
      root.render(
        <MobileAppointmentLedger
          calendar={calendar}
          previousCalendar={{ ...calendar, date: '2026-07-22' }}
          nextCalendar={{ ...calendar, date: '2026-07-24' }}
          onSwipeDay={onSwipeDay}
          scrollable
        />
      )
    )
    const carousel = container.querySelector<HTMLElement>(
      '[data-mobile-appointment-carousel="true"]'
    )
    const ledger = container.querySelector<HTMLElement>(
      '[data-mobile-appointment-scroll="true"]'
    )
    if (!carousel || !ledger) throw new Error('Expected mobile appointment carousel')
    Object.defineProperty(carousel, 'clientWidth', {
      configurable: true,
      value: 360
    })
    expect(
      carousel.querySelector<HTMLElement>(
        '[data-mobile-appointment-day-panel="previous"]'
      )?.dataset.mobileAppointmentDay
    ).toBe('2026-07-22')
    expect(
      carousel.querySelector<HTMLElement>('[data-mobile-appointment-day-panel="next"]')
        ?.dataset.mobileAppointmentDay
    ).toBe('2026-07-24')

    await act(async () => {
      ledger.dispatchEvent(pointerEvent('pointerdown', 290, 180))
      ledger.dispatchEvent(pointerEvent('pointermove', 190, 184))
    })
    expect(carousel.dataset.mobileAppointmentDaySwipeState).toBe('dragging')
    expect(carousel.style.getPropertyValue('--merchant-appointment-day-swipe-x')).toBe(
      '-100px'
    )

    await act(async () => {
      ledger.dispatchEvent(pointerEvent('pointerup', 190, 184))
    })
    expect(onSwipeDay).toHaveBeenLastCalledWith('next')
    expect(carousel.dataset.mobileAppointmentDaySwipeState).toBe('outgoing')
    expect(carousel.style.getPropertyValue('--merchant-appointment-day-swipe-x')).toBe(
      '-100px'
    )

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(carousel.dataset.mobileAppointmentDaySwipeState).toBe('idle')
    expect(carousel.style.getPropertyValue('--merchant-appointment-day-swipe-x')).toBe(
      '0px'
    )

    await act(async () => {
      ledger.dispatchEvent(pointerEvent('pointerdown', 80, 180))
      ledger.dispatchEvent(pointerEvent('pointermove', 190, 184))
      ledger.dispatchEvent(pointerEvent('pointerup', 190, 184))
    })
    expect(onSwipeDay).toHaveBeenLastCalledWith('previous')
    expect(onSwipeDay).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
    container.remove()
  })

  it('leaves vertical movement to native appointment scrolling', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSwipeDay = vi.fn()
    await act(async () =>
      root.render(
        <MobileAppointmentLedger
          calendar={calendar}
          onSwipeDay={onSwipeDay}
          scrollable
        />
      )
    )
    const carousel = container.querySelector<HTMLElement>(
      '[data-mobile-appointment-carousel="true"]'
    )
    const ledger = container.querySelector<HTMLElement>(
      '[data-mobile-appointment-scroll="true"]'
    )
    if (!carousel || !ledger) throw new Error('Expected mobile appointment carousel')

    const move = pointerEvent('pointermove', 276, 290)
    await act(async () => {
      ledger.dispatchEvent(pointerEvent('pointerdown', 280, 180))
      ledger.dispatchEvent(move)
      ledger.dispatchEvent(pointerEvent('pointerup', 276, 290))
    })

    expect(move.defaultPrevented).toBe(false)
    expect(onSwipeDay).not.toHaveBeenCalled()

    await act(async () => {
      ledger.dispatchEvent(pointerEvent('pointerdown', 280, 180))
      ledger.dispatchEvent(pointerEvent('pointermove', 180, 184))
    })
    expect(carousel.dataset.mobileAppointmentDaySwipeState).toBe('dragging')
    expect(carousel.style.getPropertyValue('--merchant-appointment-day-swipe-x')).toBe(
      '-100px'
    )
    await act(async () => {
      ledger.dispatchEvent(pointerEvent('pointercancel', 180, 184))
    })
    expect(onSwipeDay).not.toHaveBeenCalled()
    expect(carousel.dataset.mobileAppointmentDaySwipeState).toBe('settling')
    expect(carousel.style.getPropertyValue('--merchant-appointment-day-swipe-x')).toBe(
      '-100px'
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(carousel.dataset.mobileAppointmentDaySwipeState).toBe('idle')
    expect(carousel.style.getPropertyValue('--merchant-appointment-day-swipe-x')).toBe(
      '0px'
    )
    await act(async () => root.unmount())
    container.remove()
  })
})
