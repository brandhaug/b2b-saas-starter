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
    activeProps: _activeProps,
    inactiveProps: _inactiveProps,
    ...props
  }: {
    children: ReactNode
    to: string
    search?: { date?: string }
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
    >
      <p>Route content</p>
    </DesktopShell>
  )
}

describe('DesktopShell', () => {
  it('renders Appointments as a compact centered home with five primary actions', () => {
    const html = renderShell('home')
    const actions = html.match(
      /<nav aria-label="Merchant desktop home actions"[\s\S]*?<\/nav>/
    )?.[0]

    expect(html).toContain('aria-label="Merchant desktop home"')
    expect(html).toContain('aria-label="Open Settings"')
    expect(html).toContain('lucide-user-round')
    expect(html).not.toContain('lucide-settings')
    expect(html).not.toContain('Route description')
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('>Today</p>')
    expect(html).not.toContain('aria-label="Merchant App"')
    expect(html).not.toContain('<dialog')
    expect(actions?.match(/data-desktop-home-action="true"/g)).toHaveLength(5)
    expect(actions).toMatch(
      /Walk-ins[\s\S]*Customers[\s\S]*Services[\s\S]*Providers[\s\S]*More/
    )
  })

  it('renders secondary URLs as a modal over the desktop home canvas', () => {
    const html = renderShell('modal')

    expect(html).toContain('aria-label="Merchant desktop home"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('<dialog')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Close Customers"')
    expect(html).toContain('data-search-date="2026-07-27"')
    expect(html).toContain('Route content')
    expect(html).not.toContain('aria-label="Merchant App"')
  })
})
