// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MerchantMobileSheetOutlet } from './merchant-mobile-sheet-outlet.tsx'
import { MerchantPresentationProvider } from './merchant-shell/merchant-presentation.tsx'
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

function RouteLeaf({ pathname }: { readonly pathname: '/customers' | '/settings' }) {
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

function Harness({ pathname }: { readonly pathname: '/customers' | '/settings' }) {
  mocks.pathname = pathname
  return (
    <MerchantPresentationProvider presentation="desktop">
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
})
