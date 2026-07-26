// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MerchantMobileSheetOutlet } from './merchant-mobile-sheet-outlet.tsx'
import { MerchantPresentationProvider } from './merchant-shell/merchant-presentation.tsx'
import { DesktopSecondaryDialogRoute } from './merchant-shell/desktop/desktop-secondary-dialog-route.tsx'
import { MerchantShell } from './merchant-shell/merchant-shell.tsx'
import { MobileSheetStackProvider } from './merchant-shell/mobile/mobile-sheet-stack.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: '/settings'
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
  useLocation: () => ({
    pathname: mocks.pathname,
    search: { date: '2026-07-27' },
    state: undefined
  }),
  useRouter: () => ({
    history: { back: vi.fn() },
    navigate: mocks.navigate
  })
}))

let root: Root | undefined

beforeEach(() => {
  mocks.pathname = '/settings'
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
})

type TestPath =
  | '/customers'
  | '/settings'
  | '/settings/advanced'
  | '/settings/appearance'
  | '/settings/subscription'

function RouteLeaf({ pathname }: { readonly pathname: TestPath }) {
  if (pathname.startsWith('/settings/')) {
    const detail = pathname.slice('/settings/'.length)
    const title = `${detail[0]?.toUpperCase()}${detail.slice(1)}`
    return (
      <MerchantShell
        section={{ kind: 'merchant' }}
        title="Settings"
        description="Settings route"
      >
        <p>Settings content</p>
        <DesktopSecondaryDialogRoute
          key={pathname}
          id={detail}
          title={title}
          onAfterClose={vi.fn()}
        >
          <p>{`${title} content`}</p>
        </DesktopSecondaryDialogRoute>
      </MerchantShell>
    )
  }

  const title = pathname === '/settings' ? 'Settings' : 'Customers'
  return (
    <MerchantShell
      key={pathname}
      section={{ kind: 'merchant' }}
      title={title}
      description={`${title} route`}
    >
      <p>{`${title} content`}</p>
    </MerchantShell>
  )
}

function Harness({
  pathname,
  presentation = 'desktop'
}: {
  readonly pathname: TestPath
  readonly presentation?: 'desktop' | 'mobile'
}) {
  mocks.pathname = pathname
  return (
    <MerchantPresentationProvider presentation={presentation}>
      <MobileSheetStackProvider>
        <MerchantMobileSheetOutlet
          pathname={pathname}
          appointmentDate="2026-07-27"
          overlayOpen
        >
          <RouteLeaf pathname={pathname} />
        </MerchantMobileSheetOutlet>
      </MobileSheetStackProvider>
    </MerchantPresentationProvider>
  )
}

describe('desktop Merchant overlay routing', () => {
  it('keeps one open dialog host while sibling route content changes', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root?.render(<Harness pathname="/settings" />))

    const originalDialog = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-modal'
    )
    expect(originalDialog).not.toBeNull()
    expect(originalDialog?.dataset.desktopModalState).toBe('entering')

    await act(async () => root?.render(<Harness pathname="/customers" />))

    const updatedDialog = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-modal'
    )
    expect(updatedDialog).toBe(originalDialog)
    expect(container.querySelectorAll('.merchant-desktop-modal')).toHaveLength(1)
    expect(updatedDialog?.textContent).toContain('Customers content')
    expect(updatedDialog?.textContent).not.toContain('Settings content')
  })

  it('keeps Settings primary while Subscription opens as the routed side dialog', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root?.render(<Harness pathname="/settings/subscription" />))

    expect(container.querySelector('#merchant-desktop-modal-title')?.textContent).toBe(
      'Settings'
    )
    expect(
      container.querySelector('#merchant-desktop-secondary-title')?.textContent
    ).toBe('Subscription')
    expect(container.textContent).toContain('Settings content')
    expect(container.textContent).toContain('Subscription content')
  })

  it('updates a routed settings detail inside the existing side dialog', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root?.render(<Harness pathname="/settings/subscription" />))
    const originalSidecar = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-sidecar'
    )

    await act(async () => root?.render(<Harness pathname="/settings/appearance" />))

    const updatedSidecar = container.querySelector<HTMLDialogElement>(
      '.merchant-desktop-sidecar'
    )
    expect(updatedSidecar).toBe(originalSidecar)
    expect(updatedSidecar?.dataset.desktopSecondaryDialog).toBe('appearance')
    expect(updatedSidecar?.dataset.desktopSecondaryState).toBe('preparing')
    expect(updatedSidecar?.textContent).toContain('Appearance content')
    expect(updatedSidecar?.textContent).not.toContain('Subscription content')
    expect(container.querySelectorAll('.merchant-desktop-sidecar')).toHaveLength(1)
  })
})

describe('mobile Merchant overlay routing', () => {
  it('shows Subscription in the existing sheet host with a back action', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(<Harness pathname="/settings/subscription" presentation="mobile" />)
    )

    expect(container.querySelectorAll('[data-mobile-surface="sheet"]')).toHaveLength(1)
    expect(container.textContent).toContain('Subscription content')
    expect(container.querySelector('#merchant-mobile-sheet-title')?.textContent).toBe(
      'Subscription'
    )

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Back to Settings"]')
        ?.click()
    )
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: { date: '2026-07-27' },
      replace: true,
      viewTransition: false
    })
  })
})
