// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileCalendarSheet } from './mobile-calendar-sheet.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() })
}))

describe('MobileCalendarSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.setAttribute('open', '')
        }
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.removeAttribute('open')
          this.dispatchEvent(new Event('close'))
        }
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.head
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.remove())
    document.documentElement.style.removeProperty('--merchant-home-surface')
    document.documentElement.style.removeProperty('--merchant-home-surface-rgb')
    document.body.innerHTML = ''
  })

  it('returns the calendar panel to its visible position when reopened', async () => {
    document.head.innerHTML += '<meta name="theme-color" content="rgb(224 242 254)">'
    document.documentElement.style.setProperty(
      '--merchant-home-surface',
      'rgb(224 242 254)'
    )
    document.documentElement.style.setProperty(
      '--merchant-home-surface-rgb',
      '224 242 254'
    )
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <div data-merchant-home-layer="true" />
          <button type="button" onClick={() => setOpen(true)}>
            Open calendar
          </button>
          <MobileCalendarSheet
            open={open}
            selectedDate="2026-07-27"
            currentDate="2026-07-27"
            onRequestClose={() => setOpen(false)}
          />
        </>
      )
    }

    await act(async () => root.render(<Harness />))
    const trigger = container.querySelector<HTMLButtonElement>('button')
    await act(async () => trigger?.click())
    await act(async () => vi.advanceTimersByTime(1_000))

    const closeTarget = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close calendar"]'
    )
    const closingPanel = container.querySelector<HTMLElement>(
      '.merchant-calendar-panel'
    )
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
    ).toBe('#000000')
    expect(
      document.body.style.getPropertyValue(
        '--merchant-mobile-sheet-outside-dim-opacity'
      )
    ).toBe('1')
    await act(async () => closeTarget?.click())
    expect(container.querySelector('dialog')?.dataset.calendarSheetState).toBe(
      'closing'
    )
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
    ).toBe('rgb(224 242 254)')
    expect(
      Number(
        document.body.style.getPropertyValue(
          '--merchant-mobile-sheet-outside-dim-opacity'
        )
      )
    ).toBeGreaterThan(0)
    await act(async () => vi.advanceTimersByTime(20))
    expect(
      Number(
        document.body.style.getPropertyValue(
          '--merchant-mobile-sheet-outside-dim-opacity'
        )
      )
    ).toBeGreaterThan(0)
    expect(closingPanel?.style.getPropertyValue('--merchant-calendar-drag-y')).toBe(
      '0px'
    )
    await act(async () => vi.advanceTimersByTime(1_000))
    await act(async () => trigger?.click())
    await act(async () => vi.advanceTimersByTime(1_000))

    const dialog = container.querySelector('dialog')
    const panel = container.querySelector<HTMLElement>('.merchant-calendar-panel')
    expect(dialog?.hasAttribute('open')).toBe(true)
    expect(panel?.style.getPropertyValue('--merchant-calendar-drag-y')).toBe('0px')
    await act(async () => root.unmount())
  })

  it('rings today while keeping the selected date filled', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <>
          <div data-merchant-home-layer="true" />
          <MobileCalendarSheet
            open
            selectedDate="2026-07-29"
            currentDate="2026-07-26"
            onRequestClose={vi.fn()}
          />
        </>
      )
    )
    await act(async () => vi.advanceTimersByTime(1_000))

    const today = container.querySelector<HTMLButtonElement>('[aria-current="date"]')
    const selected = container.querySelector<HTMLButtonElement>(
      '[aria-label="Wednesday, July 29, 2026"]'
    )

    expect(today?.getAttribute('aria-label')).toBe('Sunday, July 26, 2026')
    expect(today?.getAttribute('aria-pressed')).toBe('false')
    expect(today?.classList.contains('ring-2')).toBe(true)
    expect(today?.classList.contains('ring-primary')).toBe(true)
    expect(selected?.getAttribute('aria-pressed')).toBe('true')
    expect(selected?.classList.contains('bg-primary')).toBe(true)
    expect(selected?.hasAttribute('aria-current')).toBe(false)

    await act(async () => root.unmount())
  })
})
