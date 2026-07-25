// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNewAppointmentSheet } from './mobile-new-appointment-sheet.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ search: {}, state: {} }),
  useRouter: () => ({ history: { back: vi.fn() }, navigate: vi.fn() })
}))

vi.mock('@/lib/server/appointment-operations.ts', () => ({
  getCustomerDirectory: vi.fn(async () => ({
    timezone: 'Europe/Bucharest',
    entries: [
      {
        appointmentId: 'apt_alex',
        appointmentStatus: 'scheduled',
        scheduledAt: '2026-07-25T10:00:00.000Z',
        name: 'Alex Raucescu',
        email: 'alex@example.test',
        phone: '+40711111111'
      },
      {
        appointmentId: 'apt_bianca',
        appointmentStatus: 'completed',
        scheduledAt: '2026-07-20T10:00:00.000Z',
        name: 'Bianca Trifan',
        email: 'bianca@example.test',
        phone: '+40722222222'
      }
    ]
  }))
}))

let root: Root | undefined

const setNativeInputValue = (input: HTMLInputElement, value: string) => {
  // React tracks controlled values; invoking the platform setter makes the input
  // event exercise the same path as a real keyboard edit in jsdom.
  // oxlint-disable-next-line typescript/unbound-method
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  if (setter) Reflect.apply(setter, input, [value])
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

describe('MobileNewAppointmentSheet interaction', () => {
  it('puts the native modal in the top layer before scheduling its entrance spring', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const events: string[] = []
    // oxlint-disable-next-line typescript/unbound-method
    const originalShowModal = HTMLDialogElement.prototype.showModal
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      events.push('spring-frame')
      return 1
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value(this: HTMLDialogElement) {
        events.push('show-modal')
        this.setAttribute('open', '')
      }
    })

    try {
      await act(async () =>
        root?.render(<MobileNewAppointmentSheet open onRequestClose={vi.fn()} />)
      )
      expect(events[0]).toBe('show-modal')
      expect(events).toContain('spring-frame')
      expect(document.activeElement).toBe(
        container.querySelector('[data-mobile-new-appointment-sheet="true"]')
      )
    } finally {
      frame.mockRestore()
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
        configurable: true,
        value: originalShowModal
      })
    }
  })

  it('lets the merchant toggle customer notifications', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(<MobileNewAppointmentSheet open onRequestClose={vi.fn()} />)
    )

    const notify = container.querySelector<HTMLButtonElement>(
      '[data-mobile-new-appointment-notify="true"]'
    )
    expect(notify?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => notify?.click())
    expect(notify?.getAttribute('aria-pressed')).toBe('false')
  })

  it('selects an existing customer and returns the choice to the appointment draft', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(<MobileNewAppointmentSheet open onRequestClose={vi.fn()} />)
    )

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-mobile-new-appointment-field="client"]'
        )
        ?.click()
    )
    await act(async () => Promise.resolve())

    expect(container.querySelector('[data-mobile-client-picker="true"]')).not.toBeNull()
    expect(container.textContent).toContain('Alex Raucescu')

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-mobile-client-option="apt_alex"]')
        ?.click()
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-mobile-client-confirm="true"]')
        ?.click()
    )

    expect(
      container.querySelector('[data-mobile-new-appointment-form="true"]')
    ).not.toBeNull()
    expect(container.textContent).toContain('Alex Raucescu')
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-mobile-new-appointment-field="client-notes"]'
      )?.disabled
    ).toBe(false)
  })

  it('filters clients and adds draft customer details to the appointment', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(<MobileNewAppointmentSheet open onRequestClose={vi.fn()} />)
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-mobile-new-appointment-field="client"]'
        )
        ?.click()
    )
    await act(async () => Promise.resolve())

    const search = container.querySelector<HTMLInputElement>(
      '[data-mobile-client-search="true"]'
    )
    await act(async () => {
      if (!search) return
      setNativeInputValue(search, 'Bianca')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).not.toContain('Alex Raucescu')
    expect(container.textContent).toContain('Bianca Trifan')

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-mobile-add-client="true"]')
        ?.click()
    )
    expect(container.textContent).toContain('Add a new client')

    const fill = async (name: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`)
      await act(async () => {
        if (!input) return
        setNativeInputValue(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await fill('firstName', 'Mara')
    await fill('lastName', 'Ionescu')
    await fill('email', 'mara@example.test')

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-mobile-add-client-save="true"]')
        ?.click()
    )

    expect(container.textContent).toContain('Mara Ionescu')
    expect(
      container.querySelector('[data-mobile-new-appointment-form="true"]')
    ).not.toBeNull()
  })

  it('routes native cancellation through the spring close lifecycle', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const onRequestClose = vi.fn()

    await act(async () =>
      root?.render(<MobileNewAppointmentSheet open onRequestClose={onRequestClose} />)
    )

    const dialog = container.querySelector<HTMLDialogElement>(
      '[data-mobile-new-appointment-sheet="true"]'
    )
    const cancel = new Event('cancel', { bubbles: false, cancelable: true })
    await act(async () => dialog?.dispatchEvent(cancel))

    expect(cancel.defaultPrevented).toBe(true)
    expect(dialog?.dataset.mobileSheetState).toBe('closing')
    expect(onRequestClose).not.toHaveBeenCalled()

    await act(async () => new Promise((resolve) => setTimeout(resolve, 1_000)))
    expect(onRequestClose).toHaveBeenCalledOnce()
  })
})
