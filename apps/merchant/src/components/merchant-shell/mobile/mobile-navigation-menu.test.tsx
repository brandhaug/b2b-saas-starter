import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MerchantDestination } from '../navigation.tsx'
import { MobileNavigationMenu } from './mobile-navigation-menu.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    state: _state,
    search: _search,
    viewTransition: _viewTransition,
    ...props
  }: {
    readonly children: ReactNode
    readonly to: string
    readonly state?: unknown
    readonly search?: unknown
    readonly viewTransition?: boolean
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}))

const destinations: readonly MerchantDestination[] = [
  { label: 'Walk-ins', to: '/walk-ins' },
  { label: 'Customers', to: '/customers' },
  { label: 'Settings', to: '/settings' }
]

describe('MobileNavigationMenu', () => {
  it('uses compact Poke-density grouped rows without shrinking touch targets', () => {
    const html = renderToStaticMarkup(
      <MobileNavigationMenu destinations={destinations} appointmentDate="2026-07-23" />
    )

    expect(html).toContain('rounded-2xl')
    expect(html).toContain('min-h-14')
    expect(html).toContain('text-[0.9375rem]')
    expect(html).toContain('size-[1.375rem]')
    expect(html).toContain('lucide-chevron-right')
    expect(html).not.toContain('min-h-[4.75rem]')
    expect(html).not.toContain('text-lg')
    expect(html).not.toContain('size-7')
  })
})
