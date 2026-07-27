// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MerchantSettingsPanel } from '@/components/merchant-settings-panel.tsx'
import { MerchantAdvancedSettings } from '@/components/merchant-advanced-settings.tsx'
import { MerchantSubscriptionPanel } from '@/components/merchant-subscription-panel.tsx'
import { MerchantThemeControl } from '@/components/merchant-theme-control.tsx'
import { MerchantPresentationProvider } from '../merchant-presentation.tsx'
import type { MerchantDestination } from '../navigation.tsx'
import { DesktopSecondaryDialogRoute } from './desktop-secondary-dialog-route.tsx'
import { DesktopShell } from './desktop-shell.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  location: {
    pathname: '/settings',
    search: { date: '2026-07-27' },
    state: undefined as undefined | { merchantOverlayOrigin: 'merchant-app' }
  },
  historyBack: vi.fn(),
  navigate: vi.fn()
}))

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
  useLocation: () => mocks.location,
  useRouter: () => ({
    history: { back: mocks.historyBack },
    navigate: mocks.navigate
  })
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
  mocks.location.pathname = '/settings'
  mocks.location.state = undefined
  mocks.historyBack.mockReset()
  mocks.navigate.mockReset()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn()
    }
  })
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

async function finishDialogEntrance(dialog: HTMLDialogElement | null) {
  await act(async () => {
    for (const eventName of ['animationend', 'webkitAnimationEnd']) {
      const event = new Event(eventName, { bubbles: true })
      Object.defineProperty(event, 'animationName', {
        value: 'merchant-desktop-modal-enter'
      })
      dialog?.dispatchEvent(event)
    }
  })
}

function mockDialogRect(dialog: HTMLDialogElement | null) {
  vi.spyOn(dialog as HTMLDialogElement, 'getBoundingClientRect').mockReturnValue({
    bottom: 600,
    height: 500,
    left: 100,
    right: 500,
    top: 100,
    width: 400,
    x: 100,
    y: 100,
    toJSON: () => ({})
  })
}

