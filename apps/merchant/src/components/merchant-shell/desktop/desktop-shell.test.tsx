import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MerchantDestination } from '../navigation.tsx'
import { DesktopShell } from './desktop-shell.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    state: _state,
    viewTransition: _viewTransition,
    activeProps: _activeProps,
    inactiveProps: _inactiveProps,
    ...props
  }: {
    children: ReactNode
    to: string
    search?: { date?: string }
    state?: unknown
    viewTransition?: boolean
    activeProps?: unknown
    inactiveProps?: unknown
  }) => (
    <a href={to} data-search-date={search?.date} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ({ search: { date: '2026-07-27' } }),
  useRouter: () => ({ navigate: vi.fn() })
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

function renderShell(layout: 'home' | 'modal') {
  return renderToStaticMarkup(
    <DesktopShell
      layout={layout}
      section={{ kind: 'merchant' }}
      destinations={destinations}
      title={layout === 'home' ? 'Appointments' : 'Customers'}
      description="Route description"
      viewer={{
        name: 'Mara Ionescu',
        image: 'https://images.example.test/mara.jpg'
      }}
    >
      <p>Route content</p>
    </DesktopShell>
  )
}

describe('DesktopShell', () => {
  it('renders Appointments as a compact centered home with a booking dialog action', () => {
    const html = renderShell('home')
    const actions = html.match(
      /<nav aria-label="Merchant desktop home actions"[\s\S]*?<\/nav>/
    )?.[0]
    const userButton = html.match(
      /<a[^>]*data-desktop-user-button="true"[\s\S]*?<\/a>/
    )?.[0]

    expect(html).toContain('aria-label="Merchant desktop home"')
    expect(html).toContain('aria-label="Open Settings"')
    expect(html).toContain('data-desktop-user-button="true"')
    expect(html).toContain('src="https://images.example.test/mara.jpg"')
    expect(html).toContain('alt="Avatar"')
    expect(html).toContain('width="36"')
    expect(html).toContain('height="36"')
    expect(html).toContain('rounded-full p-1 transition-transform')
    expect(html).toContain(
      'size-9 shrink-0 items-center justify-center overflow-hidden'
    )
    expect(html).toContain('aria-label="About BeeSolo"')
    expect(html).toContain('href="/about"')
    expect(html).toContain('merchant-logo-enter')
    expect(html).toContain('active:scale-[0.98]')
    expect(html).not.toMatch(/aria-label="About BeeSolo"[^>]*hover:/)
    expect(html).toContain('grid h-20 shrink-0')
    expect(html).toContain('items-center px-4')
    expect(html).toContain('grid-cols-[2.75rem_1fr_2.75rem]')
    expect(html).toContain('data-desktop-date-header="true"')
    expect(html).toContain('<span>Monday</span>')
    expect(html).toContain('<span aria-hidden="true">·</span>')
    expect(html).toContain('<span class="tabular-nums">July 27</span>')
    expect(html).not.toContain('data-date-hero-layout="desktop-header"')
    expect(html).toContain('data-current-day-marker-slot="true"')
    expect(html).toContain('class="absolute bottom-0 left-1/2 size-1.5')
    expect(html).toContain('viewBox="0 0 126 126"')
    expect(html).toContain('size-6')
    expect(html).not.toContain('>Merchant App</span>')
    expect(userButton).not.toContain('lucide-user-round')
    expect(html).not.toContain('lucide-settings')
    expect(html).not.toContain('Route description')
    expect(html).not.toContain('>Today</p>')
    expect(html).not.toContain('aria-label="Merchant App"')
    expect(html).not.toContain('<dialog')
    expect(actions?.match(/data-desktop-home-action="true"/g)).toHaveLength(6)
    expect(actions).toContain('data-desktop-home-create-action="new-appointment"')
    expect(actions).toContain('aria-haspopup="dialog"')
    expect(actions).toContain('New appointment')
    expect(actions?.match(/data-search-date="2026-07-27"/g)).toHaveLength(6)
    expect(actions).toMatch(
      /Walk-ins[\s\S]*Customers[\s\S]*Services[\s\S]*Providers[\s\S]*More/
    )
  })

  it('renders secondary URLs as a modal over the desktop home canvas', () => {
    const html = renderShell('modal')

    expect(html).toContain('<dialog')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('data-desktop-modal-state="entering"')
    expect(html).toContain('aria-label="Close Customers"')
    expect(html).toContain('<button')
    expect(html).toContain('Route content')
    expect(html).not.toContain('aria-label="Merchant App"')
  })

  it('falls back to the signed-in viewer initials when no avatar is available', () => {
    const html = renderToStaticMarkup(
      <DesktopShell
        layout="home"
        section={{ kind: 'merchant' }}
        destinations={destinations}
        title="Appointments"
        description="Route description"
        viewer={{ name: 'Mara Ionescu', image: null }}
      >
        <p>Route content</p>
      </DesktopShell>
    )
    const userButton = html.match(
      /<a[^>]*data-desktop-user-button="true"[\s\S]*?<\/a>/
    )?.[0]

    expect(userButton).toContain('>MI</span>')
    expect(userButton).not.toContain('<img')
  })
})
