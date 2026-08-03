// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MobileSchedulePullSurface } from './mobile-schedule-pull-surface.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

function touchEvent(
  type: 'touchstart' | 'touchmove',
  { x, y }: { readonly x: number; readonly y: number }
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const touch = { identifier: 1, clientX: x, clientY: y }
  Object.defineProperties(event, {
    touches: { value: [touch] },
    changedTouches: { value: [touch] }
  })
  return event
}

async function renderSurface(scrollTop: number) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <main data-mobile-home-viewport="true">
        <MobileSchedulePullSurface
          greeting="Your day at a glance"
          summary="You have 3 appointments scheduled for Wednesday."
        >
          <div data-mobile-appointment-scroll="true">Appointments</div>
        </MobileSchedulePullSurface>
      </main>
    )
  )
  const region = container.querySelector<HTMLElement>(
    '[data-mobile-schedule-pull-region]'
  )
  const surface = container.querySelector<HTMLElement>(
    '[data-mobile-schedule-pull-surface]'
  )
  const scrollport = container.querySelector<HTMLElement>(
    '[data-mobile-appointment-scroll]'
  )
  const viewport = container.querySelector<HTMLElement>('[data-mobile-home-viewport]')
  if (!region || !surface || !scrollport || !viewport)
    throw new Error('Pull surface did not render')
  Object.defineProperty(region, 'clientHeight', { configurable: true, value: 800 })
  Object.defineProperty(scrollport, 'scrollTop', {
    configurable: true,
    value: scrollTop,
    writable: true
  })
  return { container, region, surface, viewport }
}

describe('MobileSchedulePullSurface', () => {
  it('has no visible simulated-sheet chrome before a pull starts', async () => {
    const { container, surface } = await renderSurface(0)

    expect(container.querySelector('button[aria-expanded]')).toBeNull()
    expect(surface.className).not.toContain('pt-5')
    expect(
      container.querySelector('[data-mobile-day-summary] .merchant-home-hero')
    ).not.toBeNull()
  })

  it('follows a downward finger pull when the appointment list is at the top', async () => {
    const { region, surface, viewport } = await renderSurface(0)

    await act(async () => {
      surface.dispatchEvent(touchEvent('touchstart', { x: 180, y: 300 }))
    })
    const move = touchEvent('touchmove', { x: 182, y: 420 })
    await act(async () => {
      surface.dispatchEvent(move)
    })

    expect(move.defaultPrevented).toBe(true)
    expect(surface.dataset.mobileSchedulePullState).toBe('dragging')
    expect(surface.style.getPropertyValue('--merchant-schedule-pull-y')).toBe('120px')
    expect(
      Number(region.style.getPropertyValue('--merchant-schedule-pull-progress'))
    ).toBeCloseTo(120 / 496)
    expect(
      Number(region.style.getPropertyValue('--merchant-schedule-pull-reveal-progress'))
    ).toBeCloseTo(1 - (1 - 120 / 496) ** 2)
    expect(
      Number(viewport.style.getPropertyValue('--merchant-schedule-pull-progress'))
    ).toBeCloseTo(120 / 496)
  })

  it('leaves downward movement with the native list while it is scrolled', async () => {
    const { surface } = await renderSurface(40)

    await act(async () => {
      surface.dispatchEvent(touchEvent('touchstart', { x: 180, y: 300 }))
    })
    const move = touchEvent('touchmove', { x: 182, y: 420 })
    await act(async () => {
      surface.dispatchEvent(move)
    })

    expect(move.defaultPrevented).toBe(false)
    expect(surface.dataset.mobileSchedulePullState).toBe('closed')
    expect(surface.style.getPropertyValue('--merchant-schedule-pull-y')).toBe('')
  })

  it('offers an accessible spring toggle for the day summary', async () => {
    const { container, surface } = await renderSurface(0)

    await act(async () => {
      surface.dispatchEvent(touchEvent('touchstart', { x: 180, y: 200 }))
      surface.dispatchEvent(touchEvent('touchmove', { x: 182, y: 620 }))
    })
    const end = new Event('touchend', { bubbles: true, cancelable: true })
    Object.defineProperties(end, {
      touches: { value: [] },
      changedTouches: {
        value: [{ identifier: 1, clientX: 182, clientY: 620 }]
      }
    })
    await act(async () => {
      surface.dispatchEvent(end)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    })

    expect(surface.dataset.mobileSchedulePullState).toBe('open')
    expect(
      container.querySelector('button[aria-label="Hide day summary"]')
    ).not.toBeNull()
    expect(
      container.querySelector('[data-mobile-day-summary]')?.getAttribute('aria-hidden')
    ).toBe('false')
  })
})
