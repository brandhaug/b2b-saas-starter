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

vi.mock('@/lib/server/merchant-catalog.ts', () => ({
  getMerchantCatalog: vi.fn(async () => ({
    presentation: 'solo',
    services: [
      {
        id: 'svc_deal',
        name: 'Take a deal',
        description: null,
        category: null,
        priceMinor: 9999,
        currency: 'USD',
        durationMinutes: 60,
        status: 'active',
        eligibleProviderIds: ['prv_mara']
      },
      {
        id: 'svc_beard',
        name: 'Beard Trimming',
        description: null,
        category: null,
        priceMinor: 2300,
        currency: 'USD',
        durationMinutes: 15,
        status: 'active',
        eligibleProviderIds: ['prv_mara']
      }
    ],
    providers: [
      {
        id: 'prv_mara',
        displayName: 'Mara Ionescu',
        isDefault: true,
        status: 'active',
        eligibleServiceIds: ['svc_deal', 'svc_beard']
      }
    ]
  }))
}))

vi.mock('@/lib/server/scheduling.ts', () => ({
  getAppointmentAvailability: vi.fn(async () => ({
    timezone: 'Europe/Bucharest',
    slots: [
      {
        startsAt: '2026-07-25T06:00:00.000Z',
        endsAt: '2026-07-25T06:15:00.000Z'
      },
      {
        startsAt: '2026-07-25T06:15:00.000Z',
        endsAt: '2026-07-25T06:30:00.000Z'
      },
      {
        startsAt: '2026-07-25T06:30:00.000Z',
        endsAt: '2026-07-25T06:45:00.000Z'
      },
      {
        startsAt: '2026-07-25T06:45:00.000Z',
        endsAt: '2026-07-25T07:00:00.000Z'
      },
      {
        startsAt: '2026-07-25T07:00:00.000Z',
        endsAt: '2026-07-25T07:15:00.000Z'
      },
      {
        startsAt: '2026-07-25T07:15:00.000Z',
        endsAt: '2026-07-25T07:30:00.000Z'
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
  it('opens the native modal on-screen before scheduling its entrance spring', async () => {
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
        events.push(
          `show-modal:${this.style.getPropertyValue('--merchant-sheet-translate-y')}`
        )
        this.setAttribute('open', '')
      }
    })

    try {
      await act(async () =>
        root?.render(<MobileNewAppointmentSheet open onRequestClose={vi.fn()} />)
      )
      expect(events[0]).toBe('show-modal:0px')
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

  it('opens recurrence at four weeks and applies a new frequency', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(<MobileNewAppointmentSheet open onRequestClose={vi.fn()} />)
    )

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-mobile-new-appointment-field="repeat"]'
        )
        ?.click()
    )

    const picker = container.querySelector('[data-mobile-recurrence-picker="true"]')
    expect(picker).not.toBeNull()
    expect(picker?.textContent).toContain('Weekly')
    expect(picker?.textContent).toContain('8 weeks')
    expect(
      container
        .querySelector('[data-mobile-recurrence-weeks="4"]')
        ?.getAttribute('aria-checked')
    ).toBe('true')

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-mobile-recurrence-weeks="6"]')
        ?.click()
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-mobile-recurrence-confirm="true"]')
        ?.click()
    )

    expect(container.querySelector('[data-mobile-recurrence-picker="true"]')).toBeNull()
    expect(
      container.querySelector('[data-mobile-new-appointment-field="repeat"]')
        ?.textContent
    ).toContain('Every 6 weeks')
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
    const selectedClientRow = container.querySelector(
      '[data-mobile-new-appointment-field="client"]'
    )
    expect(selectedClientRow?.textContent).toContain('Alex Raucescu')
    expect(selectedClientRow?.textContent).not.toContain('+40711111111')
    expect(selectedClientRow?.textContent).not.toContain('alex@example.test')
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-mobile-new-appointment-field="client-notes"]'
      )?.disabled
    ).toBe(false)
  })

  it('lets the merchant deselect a misclicked customer before confirming', async () => {
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

    const customer = container.querySelector<HTMLButtonElement>(
      '[data-mobile-client-option="apt_alex"]'
    )
    const search = container.querySelector<HTMLInputElement>(
      '[data-mobile-client-search="true"]'
    )
    const resultsScrollport = customer?.closest<HTMLElement>(
      '[data-mobile-sheet-scroll="true"]'
    )
    const results = customer?.closest<HTMLElement>(
      '[data-mobile-client-results="true"]'
    )

    expect(search?.closest('[data-mobile-sheet-scroll="true"]')).toBeNull()
    expect(resultsScrollport).not.toBeNull()
    expect(results).not.toBeNull()
    expect(results?.className).toContain('env(safe-area-inset-bottom)')

    await act(async () => customer?.click())

    expect(customer?.getAttribute('aria-pressed')).toBe('true')
    expect(
      container.querySelector('[data-mobile-client-confirm="true"]')
    ).not.toBeNull()
    expect(
      container.querySelector('[data-mobile-client-confirm-dock="true"]')?.className
    ).toContain('bg-linear-to-t')

    await act(async () => customer?.click())

    expect(customer?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-mobile-client-confirm="true"]')).toBeNull()
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

  it('selects a catalog service and expands the scheduling controls', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T05:00:00.000Z'))
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <MobileNewAppointmentSheet
          open
          appointmentDate="2026-07-25"
          onRequestClose={vi.fn()}
        />
      )
    )

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-mobile-new-appointment-field="service"]'
        )
        ?.click()
    )
    await act(async () => Promise.resolve())

    const service = container.querySelector<HTMLButtonElement>(
      '[data-mobile-service-option="svc_beard"]'
    )
    expect(
      container.querySelector('[data-mobile-service-picker="true"]')
    ).not.toBeNull()
    expect(service?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => service?.click())
    expect(service?.getAttribute('aria-pressed')).toBe('true')
    expect(
      container.querySelector('[data-mobile-service-confirm="true"]')
    ).not.toBeNull()

    await act(async () => service?.click())
    expect(service?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-mobile-service-confirm="true"]')).toBeNull()

    await act(async () => service?.click())
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-mobile-service-confirm="true"]')
        ?.click()
    )

    expect(
      container.querySelector('[data-mobile-new-appointment-form="true"]')
    ).not.toBeNull()
    expect(
      container.querySelector('[data-mobile-new-appointment-field="service"]')
        ?.textContent
    ).toContain('Beard Trimming')
    expect(
      container.querySelector('[data-mobile-appointment-duration="true"]')
    ).not.toBeNull()
    expect(
      container.querySelector('[data-mobile-appointment-date="2026-07-25"]')
    ).not.toBeNull()
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-mobile-appointment-date="2026-07-24"]'
      )?.disabled
    ).toBe(true)
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Choose appointment date"]'
      )?.min
    ).toBe('2026-07-25')
    expect(
      container.querySelector('[data-mobile-appointment-time="09:00"]')
    ).not.toBeNull()
    expect(container.querySelectorAll('[data-mobile-appointment-time]').length).toBe(6)
    expect(
      container.querySelector('[data-mobile-appointment-more-times="true"]')
    ).toBeNull()

    const scrollport = container.querySelector<HTMLElement>(
      '[data-mobile-new-appointment-form="true"] [data-mobile-sheet-scroll="true"]'
    )
    Object.defineProperty(scrollport, 'scrollTop', {
      configurable: true,
      value: 100
    })
    await act(async () => scrollport?.dispatchEvent(new Event('scroll')))
    expect(
      container
        .querySelector('[data-mobile-new-appointment-compact-header="true"]')
        ?.getAttribute('data-visible')
    ).toBe('true')
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