describe('DesktopRouteModal motion', () => {
  it('does not animate persistent dialog content when the desktop route changes', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <DesktopShell
          layout="modal"
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Settings"
          description="Merchant settings"
        >
          <p>Settings content</p>
        </DesktopShell>
      )
    )

    const dialog = container.querySelector<HTMLDialogElement>('.merchant-desktop-modal')
    await finishDialogEntrance(dialog)

    expect(dialog?.dataset.desktopModalState).toBe('open')
    expect(
      container.querySelector('[data-desktop-primary-route-motion="true"]')
    ).toBeNull()

    mocks.location.pathname = '/services'
    await act(async () =>
      root?.render(
        <DesktopShell
          layout="modal"
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Services"
          description="Merchant services"
        >
          <p>Services content</p>
        </DesktopShell>
      )
    )

    expect(
      container.querySelector('[data-desktop-primary-route-motion="true"]')
    ).toBeNull()
  })

  it('closes from a backdrop click without treating blank dialog space as backdrop', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <DesktopShell
          layout="modal"
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Settings"
          description="Merchant settings"
        >
          <p>Settings content</p>
        </DesktopShell>
      )
    )

    const dialog = container.querySelector<HTMLDialogElement>('.merchant-desktop-modal')
    mockDialogRect(dialog)
    await finishDialogEntrance(dialog)

    await act(async () =>
      dialog?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 200 })
      )
    )
    expect(dialog?.dataset.desktopModalState).toBe('open')

    await act(async () =>
      dialog?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 })
      )
    )
    expect(dialog?.dataset.desktopModalState).toBe('closing')

    await act(async () => vi.advanceTimersByTime(200))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/appointments',
      search: { date: '2026-07-27' }
    })
  })

  it('closes the entire routed overlay from the primary X instead of returning to its origin dialog', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.location.pathname = '/services'
    mocks.location.state = { merchantOverlayOrigin: 'merchant-app' }

    await act(async () =>
      root?.render(
        <DesktopShell
          layout="modal"
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Services"
          description="Merchant services"
        >
          <p>Services content</p>
        </DesktopShell>
      )
    )

    await finishDialogEntrance(
      container.querySelector<HTMLDialogElement>('.merchant-desktop-modal')
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close Services"]')
        ?.click()
    )
    await act(async () => vi.advanceTimersByTime(200))

    expect(mocks.historyBack).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/appointments',
      search: { date: '2026-07-27' }
    })
  })

  it('closes only the latest dialog from a backdrop click', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <DesktopShell
          layout="modal"
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Settings"
          description="Merchant settings"
        >
          <MerchantSettingsPanel
            appointmentDate="2026-07-27"
            signOut={{ error: null, pending: false, signOut: vi.fn() }}
            viewer={{ name: 'Mara Ionescu', email: 'mara@example.com', image: null }}
          />
          <DesktopSecondaryDialogRoute
            id="appearance"
            title="Appearance"
            onAfterClose={vi.fn()}
          >
            <MerchantThemeControl />
          </DesktopSecondaryDialogRoute>
        </DesktopShell>
      )
    )

    const primary = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-modal'
    )
    mockDialogRect(primary)
    await finishDialogEntrance(primary)
    await act(async () => vi.advanceTimersByTime(16))
    await act(async () => vi.advanceTimersByTime(500))

    const sidecar = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-sidecar'
    )
    expect(sidecar?.dataset.desktopSecondaryState).toBe('open')

    await act(async () =>
      primary?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 })
      )
    )

    expect(primary?.dataset.desktopModalState).toBe('open')
    expect(sidecar?.dataset.desktopSecondaryState).toBe('closing')
    expect(mocks.navigate).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(180))
    expect(container.querySelector('.merchant-desktop-sidecar')).toBeNull()
    expect(primary?.dataset.desktopModalState).toBe('open')

    await act(async () =>
      primary?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 })
      )
    )

    expect(primary?.dataset.desktopModalState).toBe('closing')
  })

  it('opens Appearance in a second desktop dialog and restores row focus', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const renderDetail = async (detail: 'appearance' | 'advanced') =>
      act(async () =>
        root?.render(
          <DesktopShell
            layout="modal"
            section={{ kind: 'merchant' }}
            destinations={destinations}
            title="Settings"
            description="Merchant settings"
          >
            <MerchantSettingsPanel
              appointmentDate="2026-07-27"
              signOut={{ error: null, pending: false, signOut: vi.fn() }}
              viewer={{
                name: 'Mara Ionescu',
                email: 'mara@example.com',
                image: null
              }}
            />
            <DesktopSecondaryDialogRoute
              key={detail}
              id={detail}
              title={detail === 'appearance' ? 'Appearance' : 'Advanced'}
              onAfterClose={vi.fn()}
            >
              {detail === 'appearance' ? (
                <MerchantThemeControl />
              ) : (
                <MerchantAdvancedSettings />
              )}
            </DesktopSecondaryDialogRoute>
          </DesktopShell>
        )
      )

    await renderDetail('appearance')

    const primary = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-modal'
    )
    const sidecar = document.body.querySelector<HTMLDialogElement>(
      '.merchant-desktop-sidecar'
    )
    expect(primary?.dataset.desktopSecondaryOpen).toBe('true')
    expect(sidecar?.open).toBe(true)
    expect(sidecar?.dataset.desktopSecondaryDialog).toBe('appearance')
    expect(sidecar?.dataset.desktopSecondaryState).toBe('preparing')
    expect(sidecar?.textContent).toContain('Appearance')
    expect(
      sidecar?.querySelector('[data-desktop-secondary-route-motion="true"]')
    ).toBeNull()

    await act(async () => vi.advanceTimersByTime(16))
    expect(sidecar?.dataset.desktopSecondaryState).toBe('entering')

    await act(async () => vi.advanceTimersByTime(500))
    expect(sidecar?.dataset.desktopSecondaryState).toBe('open')
    expect(document.activeElement).toBe(sidecar)

    const advanced = container.querySelector<HTMLAnchorElement>(
      'a[href="/settings/advanced"]'
    )
    advanced?.focus()
    await renderDetail('advanced')

    const switchedSidecar = document.body.querySelector<HTMLDialogElement>(
      '.merchant-desktop-sidecar'
    )
    expect(switchedSidecar).toBe(sidecar)
    expect(primary?.contains(switchedSidecar ?? null)).toBe(true)
    expect(switchedSidecar?.hasAttribute('aria-modal')).toBe(false)
    expect(switchedSidecar?.dataset.desktopSecondaryDialog).toBe('advanced')
    expect(switchedSidecar?.dataset.desktopSecondaryState).toBe('open')
    expect(switchedSidecar?.textContent).toContain('Platform API token')

    await act(async () =>
      switchedSidecar
        ?.querySelector<HTMLButtonElement>('[aria-label="Back to Settings"]')
        ?.click()
    )
    expect(sidecar?.dataset.desktopSecondaryState).toBe('closing')
    expect(primary?.dataset.desktopSecondaryOpen).toBeUndefined()

    await act(async () => vi.advanceTimersByTime(180))
    expect(document.body.querySelector('.merchant-desktop-sidecar')).toBeNull()
    expect(document.activeElement).toBe(advanced)
  })

  it('opens Advanced settings in the desktop side dialog', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <DesktopShell
          layout="modal"
          section={{ kind: 'merchant' }}
          destinations={destinations}
          title="Settings"
          description="Merchant settings"
        >
          <MerchantSettingsPanel
            appointmentDate="2026-07-27"
            signOut={{ error: null, pending: false, signOut: vi.fn() }}
            viewer={{
              name: 'Mara Ionescu',
              email: 'mara@example.com',
              image: null
            }}
          />
          <DesktopSecondaryDialogRoute
            id="advanced"
            title="Advanced"
            onAfterClose={vi.fn()}
          >
            <MerchantAdvancedSettings />
          </DesktopSecondaryDialogRoute>
        </DesktopShell>
      )
    )

    const sidecar = document.body.querySelector<HTMLDialogElement>(
      '.merchant-desktop-sidecar'
    )
    expect(sidecar?.dataset.desktopSecondaryDialog).toBe('advanced')
    expect(sidecar?.textContent).toContain('Platform API token')
    expect(sidecar?.textContent).toContain('Webhook signing secret')
  })

  it('opens Subscription in the persistent desktop side dialog', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const afterClose = vi.fn()

    const renderSubscription = async (plan: 'solo' | 'team') =>
      act(async () =>
        root?.render(
          <DesktopShell
            layout="modal"
            section={{ kind: 'merchant' }}
            destinations={destinations}
            title="Settings"
            description="Merchant settings"
          >
            <MerchantSettingsPanel
              appointmentDate="2026-07-27"
              signOut={{ error: null, pending: false, signOut: vi.fn() }}
              viewer={{ name: 'Mara Ionescu', email: 'mara@example.com', image: null }}
            />
            <DesktopSecondaryDialogRoute
              id="subscription"
              title="Subscription"
              contentRevision={plan}
              onAfterClose={afterClose}
            >
              <MerchantSubscriptionPanel plan={plan} />
            </DesktopSecondaryDialogRoute>
          </DesktopShell>
        )
      )

    await renderSubscription('team')

    await act(async () => vi.advanceTimersByTime(16))
    await act(async () => vi.advanceTimersByTime(500))

    const sidecar = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-sidecar'
    )
    expect(sidecar?.dataset.desktopSecondaryDialog).toBe('subscription')
    expect(sidecar?.textContent).toContain('Subscription')
    expect(sidecar?.textContent).toContain('Team')
    expect(sidecar?.textContent).toContain('Needs configuration')
    expect(sidecar?.textContent).not.toContain('$')
    expect(
      sidecar?.querySelector('[data-mobile-sheet-scroll-fade="bottom"]')
    ).toBeTruthy()

    const teamPlanButton = Array.from(
      sidecar?.querySelectorAll<HTMLButtonElement>('button') ?? []
    ).find((button) => button.textContent === 'Team')
    teamPlanButton?.focus()
    expect(document.activeElement).toBe(teamPlanButton)

    await renderSubscription('solo')
    expect(container.querySelector('.merchant-desktop-sidecar')).toBe(sidecar)
    expect(sidecar?.dataset.desktopSecondaryState).toBe('open')
    expect(document.activeElement).toBe(teamPlanButton)
    expect(sidecar?.textContent).toContain('One active provider')
    expect(sidecar?.textContent).not.toContain('Multiple providers')

    await act(async () =>
      sidecar
        ?.querySelector<HTMLButtonElement>('[aria-label="Back to Settings"]')
        ?.click()
    )

    await renderSubscription('team')
    expect(sidecar?.dataset.desktopSecondaryState).toBe('closing')

    await act(async () => vi.advanceTimersByTime(180))
    expect(afterClose).toHaveBeenCalledOnce()
    expect(container.querySelector('.merchant-desktop-sidecar')).toBeNull()

    await renderSubscription('solo')
    expect(container.querySelector('.merchant-desktop-sidecar')).toBeNull()
  })

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
    expect(sidecar?.dataset.desktopSubstepState).toBe('preparing')

    await act(async () => vi.advanceTimersByTime(16))
    expect(sidecar?.dataset.desktopSubstepState).toBe('entering')

    await act(async () => vi.advanceTimersByTime(500))
    expect(sidecar?.dataset.desktopSubstepState).toBe('open')
    expect(document.activeElement).toBe(sidecar)

    await act(async () =>
      sidecar
        ?.querySelector<HTMLButtonElement>('[aria-label="Back from recurrence picker"]')
        ?.click()
    )
    expect(sidecar?.dataset.desktopSubstepState).toBe('closing')

    await act(async () => vi.advanceTimersByTime(500))
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
      '[data-desktop-home-content="true"]'
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
