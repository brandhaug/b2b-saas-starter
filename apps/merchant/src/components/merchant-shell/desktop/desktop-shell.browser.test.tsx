// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MerchantPresentationProvider } from '../merchant-presentation.tsx'
import type { MerchantDestination } from '../navigation.tsx'
import { DesktopShell } from './desktop-shell.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search: _search,
    state: _state,
    viewTransition: _viewTransition,
    activeProps: _activeProps,
    inactiveProps: _inactiveProps,
    ...props
  }: {
    children: ReactNode
    to: string
    search?: unknown
    state?: unknown
    viewTransition?: boolean
    activeProps?: unknown
    inactiveProps?: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ({ search: { date: '2026-07-27' } }),
  useRouter: () => ({ navigate: mocks.navigate })
}))

const destinations: readonly MerchantDestination[] = [
  { label: 'Appointments', to: '/appointments' },
  { label: 'Walk-ins', to: '/walk-ins' },
  { label: 'Customers', to: '/customers' },
  { label: 'Services', to: '/services' },
  { label: 'Providers', to: '/providers' },
  { label: 'Availability', to: '/availability' },
  { label: 'Settings', to: '/settings' }
]

let root: Root | undefined

beforeEach(() => {
  vi.useFakeTimers()
  mocks.navigate.mockReset()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
  })
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('DesktopRouteModal motion', () => {
  it('opens appointment creation as a native desktop dialog without mobile chrome', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <DesktopShell
          layout="home"
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Appointments"
          description="Appointments home"
          headerDate="2026-07-27"
          headerTimezone="Europe/Bucharest"
        >
          <p>Real appointments page</p>
        </DesktopShell>
      )
    )

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-desktop-home-create-action="new-appointment"]'
        )
        ?.click()
    )

    const dialog = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-new-appointment-dialog'
    )
    expect(dialog?.open).toBe(true)
    expect(dialog?.dataset.newAppointmentPresentation).toBe('desktop')
    expect(dialog?.querySelector('[data-mobile-sheet-handle]')).toBeNull()
    expect(document.documentElement.classList).not.toContain('merchant-mobile-document')

    const repeat = dialog?.querySelector<HTMLButtonElement>(
      '[data-mobile-new-appointment-field="repeat"]'
    )
    await act(async () => repeat?.click())
    expect(dialog?.dataset.desktopSubstepOpen).toBe('true')
    expect(dialog?.dataset.newAppointmentStep).toBe('appointment')
    const sidecar = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-new-appointment-sidecar'
    )
    expect(sidecar?.open).toBe(true)
    expect(sidecar?.dataset.desktopSubstep).toBe('recurrence')
    expect(dialog?.contains(sidecar ?? null)).toBe(false)
    expect(
      sidecar?.querySelector('[data-desktop-new-appointment-recurrence="true"]')
    ).not.toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Close recurrence picker'
    )

    await act(async () =>
      sidecar
        ?.querySelector<HTMLButtonElement>('[aria-label="Close recurrence picker"]')
        ?.click()
    )
    expect(sidecar?.dataset.desktopSubstepState).toBe('closing')

    await act(async () => vi.advanceTimersByTime(200))
    expect(
      container.querySelector('.merchant-desktop-new-appointment-sidecar')
    ).toBeNull()
    expect(
      document.activeElement?.getAttribute('data-mobile-new-appointment-field')
    ).toBe('repeat')

    await act(async () =>
      dialog
        ?.querySelector<HTMLButtonElement>('[aria-label="Close new appointment"]')
        ?.click()
    )
    expect(dialog?.dataset.mobileSheetState).toBe('closing')

    await act(async () => vi.advanceTimersByTime(200))
    expect(
      container.querySelector('.merchant-desktop-new-appointment-dialog')
    ).toBeNull()
  })

  it('keeps the real appointments page behind an in-app modal transition', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <MerchantPresentationProvider presentation="desktop">
          <div>
            <DesktopShell
              layout="home"
              section={{ kind: 'merchant' }}
              destinations={destinations}
              title="Appointments"
              description="Appointments home"
              headerDate="2026-07-27"
              headerTimezone="Europe/Bucharest"
            >
              <p data-appointments-home="true">Real appointments page</p>
            </DesktopShell>
          </div>
        </MerchantPresentationProvider>
      )
    )

    const homeBefore = container.querySelector('[data-appointments-home="true"]')
    const homeScroll = container.querySelector<HTMLElement>(
      '.merchant-desktop-home-card > div'
    )
    if (homeScroll) homeScroll.scrollTop = 37

    await act(async () =>
      root?.render(
        <MerchantPresentationProvider presentation="desktop">
          <div>
            <DesktopShell
              layout="home"
              section={{ kind: 'merchant' }}
              destinations={destinations}
              title="Appointments"
              description="Appointments home"
              headerDate="2026-07-27"
              headerTimezone="Europe/Bucharest"
            >
              <p data-appointments-home="true">Real appointments page</p>
            </DesktopShell>
            <DesktopShell
              layout="modal"
              section={{ kind: 'merchant' }}
              destinations={destinations}
              title="Customers"
              description="Customer history"
            >
              <p>Customer route</p>
            </DesktopShell>
          </div>
        </MerchantPresentationProvider>
      )
    )

    expect(container.querySelector('[data-appointments-home="true"]')).toBe(homeBefore)
    expect(homeScroll?.scrollTop).toBe(37)
    expect(container.textContent).not.toContain('Your day')
  })

  it('finishes its exit motion before navigating home', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <DesktopShell
          layout="modal"
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Customers"
          description="Customer history"
        >
          <p>Customer route</p>
        </DesktopShell>
      )
    )

    const dialog = container.querySelector<HTMLDialogElement>('dialog')
    const close = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close Customers"]'
    )

    await act(async () => close?.click())
    expect(dialog?.dataset.desktopModalState).toBe('closing')
    expect(mocks.navigate).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(200))

    expect(mocks.navigate).toHaveBeenCalledOnce()
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/appointments',
      search: { date: '2026-07-27' }
    })
  })
})
