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
    viewTransition: _viewTransition,
    ...props
  }: {
    children: ReactNode
    to: string
    activeProps?: unknown
    search?: unknown
    state?: unknown
    viewTransition?: boolean
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ({ search: {}, state: { mobileSheetOrigin: 'merchant-app' } }),
  useRouter: () => ({ history: { back: vi.fn() } })
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
  document.body.innerHTML = ''
})

function presentation(children: ReactNode) {
  return (
    <MerchantPresentationProvider presentation="mobile">
      {children}
    </MerchantPresentationProvider>
  )
}

describe('MobileShell retained underlay', () => {
  it('animates one sheet over the real page during an in-app transition', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        presentation(
          <div key="home">
            <MobileShell
              layout="home"
              date="2026-07-27"
              section={{ kind: 'merchant' }}
              destinations={destinations}
            >
              <p>Real appointments page</p>
            </MobileShell>
          </div>
        )
      )
    )

    await act(async () =>
      root?.render(
        presentation(
          <div key="sheet">
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
    expect(sheet?.dataset.mobileUnderlayOrigin).toBe('retained')
    expect(sheet?.dataset.mobileSheetState).toBe('entering')
    expect(container.textContent).toContain('Real appointments page')
  })
})
