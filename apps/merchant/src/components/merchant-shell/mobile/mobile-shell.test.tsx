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
  shouldBeginMobileSheetSurfaceDrag,
  shouldDismissMobileSheet,
  shouldDismissNestedMobileSheet
} from './mobile-sheet-gesture.ts'
import { POKE_MOBILE_SHEET_SPRING } from './mobile-sheet-motion.ts'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    activeProps: _activeProps,
    search,
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
    <a
      href={to}
      data-search-date={(search as { readonly date?: string } | undefined)?.date}
      {...props}
    >
      {children}
    </a>
  ),
  useLocation: () => ({ search: { date: '2026-07-27' } }),
  useRouter: () => ({ history: { back: vi.fn() }, navigate: vi.fn() })
}))

vi.mock('@/features/appointments/mobile/use-mobile-calendar-date.ts', () => ({
  useMobileCalendarDate: () => '2026-07-21'
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
  | { readonly layout: 'home'; readonly date?: string }
  | {
      readonly layout: 'sheet' | 'task'
      readonly title: string
      readonly description: string
    }

function renderShell(props: TestShellProps) {
  const shell =
    props.layout === 'home' ? (
      <MobileShell
        layout="home"
        date={props.date ?? '2026-07-21'}
        timezone="UTC"
        bookingUrl="/mara-booking-studio/booking"
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
    <MerchantPresentationProvider presentation="mobile">
      {shell}
    </MerchantPresentationProvider>
  )
}

describe('MobileShell', () => {
  it('presents the appointments route with the compact appointment action dock', () => {
    const html = renderShell({ layout: 'home' })
    const homeActions = html.match(
      /<nav aria-label="Merchant home actions"[\s\S]*?<\/nav>/
    )?.[0]
    const settingsNavigation = html.match(
      /<nav aria-label="Settings navigation"[\s\S]*?<\/nav>/
    )?.[0]

    expect(homeActions).toBeDefined()
    expect(homeActions).toContain('aria-label="Open settings"')
    expect(homeActions).toContain('aria-label="New appointment"')
    expect(homeActions).toContain('aria-label="Open calendar"')
    expect(homeActions).toContain('data-mobile-home-action="settings"')
    expect(homeActions).toContain('data-mobile-home-action="new-appointment"')
    expect(homeActions).toContain('data-mobile-home-action="calendar"')
    expect(homeActions).not.toMatch(/Walk-ins|Customers|Services|Providers|More/)
    expect(settingsNavigation).toBeUndefined()
    expect(html).not.toContain('aria-modal="true"')
    expect(html).toContain('data-mobile-home-viewport="true"')
    expect(html).toContain('data-mobile-home-content="true"')
    expect(html).toContain('h-dvh')
    expect(html).not.toContain('merchant-home-hero')
  })

  it('uses an arrow to return to today from another selected date', () => {
    const html = renderShell({ layout: 'home', date: '2026-07-20' })
    const returnAction = html.match(
      /<a[^>]*aria-label="Return to today"[\s\S]*?<\/a>/
    )?.[0]

    expect(returnAction).toContain('lucide-arrow-left')
    expect(returnAction).not.toContain('lucide-calendar-days')
    expect(returnAction).not.toContain('bg-primary')
  })

  it('renders a refreshed secondary route as the rounded navigation sheet', () => {
    const html = renderShell({
      layout: 'sheet',
      title: 'Customers',
      description: 'Customer history'
    })

    expect(html).toContain('<dialog')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Drag or tap to close Customers"')
    expect(html).toContain('data-mobile-sheet-state="entering"')
    expect(html).toContain('data-mobile-sheet-scroll="true"')
    expect(html).toContain('data-mobile-sheet-scroll-fade="top"')
    expect(html).toContain('data-mobile-sheet-scroll-fade="bottom"')
    expect(html).toContain('mt-6')
    expect(html).toContain('h-[calc(100dvh-1.5rem)]')
    expect(html).toContain('max-h-[calc(100dvh-1.5rem)]')
    expect(html).not.toContain('min-h-[calc(100dvh-1.5rem)]')
    expect(html).toContain('rounded-t-[2.25rem]')
    expect(html).toContain('border-t')
    expect(html).not.toContain('merchant-mobile-overlay-backdrop')
    expect(html).toContain('data-mobile-sheet-handle="true"')
    expect(html).toContain('merchant-sheet-safe-inline')
    expect(html).toContain('text-[0.9375rem]')
    expect(html).toContain('font-semibold')
    expect(html).not.toContain('Customer history')
    expect(html).not.toContain('Merchant App')
    expect(html).not.toContain('lucide-x')
    expect(html).not.toContain('backdrop-blur')
    expect(html).toContain('Customers')
    expect(html).not.toContain('aria-label="Merchant home actions"')
    expect(html).not.toContain('opacity-65')
  })

  it('renders task routes with the floating Calendar sheet geometry', () => {
    const html = renderShell({
      layout: 'task',
      title: 'Appointment detail',
      description: 'Appointment facts'
    })

    expect(html).toContain('data-mobile-surface="task"')
    expect(html).toContain('merchant-floating-sheet-panel')
    expect(html).toContain('data-mobile-sheet-scroll-sizing="content"')
    expect(html).toContain('border')
    expect(html).not.toContain('mt-6')
    expect(html).not.toContain('h-[calc(100dvh-1.5rem)]')
    expect(html).not.toContain('rounded-t-[2.25rem]')
  })

  it('tracks the finger directly and clamps only at the closed position', () => {
    expect(getMobileSheetDragOffset(-20, 844)).toBe(0)
    expect(getMobileSheetDragOffset(84, 844)).toBe(84)
    expect(getMobileSheetDragOffset(700, 844)).toBe(700)
    expect(getMobileSheetDragOffset(900, 844)).toBe(844)
  })

  it('uses the same smooth physical spring as Poke sheet travel', () => {
    expect(POKE_MOBILE_SHEET_SPRING).toEqual({
      stiffness: 580,
      damping: 60,
      mass: 1.35
    })
  })

  it('dismisses on a committed pull or a short fast flick', () => {
    expect(
      shouldDismissMobileSheet({ distance: 440, duration: 500, viewportHeight: 844 })
    ).toBe(true)
    expect(
      shouldDismissMobileSheet({ distance: 52, duration: 70, viewportHeight: 844 })
    ).toBe(true)
    expect(shouldDismissNestedMobileSheet({ distance: 52, viewportHeight: 844 })).toBe(
      false
    )
    expect(shouldDismissNestedMobileSheet({ distance: 140, viewportHeight: 844 })).toBe(
      true
    )
    expect(
      shouldDismissMobileSheet({ distance: 120, duration: 500, viewportHeight: 844 })
    ).toBe(false)
  })

  it('takes over a downward surface pull only from the scroll top', () => {
    expect(
      shouldBeginMobileSheetSurfaceDrag({
        deltaX: 4,
        deltaY: 18,
        scrollTop: 0
      })
    ).toBe(true)
    expect(
      shouldBeginMobileSheetSurfaceDrag({
        deltaX: 4,
        deltaY: 18,
        scrollTop: 12
      })
    ).toBe(false)
    expect(
      shouldBeginMobileSheetSurfaceDrag({
        deltaX: 20,
        deltaY: 10,
        scrollTop: 0
      })
    ).toBe(false)
    expect(
      shouldBeginMobileSheetSurfaceDrag({
        deltaX: 2,
        deltaY: -18,
        scrollTop: 0
      })
    ).toBe(false)
  })

  it('marks links that can safely pop back inside the merchant app', () => {
    const state = mobileSheetNavigationState({ key: 'existing' })

    expect(state.key).toBe('existing')
    expect(hasMobileSheetNavigationOrigin(state)).toBe(true)
    expect(hasMobileSheetNavigationOrigin({})).toBe(false)
  })
})
