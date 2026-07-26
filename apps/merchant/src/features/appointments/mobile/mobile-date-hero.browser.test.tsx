// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { domMax, LazyMotion } from 'motion/react'
import { MobileDateHero } from './mobile-date-hero.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

const hero = (
  date: string,
  currentDate: string,
  onOpenCalendar: () => void = () => undefined
) => (
  <LazyMotion features={domMax}>
    <MobileDateHero
      date={date}
      currentDate={currentDate}
      timezone="Europe/Bucharest"
      calendarOpen={false}
      onOpenCalendar={onOpenCalendar}
    />
  </LazyMotion>
)

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16)
  )
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('MobileDateHero current-day marker', () => {
  it('scales and fades on initial entry and date changes', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const onOpenCalendar = vi.fn()

    await act(async () => {
      root?.render(hero('2026-07-20', '2026-07-20', onOpenCalendar))
    })

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-mobile-date-calendar-trigger="true"]')
        ?.click()
    )
    expect(onOpenCalendar).toHaveBeenCalledOnce()

    const marker = container.querySelector<HTMLElement>(
      '[data-current-day-marker-slot="true"]'
    )
    expect(marker?.dataset.currentDayMarkerState).toBe('visible')
    expect(marker?.style.opacity).toBe('0')
    expect(marker?.style.transform).toContain('scale(0.7)')
    expect(marker?.style.filter).toBe('blur(6px)')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(marker?.style.transform).not.toBe('none')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200)
    })

    expect(marker?.dataset.currentDayMarkerState).toBe('visible')
    expect(marker?.style.opacity).toBe('1')
    expect(marker?.style.transform).not.toContain('scale(0.7)')
    expect(marker?.style.filter).toBe('blur(0px)')

    await act(async () => {
      root?.render(hero('2026-07-21', '2026-07-20'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(marker?.dataset.currentDayMarkerState).toBe('hidden')
    expect(marker?.style.opacity).toBe('0')
    expect(marker?.style.transform).toContain('scale(0.7)')
    expect(marker?.style.filter).toBe('blur(6px)')

    await act(async () => {
      root?.render(hero('2026-07-20', '2026-07-20'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(marker?.dataset.currentDayMarkerState).toBe('visible')
    expect(marker?.style.opacity).toBe('1')
    expect(marker?.style.transform).not.toContain('scale(0.7)')
    expect(marker?.style.filter).toBe('blur(0px)')
  })
})
