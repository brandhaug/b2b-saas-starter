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
      backgroundContent={<p>Loaded appointments dashboard</p>}
      section={
        layout === 'home'
          ? { kind: 'merchant' }
          : { kind: 'catalog', presentation: 'solo' }
      }
      destinations={destinations}
      title={layout === 'home' ? 'Appointments' : 'Customers'}
      description="Route description"
    >
      <p>Route content</p>
    </DesktopShell>
  )
}

describe('DesktopShell', () => {
  it('renders Appointments as the full desktop workspace with standard navigation', () => {
    const html = renderShell('home')

    expect(html).toContain('aria-label="Merchant App"')
    expect(html).toContain('Appointments')
    expect(html).toContain('Route content')
    expect(html).not.toContain('<dialog')
    expect(html).not.toContain('Merchant desktop home actions')
  })

  it('renders secondary URLs as a modal over an inert desktop workspace', () => {
    const html = renderShell('modal')

    expect(html).toContain('aria-label="Merchant App"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('inert=""')
    expect(html).toContain('<dialog')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Close Customers"')
    expect(html).toContain('data-search-date="2026-07-27"')
    expect(html).toContain('Route content')
    expect(html).toContain('Loaded appointments dashboard')
    expect(html.match(/Merchant catalog/g)).toHaveLength(1)
  })
})
