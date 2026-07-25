// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MerchantDestination } from '../navigation.tsx'
import { MerchantPresentationProvider } from '../merchant-presentation.tsx'
import { MobileShell } from './mobile-shell.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    activeProps: _activeProps,
    search: _search,
    state: _state,
    replace: _replace,
    viewTransition: _viewTransition,
    ...props
  }: {
    children: ReactNode
    to: string
    activeProps?: unknown
    search?: unknown
    state?: unknown
    replace?: boolean
    viewTransition?: boolean
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ({ search: {}, state: { mobileSheetOrigin: 'merchant-app' } }),
  useRouter: () => ({ history: { back: vi.fn() }, navigate: vi.fn() })
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

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.documentElement.style.removeProperty('--merchant-home-surface-rgb')
  document.documentElement.style.removeProperty('--merchant-home-surface')
  document.head
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.remove())
  document.body.style.removeProperty('background-color')
  document.body.innerHTML = ''
})

function presentation(children: ReactNode) {
  return (
    <MerchantPresentationProvider presentation="mobile">
      {children}
    </MerchantPresentationProvider>
  )
}

const waitForSheetSpring = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 1_000)))

function touchEvent(
  type: 'touchstart' | 'touchmove' | 'touchend',
  { x, y }: { readonly x: number; readonly y: number },
  { cancelable = true }: { readonly cancelable?: boolean } = {}
) {
  const event = new Event(type, { bubbles: true, cancelable })
  const touch = { identifier: 1, clientX: x, clientY: y }
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' ? [] : [touch] },
    changedTouches: { value: [touch] }
  })
  return event
}

