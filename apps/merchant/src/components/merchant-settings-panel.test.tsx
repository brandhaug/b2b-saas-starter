import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MerchantSettingsPanel } from './merchant-settings-panel.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    state: _state,
    viewTransition: _viewTransition,
    ...props
  }: {
    children: ReactNode
    to: string
    search?: { date?: string }
    state?: unknown
    viewTransition?: boolean
  }) => (
    <a href={to} data-search-date={search?.date} {...props}>
      {children}
    </a>
  )
}))

describe('MerchantSettingsPanel', () => {
  it('matches the profile-first grouped settings structure on desktop and mobile', () => {
    const html = renderToStaticMarkup(
      <MerchantSettingsPanel
        appointmentDate="2026-07-27"
        viewer={{
          name: 'Mara Ionescu',
          email: 'mara@example.com',
          emailVerified: true,
          image: 'https://images.example.test/mara.jpg'
        }}
        signOut={{ error: null, pending: false, signOut: vi.fn() }}
      />
    )

    expect(html).toContain('data-merchant-settings-profile="true"')
    expect(html).toContain('src="https://images.example.test/mara.jpg"')
    expect(html).toContain('width="64"')
    expect(html).toContain('height="64"')
    expect(html).toContain('Mara Ionescu')
    expect(html).toContain('mara@example.com')
    expect(html).toContain('aria-label="Verified account"')
    expect(html.match(/data-merchant-settings-group="true"/g)).toHaveLength(2)
    expect(html.match(/data-merchant-settings-row="true"/g)).toHaveLength(7)
    expect(html).toContain('href="/customers"')
    expect(html).toContain('href="/services"')
    expect(html).toContain('href="/providers"')
    expect(html).toContain('href="/availability"')
    expect(html).toContain('data-search-date="2026-07-27"')
    expect(html).toContain('Appearance')
    expect(html).toContain('Advanced')
    expect(html).toContain('Log out')
    expect(html).toContain('rounded-2xl border')
    expect(html).toContain('min-h-[3.3125rem]')
  })

  it('uses initials when the account does not have an avatar', () => {
    const html = renderToStaticMarkup(
      <MerchantSettingsPanel
        appointmentDate={undefined}
        viewer={{ name: 'Mara Ionescu', email: null, image: null }}
        signOut={{ error: null, pending: false, signOut: vi.fn() }}
      />
    )

    expect(html).toContain('>MI</span>')
    expect(html).not.toContain('<img')
  })
})
