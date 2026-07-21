import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MerchantDestination } from '../navigation.tsx'
import { MerchantPresentationProvider } from '../merchant-presentation.tsx'
import { MobileShell } from './mobile-shell.tsx'
import {
  getMobileSheetDragOffset,
  hasMobileSheetNavigationOrigin,
  mobileSheetNavigationState,
  shouldDismissMobileSheet
} from './mobile-sheet-gesture.ts'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    activeProps: _activeProps,
    search,
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
    <a
      href={to}
      data-search-date={(search as { readonly date?: string } | undefined)?.date}
      {...props}
    >
      {children}
    </a>
  ),
  useLocation: () => ({ search: { date: '2026-07-27' } }),
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

type TestShellProps =
  | { readonly layout: 'home' }
  | {
      readonly layout: 'sheet' | 'task'
      readonly title: string
      readonly description: string
    }

function renderShell(props: TestShellProps, reconstructedHome?: ReactNode) {
  const shell =
    props.layout === 'home' ? (
      <MobileShell
        layout="home"
        date="2026-07-27"
        section={{ kind: 'merchant' }}
        destinations={destinations}
      >
        <p>Route content</p>
      </MobileShell>
    ) : (
      <MobileShell
        layout={props.layout}
        title={props.title}
        description={props.description}
        section={{ kind: 'merchant' }}
        destinations={destinations}
      >
        <p>Route content</p>
      </MobileShell>
    )

  return renderToStaticMarkup(
    <MerchantPresentationProvider
      presentation="mobile"
      mobileHomeUnderlay={reconstructedHome}
    >
      {shell}
    </MerchantPresentationProvider>
  )
}

describe('MobileShell', () => {
  it('presents the appointments route as an immersive home with five direct actions', () => {
    const html = renderShell({ layout: 'home' })
    const homeActions = html.match(
      /<nav aria-label="Merchant home actions"[\s\S]*?<\/nav>/
    )?.[0]
    const moreNavigation = html.match(
      /<nav aria-label="Merchant navigation"[\s\S]*?<\/nav>/
    )?.[0]

    expect(homeActions).toBeDefined()
    expect(homeActions?.match(/<a /g)).toHaveLength(4)
    expect(homeActions?.match(/<button/g)).toHaveLength(1)
    expect(homeActions).toMatch(
      /Walk-ins[\s\S]*Customers[\s\S]*Services[\s\S]*Providers[\s\S]*More/
    )
    expect(homeActions?.match(/data-search-date="2026-07-27"/g)).toHaveLength(4)
    expect(homeActions?.match(/col-span-3/g)).toHaveLength(2)
    expect(homeActions?.match(/col-span-2/g)).toHaveLength(3)
    expect(moreNavigation).toContain('Availability')
    expect(moreNavigation).toContain('Settings')
    expect(moreNavigation?.match(/data-search-date="2026-07-27"/g)).toHaveLength(2)
    expect(moreNavigation).not.toMatch(
      /Appointments|Walk-ins|Customers|Services|Providers/
    )
    expect(html).not.toContain('aria-modal="true"')
  })

  it('keeps a refreshed secondary route as a sheet over reconstructed home', () => {
    const html = renderShell(
      {
        layout: 'sheet',
        title: 'Customers',
        description: 'Customer history'
      },
      <p>Reconstructed appointments page</p>
    )

    expect(html).toContain('<section')
    expect(html).not.toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Close Customers"')
    expect(html).toContain('data-mobile-underlay-origin="reconstructed"')
    expect(html).toContain('data-mobile-sheet-state="open"')
    expect(html).toContain('data-mobile-sheet-handle="true"')
    expect(html).toContain('Customers')
    expect(html).toContain('aria-hidden="true" inert=""')
    expect(html).toContain('aria-label="Merchant home actions"')
    expect(html).toContain('Reconstructed appointments page')
  })

  it('tracks downward movement directly and resists an overextended drag', () => {
    expect(getMobileSheetDragOffset(-20, 844)).toBe(0)
    expect(getMobileSheetDragOffset(84, 844)).toBe(84)
    expect(getMobileSheetDragOffset(700, 844)).toBeLessThan(700)
  })

  it('dismisses on a committed pull or a short fast flick', () => {
    expect(shouldDismissMobileSheet({ distance: 120, duration: 500 })).toBe(true)
    expect(shouldDismissMobileSheet({ distance: 52, duration: 70 })).toBe(true)
    expect(shouldDismissMobileSheet({ distance: 52, duration: 500 })).toBe(false)
  })

  it('marks links that can safely pop back inside the merchant app', () => {
    const state = mobileSheetNavigationState({ key: 'existing' })

    expect(state.key).toBe('existing')
    expect(hasMobileSheetNavigationOrigin(state)).toBe(true)
    expect(hasMobileSheetNavigationOrigin({})).toBe(false)
  })
})