describe('MobileShell retained underlay', () => {
  it('updates routed content without recreating an open sheet', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const renderRoute = (title: string) =>
      presentation(
        <MobileShell
          layout="sheet"
          title={title}
          description={`${title} description`}
          section={{ kind: 'merchant' }}
          destinations={destinations}
        >
          <p>{title} content</p>
        </MobileShell>
      )

    await act(async () => root?.render(renderRoute('Settings')))
    const sheetBefore = container.querySelector<HTMLElement>('[data-mobile-surface]')
    const stateBefore = sheetBefore?.dataset.mobileSheetState

    await act(async () => root?.render(renderRoute('Customers')))
    const sheetAfter = container.querySelector<HTMLElement>('[data-mobile-surface]')
    expect(sheetAfter).toBe(sheetBefore)
    expect(sheetAfter?.dataset.mobileSheetState).toBe(stateBefore)
    expect(container.textContent).toContain('Customers content')
  })

  it('animates one sheet over the real page during an in-app transition', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        presentation(
          <div>
            <MobileShell
              layout="home"
              date="2026-07-27"
              timezone="UTC"
              section={{ kind: 'merchant' }}
              destinations={destinations}
            >
              <p data-appointments-home="true">Real appointments page</p>
            </MobileShell>
          </div>
        )
      )
    )

    const homeBefore = container.querySelector('[data-appointments-home="true"]')
    const settingsTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open settings"]'
    )
    settingsTrigger?.focus()

    await act(async () =>
      root?.render(
        presentation(
          <div>
            <MobileShell
              layout="home"
              date="2026-07-27"
              timezone="UTC"
              section={{ kind: 'merchant' }}
              destinations={destinations}
            >
              <p data-appointments-home="true">Real appointments page</p>
            </MobileShell>
            <MobileShell
              layout="sheet"
              title="Customers"
              description="Customer history"
              section={{ kind: 'merchant' }}
              destinations={destinations}
            >
              <p>Customer route</p>
            </MobileShell>
          </div>
        )
      )
    )

    const surfaces = container.querySelectorAll('[data-mobile-surface]')
    const sheet = container.querySelector<HTMLElement>('[data-mobile-surface="sheet"]')

    expect(surfaces).toHaveLength(1)
    expect(sheet?.dataset.mobileSheetState).toBe('entering')
    expect(container.querySelector('[data-appointments-home="true"]')).toBe(homeBefore)
    expect(container.textContent).toContain('Real appointments page')
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Drag or tap to close Customers"]')
    )

    await act(async () =>
      root?.render(
        presentation(
          <div>
            <MobileShell
              layout="home"
              date="2026-07-27"
              timezone="UTC"
              section={{ kind: 'merchant' }}
              destinations={destinations}
            >
              <p data-appointments-home="true">Real appointments page</p>
            </MobileShell>
          </div>
        )
      )
    )
    await act(async () => Promise.resolve())
    expect(document.activeElement).toBe(settingsTrigger)
  })

  it('dismisses a sheet from a committed downward content pull', async () => {
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
    root = createRoot(container)
    const onActivate = vi.fn()

    await act(async () =>
      root?.render(
        <MerchantPresentationProvider presentation="mobile">
          <div>
            <div data-merchant-home-layer="true" className="merchant-home-layer">
              <MobileShell
                layout="home"
                date="2026-07-27"
                timezone="UTC"
                section={{ kind: 'merchant' }}
                destinations={destinations}
              >
                <p>Appointments page</p>
              </MobileShell>
            </div>
            <MobileShell
              layout="sheet"
              title="Customers"
              description="Customer history"
              section={{ kind: 'merchant' }}
              destinations={destinations}
            >
              <button type="button" onClick={onActivate}>
                Customer action
              </button>
            </MobileShell>
          </div>
        </MerchantPresentationProvider>
      )
    )
    await waitForSheetSpring()

    const sheet = container.querySelector<HTMLElement>('[data-mobile-surface="sheet"]')
    const action = container.querySelector<HTMLButtonElement>(
      '[data-mobile-surface="sheet"] [data-mobile-sheet-scroll] button'
    )
    const homeLayer = container.querySelector<HTMLElement>(
      '[data-merchant-home-layer="true"]'
    )

    expect(homeLayer?.dataset.mobileSheetUnderlay).toBe('active')
    expect(homeLayer?.style.getPropertyValue('--merchant-home-sheet-radius')).toBe(
      '42px'
    )
    expect(
      document.body.style.getPropertyValue(
        '--merchant-mobile-sheet-outside-dim-opacity'
      )
    ).toBe('1')
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
    ).toBe('#000000')

    await act(async () => {
      action?.dispatchEvent(touchEvent('touchstart', { x: 120, y: 240 }))
      action?.dispatchEvent(touchEvent('touchmove', { x: 124, y: 380 }))
    })

    expect(homeLayer?.dataset.mobileSheetUnderlay).toBe('active')
    expect(
      Number(homeLayer?.style.getPropertyValue('--merchant-home-sheet-scale'))
    ).toBeGreaterThan(0.933333)
    expect(
      Number(homeLayer?.style.getPropertyValue('--merchant-home-sheet-dim-opacity'))
    ).toBeLessThan(0.2)
    expect(
      Number(homeLayer?.style.getPropertyValue('--merchant-home-sheet-dim-opacity'))
    ).toBeGreaterThan(0)
    expect(
      Number.parseFloat(
        homeLayer?.style.getPropertyValue('--merchant-home-sheet-radius') ?? ''
      )
    ).toBeLessThan(42)
    expect(
      Number(
        document.body.style.getPropertyValue(
          '--merchant-mobile-sheet-outside-dim-opacity'
        )
      )
    ).toBeLessThan(1)

    await act(async () => {
      action?.dispatchEvent(touchEvent('touchend', { x: 124, y: 380 }))
      action?.click()
    })

    expect(sheet?.dataset.mobileSheetState).toBe('closing')
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
    ).toBe('rgb(224 242 254)')
    expect(
      Number.parseFloat(
        sheet?.style.getPropertyValue('--merchant-sheet-translate-y') ?? ''
      )
    ).toBe(140)
    expect(onActivate).not.toHaveBeenCalled()
    expect(homeLayer?.dataset.mobileSheetUnderlay).toBe('active')

    await waitForSheetSpring()
    expect(
      Number.parseFloat(
        sheet?.style.getPropertyValue('--merchant-sheet-translate-y') ?? ''
      )
    ).toBe(window.innerHeight)
    expect(homeLayer?.dataset.mobileSheetUnderlay).toBeUndefined()
    expect(
      document.body.style.getPropertyValue(
        '--merchant-mobile-sheet-outside-dim-opacity'
      )
    ).toBe('')
  })

  it('hands a pull from native content scrolling to sheet travel without jumping', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <MerchantPresentationProvider presentation="mobile">
          <div>
            <div data-merchant-home-layer="true" className="merchant-home-layer">
              <MobileShell
                layout="home"
                date="2026-07-27"
                timezone="UTC"
                section={{ kind: 'merchant' }}
                destinations={destinations}
              >
                <p>Appointments page</p>
              </MobileShell>
            </div>
            <MobileShell
              layout="sheet"
              title="Customers"
              description="Customer history"
              section={{ kind: 'merchant' }}
              destinations={destinations}
            >
              <button type="button">Customer action</button>
            </MobileShell>
          </div>
        </MerchantPresentationProvider>
      )
    )
    await waitForSheetSpring()

    const sheet = container.querySelector<HTMLElement>('[data-mobile-surface="sheet"]')
    const scrollport = container.querySelector<HTMLElement>(
      '[data-mobile-surface="sheet"] [data-mobile-sheet-scroll="true"]'
    )
    const action = scrollport?.querySelector<HTMLButtonElement>('button')
    expect(action).not.toBeNull()
    if (scrollport) scrollport.scrollTop = 120
    expect(scrollport?.scrollTop).toBe(120)

    await act(async () => {
      action?.dispatchEvent(touchEvent('touchstart', { x: 120, y: 240 }))
      if (scrollport) scrollport.scrollTop = 60
      expect(scrollport?.scrollTop).toBe(60)
      action?.dispatchEvent(touchEvent('touchmove', { x: 120, y: 300 }))
    })

    expect(sheet?.style.getPropertyValue('--merchant-sheet-translate-y')).toBe('0px')

    await act(async () => {
      if (scrollport) scrollport.scrollTop = 0
      expect(scrollport?.scrollTop).toBe(0)
      const sheetDragMove = touchEvent('touchmove', { x: 120, y: 390 })
      const preventDefault = vi.spyOn(sheetDragMove, 'preventDefault')
      action?.dispatchEvent(sheetDragMove)
      expect(sheetDragMove.defaultPrevented).toBe(true)
      expect(preventDefault).toHaveBeenCalledOnce()
    })

    await act(async () => {
      const browserOwnedMove = touchEvent(
        'touchmove',
        { x: 120, y: 390 },
        { cancelable: false }
      )
      const preventDefault = vi.spyOn(browserOwnedMove, 'preventDefault')
      action?.dispatchEvent(browserOwnedMove)
      expect(preventDefault).not.toHaveBeenCalled()
    })

    expect(
      Number.parseFloat(
        sheet?.style.getPropertyValue('--merchant-sheet-translate-y') ?? ''
      )
    ).toBe(30)

    await act(async () =>
      action?.dispatchEvent(touchEvent('touchend', { x: 120, y: 390 }))
    )
  })

  it('uses an explicit back button to return from a nested sheet route', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const onRequestBack = vi.fn()

    await act(async () =>
      root?.render(
        presentation(
          <MobileShell
            layout="sheet"
            title="Customers"
            description="Customer history"
            section={{ kind: 'merchant' }}
            destinations={destinations}
            onRequestBack={onRequestBack}
          >
            <button type="button">Customer action</button>
          </MobileShell>
        )
      )
    )
    await waitForSheetSpring()

    const sheetBefore = container.querySelector<HTMLElement>('[data-mobile-surface]')
    const backButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to Settings"]'
    )
    expect(backButton).not.toBeNull()

    await act(async () => backButton?.click())

    expect(onRequestBack).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-mobile-surface]')).toBe(sheetBefore)
  })

  it('dismisses a nested route sheet instead of navigating back on a committed pull', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const onRequestBack = vi.fn()
    const onRequestClose = vi.fn()

    await act(async () =>
      root?.render(
        presentation(
          <MobileShell
            layout="sheet"
            title="Customers"
            description="Customer history"
            section={{ kind: 'merchant' }}
            destinations={destinations}
            onRequestBack={onRequestBack}
            onRequestClose={onRequestClose}
          >
            <button type="button">Customer action</button>
          </MobileShell>
        )
      )
    )
    await waitForSheetSpring()

    const action = container.querySelector<HTMLButtonElement>(
      '[data-mobile-sheet-scroll] button'
    )
    await act(async () => {
      action?.dispatchEvent(touchEvent('touchstart', { x: 120, y: 240 }))
      action?.dispatchEvent(touchEvent('touchmove', { x: 124, y: 380 }))
      action?.dispatchEvent(touchEvent('touchend', { x: 124, y: 380 }))
    })

    expect(onRequestBack).not.toHaveBeenCalled()
    expect(onRequestClose).not.toHaveBeenCalled()
    expect(
      container.querySelector<HTMLElement>('[data-mobile-surface]')?.dataset
        .mobileSheetState
    ).toBe('closing')

    await waitForSheetSpring()
    expect(onRequestClose).toHaveBeenCalledOnce()
    expect(onRequestBack).not.toHaveBeenCalled()
  })

  it('does nothing but settle from a slight pull on a nested sheet route', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const closeSettings = vi.fn()
    const dismissCustomers = vi.fn()
    const navigateToSettings = vi.fn()

    const renderSheet = ({
      onRequestBack,
      onRequestClose,
      title
    }: {
      readonly onRequestBack?: () => void
      readonly onRequestClose: () => void
      readonly title: string
    }) =>
      presentation(
        <MobileShell
          layout="sheet"
          title={title}
          description={`${title} description`}
          section={{ kind: 'merchant' }}
          destinations={destinations}
          onRequestBack={onRequestBack}
          onRequestClose={onRequestClose}
        >
          <button type="button">{title} action</button>
        </MobileShell>
      )

    await act(async () =>
      root?.render(
        renderSheet({
          onRequestClose: closeSettings,
          title: 'Settings'
        })
      )
    )
    await waitForSheetSpring()
    const sheetBefore = container.querySelector<HTMLElement>('[data-mobile-surface]')

    await act(async () =>
      root?.render(
        renderSheet({
          onRequestBack: navigateToSettings,
          onRequestClose: dismissCustomers,
          title: 'Customers'
        })
      )
    )

    const action = container.querySelector<HTMLButtonElement>(
      '[data-mobile-sheet-scroll] button'
    )
    await act(async () => {
      action?.dispatchEvent(touchEvent('touchstart', { x: 120, y: 240 }))
      action?.dispatchEvent(touchEvent('touchmove', { x: 121, y: 292 }))
      action?.dispatchEvent(touchEvent('touchend', { x: 121, y: 292 }))
    })

    expect(container.querySelector('[data-mobile-surface]')).toBe(sheetBefore)
    expect(dismissCustomers).not.toHaveBeenCalled()
    expect(navigateToSettings).not.toHaveBeenCalled()
    await waitForSheetSpring()
    expect(dismissCustomers).not.toHaveBeenCalled()
    expect(navigateToSettings).not.toHaveBeenCalled()
  })
})
