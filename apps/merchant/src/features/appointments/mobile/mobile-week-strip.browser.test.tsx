// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileWeekStrip } from './mobile-week-strip.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    viewTransition: _viewTransition,
    ...props
  }: {
    readonly children: ReactNode
    readonly to: string
    readonly search: { readonly date: string }
    readonly viewTransition?: boolean
  }) => (
    <a href={`${to}?date=${search.date}`} {...props}>
      {children}
    </a>
  )
}))

function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY = 80
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    isPrimary: { value: true },
    button: { value: 0 }
  })
  return event
}

describe('MobileWeekStrip navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 16)
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('moves one week from the desktop controls while preserving Wednesday', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSelectDate = vi.fn()

    await act(async () =>
      root.render(
        <MobileWeekStrip
          selectedDate="2026-07-22"
          currentDate="2026-07-22"
          spacing="desktop"
          onSelectDate={onSelectDate}
        />
      )
    )
    const viewport = container.querySelector<HTMLElement>(
      '[data-week-strip-viewport="true"]'
    )
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 350 })

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Next week"]')
        ?.click()
    )

    expect(onSelectDate).toHaveBeenCalledWith('2026-07-29')
    expect(
      container.querySelector<HTMLElement>('[data-week-strip-track="true"]')?.style
        .transition
    ).toContain('transform 240ms')
    await act(async () => root.unmount())
  })

  it('commits a horizontal mobile swipe and ignores the vertical scroll axis', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSelectDate = vi.fn()

    await act(async () =>
      root.render(
        <MobileWeekStrip
          selectedDate="2026-07-22"
          currentDate="2026-07-22"
          onSelectDate={onSelectDate}
        />
      )
    )
    const viewport = container.querySelector<HTMLElement>(
      '[data-week-strip-viewport="true"]'
    )
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 350 })

    await act(async () => viewport?.dispatchEvent(pointerEvent('pointerdown', 280)))
    await act(async () => viewport?.dispatchEvent(pointerEvent('pointermove', 180)))
    await act(async () => viewport?.dispatchEvent(pointerEvent('pointerup', 180)))

    expect(onSelectDate).toHaveBeenCalledWith('2026-07-29')
    expect(
      container.querySelector<HTMLElement>('[data-week-strip-track="true"]')?.style
        .transition
    ).toContain('171ms')
    await act(async () => root.unmount())
  })

  it('mounts a routed week without replaying a second track animation', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <MobileWeekStrip
          selectedDate="2026-07-29"
          currentDate="2026-07-22"
          onSelectDate={vi.fn()}
        />
      )
    )

    expect(
      container.querySelector<HTMLElement>('[data-week-strip-track="true"]')?.style
        .transition
    ).toBe('none')
    await act(async () => root.unmount())
  })

  it('keeps one transition when routed data arrives before the optimistic slide ends', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSelectDate = vi.fn()

    await act(async () =>
      root.render(
        <MobileWeekStrip
          selectedDate="2026-07-22"
          currentDate="2026-07-22"
          spacing="desktop"
          onSelectDate={onSelectDate}
        />
      )
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Next week"]')
        ?.click()
    )
    await act(async () =>
      root.render(
        <MobileWeekStrip
          selectedDate="2026-07-29"
          currentDate="2026-07-22"
          spacing="desktop"
          onSelectDate={onSelectDate}
        />
      )
    )

    expect(
      container
        .querySelector('nav[aria-label="Appointment week"]')
        ?.getAttribute('data-week-strip-state')
    ).toBe('settling')
    await act(async () => vi.advanceTimersByTime(240))
    expect(
      container
        .querySelector('nav[aria-label="Appointment week"]')
        ?.getAttribute('data-week-strip-state')
    ).toBe('idle')
    expect(
      container.querySelector<HTMLElement>('[data-week-strip-track="true"]')?.style
        .transition
    ).toBe('none')
    await act(async () => root.unmount())
  })

  it('slides directionally when the Today action changes to another week', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <MobileWeekStrip
          selectedDate="2026-07-22"
          currentDate="2026-08-12"
          onSelectDate={vi.fn()}
        />
      )
    )
    await act(async () =>
      root.render(
        <MobileWeekStrip
          selectedDate="2026-08-12"
          currentDate="2026-08-12"
          onSelectDate={vi.fn()}
        />
      )
    )
    await act(async () => vi.advanceTimersByTime(16))

    expect(
      container
        .querySelector('nav[aria-label="Appointment week"]')
        ?.getAttribute('data-week-strip-state')
    ).toBe('changing')
    expect(
      container.querySelector<HTMLElement>('[data-week-strip-track="true"]')?.style
        .transform
    ).toContain('-50%')
    expect(container.textContent).toContain('12')

    await act(async () => vi.advanceTimersByTime(400))
    await act(async () => root.unmount())
  })
})
